# How the Checkpoint Runs in the Browser

This document explains how a PyTorch Lightning checkpoint trained in the
[MOSAIC](https://github.com/KevinBian107/MOSAIC) repo is converted into a
format the browser can execute — no server required.

## Overview

```
PyTorch Lightning (.ckpt)
        │
        ▼
  ┌─────────────────────┐
  │  export_onnx.py     │   (in MOSAIC repo: scripts/onnx_export/)
  │                     │
  │  1. Extract weights │   Strip Lightning / MOSAIC wrappers
  │  2. HuggingFace GPT2│   Re-package as standard HF model
  │  3. torch.onnx.export│  Trace to ONNX graph (opset 14)
  │  4. tokenizer config│   Write vocab mapping for JS decoder
  └─────────┬───────────┘
            │
            ▼
     model.onnx  +  tokenizer_config.json  +  config.json
            │
            ▼
  ┌──────────────────────────────────────┐
  │  Browser (Transformers.js)           │
  │                                      │
  │  Transformers.js loads the ONNX      │
  │  graph into ONNX Runtime Web, which  │
  │  executes on WebGPU (or WASM         │
  │  fallback). The JS engine runs a     │
  │  custom autoregressive loop:         │
  │                                      │
  │  tokens = [SOS]                      │
  │  while last token != EOS:            │
  │      logits = model.forward(tokens)  │
  │      next = top_k_sample(logits[-1]) │
  │      tokens.push(next)               │
  │                                      │
  │  molecule = HDTCTokenizer.decode(    │
  │      tokens)                         │
  │  smiles = RDKit_WASM.validate(       │
  │      molecule)                       │
  └──────────────────────────────────────┘
```

## Key Technologies

| Component | Role |
|---|---|
| [ONNX Runtime Web](https://onnxruntime.ai/) | Executes the neural network graph in the browser via WebGPU or WASM |
| [Transformers.js](https://huggingface.co/docs/transformers.js) | Wraps ONNX Runtime Web with a HuggingFace-compatible API (`AutoModelForCausalLM`) |
| [RDKit WASM](https://github.com/rdkit/rdkit-js) | Chemistry validation and SMILES generation, compiled to WebAssembly |

## Why ONNX (not PyTorch)?

Browsers cannot run PyTorch directly. ONNX (Open Neural Network Exchange) is a
standard interchange format that captures the computation graph as a static set
of operations. ONNX Runtime Web then executes this graph using the browser's
GPU (WebGPU) or CPU (WebAssembly).

The export uses `torch.onnx.export` which traces the model's forward pass,
recording every operation into the ONNX graph. Dynamic axes are specified for
batch size and sequence length so the model handles variable-length inputs.

## Why Not Quantization?

The export script supports int8 quantization (`--quantize`), which shrinks the
model from ~45 MB to ~12 MB. However, for this small model (11.5M parameters),
int8 quantization introduces significant logit errors (up to 1.0+ at realistic
sequence lengths), causing the top-k token predictions to diverge from the
original model. Since autoregressive generation compounds errors — one wrong
token early on corrupts the entire molecule — **the demo uses the fp32 model**.

## Weight Extraction Details

The MOSAIC training code wraps GPT-2 in two layers:

```
GraphGeneratorModule (Lightning)
  └── TransformerLM
       └── GPT2LMHeadModel (HuggingFace)
```

This means checkpoint state dict keys look like:
```
model.model.transformer.wte.weight
model.model.transformer.h.0.ln_1.weight
...
```

The export script strips the `model.model.` prefix to recover standard
HuggingFace keys (`transformer.wte.weight`, etc.), then loads them into a fresh
`GPT2LMHeadModel` with `strict=True` to ensure nothing is missing.

## Tokenizer Config

The JavaScript tokenizer needs to know the vocabulary layout. The export script
writes a `tokenizer_config.json` that captures:

```json
{
  "IDX_OFFSET": 12,
  "vocab_size": 127,
  "num_atom_types": 10,
  "num_bond_types": 5,
  "max_num_nodes": 100
}
```

Vocabulary layout (127 tokens):
```
[0-11]    Special tokens (SOS, EOS, PAD, COMM_START, COMM_END, LEDGE, REDGE,
          SUPER_START, SUPER_END, TYPE_RING, TYPE_FUNC, TYPE_SINGLETON)
[12-111]  Node IDs (up to 100 nodes per molecule)
[112-121] Atom types (C, N, O, F, P, S, Cl, Br, I, Unknown)
[122-126] Bond types (SINGLE, DOUBLE, TRIPLE, AROMATIC, Unknown)
```

The TypeScript tokenizer in `src/engine/tokenizer.ts` mirrors the Python
`HDTCTokenizer.parse_tokens()` method exactly, using these same offsets to
decode token sequences back into molecular graphs.

## File Layout

After export, the model files are placed in `public/models/hdtc_coconut/`:

```
public/models/hdtc_coconut/
├── config.json              # HuggingFace GPT-2 config (n_embd, n_layer, etc.)
├── tokenizer_config.json    # HDTC vocab layout for JS tokenizer
├── generation_config.json   # Default generation hyperparameters
└── onnx/
    ├── config.json          # Copy of HF config (Transformers.js expects it here)
    ├── generation_config.json
    └── model.onnx           # The ONNX model (~45 MB, fp32)
```

Transformers.js loads the model via:
```typescript
const model = await AutoModelForCausalLM.from_pretrained('/models/hdtc_coconut');
```

It reads `config.json` from the root, then looks for the ONNX file in `onnx/`.
