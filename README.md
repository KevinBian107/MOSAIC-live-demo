# MOSAIC Live Demo

Browser-based molecular generation using the MOSAIC HDTC tokenizer. Runs a
GPT-2 model entirely client-side via ONNX Runtime Web — no server needed.

## Quick Start

```bash
npm install
npm run dev        # http://localhost:5173
```

The model files (`public/models/hdtc_coconut/onnx/*.onnx`) are gitignored due
to size. You need to export them from a trained checkpoint first (see below).

## Exporting a Checkpoint

The export scripts live in the main MOSAIC repo under
[`scripts/onnx_export/`](https://github.com/KevinBian107/MOSAIC/tree/main/scripts/onnx_export).

From the MOSAIC repo root:

```bash
# Export checkpoint to ONNX (fp32)
python scripts/onnx_export/export_onnx.py \
    --checkpoint checkpoints/last.ckpt \
    --output_dir exports/hdtc_coconut \
    --verify

# Copy to the demo's public/ directory
cp exports/hdtc_coconut/onnx/model.onnx       mosaic-live-demo/public/models/hdtc_coconut/onnx/
cp exports/hdtc_coconut/onnx/config.json       mosaic-live-demo/public/models/hdtc_coconut/onnx/
cp exports/hdtc_coconut/onnx/generation_config.json mosaic-live-demo/public/models/hdtc_coconut/onnx/
cp exports/hdtc_coconut/tokenizer_config.json  mosaic-live-demo/public/models/hdtc_coconut/
```

To pre-generate the demo cache (fallback molecules shown before model loads):

```bash
python scripts/onnx_export/generate_demo_cache.py \
    --checkpoint checkpoints/last.ckpt \
    --output mosaic-live-demo/public/data/demo_cache.json \
    --num_molecules 100
```

See [`docs/onnx-export.md`](docs/onnx-export.md) for a detailed explanation of
how the checkpoint is converted and executed in the browser.

## Project Structure

```
src/
├── App.tsx                  # Main app — model loading, generation orchestration
├── main.tsx                 # React entry point
├── engine/                  # Core inference pipeline
│   ├── model.ts             # ONNX model loading & autoregressive generation
│   ├── tokenizer.ts         # HDTC token → molecular graph decoder
│   ├── chemistry.ts         # RDKit WASM validation & SMILES extraction
│   ├── sampling.ts          # Top-K sampling with seeded RNG
│   └── types.ts             # Shared type definitions
├── components/              # React UI
│   ├── GenerationControls.tsx
│   ├── ProgressBar.tsx
│   ├── MoleculeGrid.tsx
│   ├── MoleculeCard.tsx
│   ├── MoleculeViewer2D.tsx # RDKit SVG rendering
│   ├── MoleculeViewer3D.tsx # React Three Fiber 3D viewer
│   ├── Atom3D.tsx
│   ├── Bond3D.tsx
│   └── CommunityHull.tsx
├── animation/               # 3D animation system
│   ├── phases.ts            # 4-phase reveal animation
│   └── spring.ts            # Spring physics & 3D math
└── styles/
    └── globals.css
```

## Tech Stack

- **Vite** + **React 19** + **TypeScript** — UI framework
- **Tailwind CSS 4** — styling
- **Transformers.js** — loads ONNX model, runs on WebGPU (WASM fallback)
- **RDKit WASM** — chemistry validation, SMILES, 2D coordinates
- **React Three Fiber** + **drei** — 3D molecule visualization

## Building

```bash
npm run build      # Output in dist/
npm run preview    # Preview production build
```

## Notes

- The demo uses **fp32** ONNX weights (~45 MB). Int8 quantization is available
  but degrades generation quality for this small model (11.5M params).
- WebGPU is preferred for inference speed; WASM is the automatic fallback.
- All computation happens client-side. No API calls after the initial page load.
