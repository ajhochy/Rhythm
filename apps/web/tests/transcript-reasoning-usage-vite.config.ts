import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  cacheDir: '/private/tmp/rhythm-1553-reasoning-vite-cache',
  plugins: [react()],
  // Mirror the app config so package sources resolve the host React (see vite.config.ts).
  resolve: {
    alias: { '@ajhochy/rhythm-workspace-ui': fileURLToPath(new URL('../../../packages/rhythm-workspace-ui/src', import.meta.url)) },
    dedupe: ['react', 'react-dom', 'lucide-react'],
  },
});
