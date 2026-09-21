// Self-contained demo build: one HTML file with every script, texture and dataset inlined, and
// all network feeds replaced by simulations (VITE_OFFLINE=1). Used for sandboxed previews.
//   npm run build:demo   ->  dist-demo/index.html
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile({ removeViteModuleLoader: true })],
  define: { 'import.meta.env.VITE_OFFLINE': JSON.stringify('1') },
  resolve: {
    dedupe: ['three'],
    alias: { '@sgp4': fileURLToPath(new URL('./node_modules/satellite.js/dist/', import.meta.url)) },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2020',
    outDir: 'dist-demo',
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 20000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
