import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  cacheDir: '/private/tmp/rhythm-colony-vite-cache-7280',
  plugins: [react()],
});
