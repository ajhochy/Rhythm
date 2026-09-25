import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Live-mode proxy/middleware wiring is paused; the canceled partial config is
// preserved at docs/ai/paused-live-mode/vite.config.live.ts.txt.
export default defineConfig({
  base: './',
  cacheDir: '.vite',
  plugins: [react()],
  resolve: {
    alias: { '@ajhochy/rhythm-workspace-ui': fileURLToPath(new URL('../../packages/rhythm-workspace-ui/src', import.meta.url)) },
    dedupe: ['react', 'react-dom'],
  },
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
