import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { apiDevMiddleware } from './server/devMiddleware.js';

export default defineConfig(({ mode }) => {
  // Expose OPENSKY_* from .env to the local /api handlers (never to the browser bundle).
  const env = loadEnv(mode, process.cwd(), 'OPENSKY_');
  Object.assign(process.env, env);

  return {
    plugins: [react(), apiDevMiddleware()],
    resolve: {
      dedupe: ['three'],
      alias: {
        // satellite.js v7's root entry also pulls in its WASM/pthreads build (top-level await,
        // node:worker_threads). We only need the pure-JS SGP4 modules, so import them directly.
        '@sgp4': fileURLToPath(new URL('./node_modules/satellite.js/dist/', import.meta.url)),
      },
    },
    worker: { format: 'es' },
    build: {
      target: 'es2020',
      chunkSizeWarningLimit: 2000,
      rollupOptions: {
        output: {
          // three/globe.gl and deck.gl are split automatically along the lazy GlobeView / FlatMap
          // boundaries; only the tiny React runtime is pinned to its own long-cached chunk.
          manualChunks(id) {
            if (/node_modules\/(react|react-dom|scheduler|zustand)\//.test(id)) return 'react';
            return undefined;
          },
        },
      },
    },
  };
});
