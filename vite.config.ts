import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/MOSAIC-live-demo/',
  plugins: [react(), tailwindcss()],
  // Disable SPA history fallback so missing files return proper 404s.
  // Transformers.js probes for optional JSON files (tokenizer.json, etc.)
  // and Vite's default SPA fallback returns HTML for them, causing JSON parse errors.
  appType: 'mpa',
  optimizeDeps: {
    exclude: ['@rdkit/rdkit'],
  },
  build: {
    target: 'esnext',
  },
});
