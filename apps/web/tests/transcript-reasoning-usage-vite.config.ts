import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  cacheDir: '/private/tmp/rhythm-1553-reasoning-vite-cache',
  plugins: [react()],
});
