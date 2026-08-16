import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Live-mode proxy/middleware wiring is paused; the canceled partial config is
// preserved at docs/ai/paused-live-mode/vite.config.live.ts.txt.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
