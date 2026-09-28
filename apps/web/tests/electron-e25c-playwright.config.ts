import { defineConfig } from '@playwright/test';
import previous from './electron-e25b-playwright.config';
export default defineConfig({
  ...previous,
  testMatch: 'electron-e25c-sharing.spec.ts',
  // Vite compiles the large Agents surface on the first navigation. Keep the
  // behavioral expectations tight while allowing that one cold compile.
  timeout: 40_000,
  outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e25c-results',
  use: { ...previous.use, baseURL: 'http://127.0.0.1:7430' },
  webServer: {
    ...previous.webServer,
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4199 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_PRODUCTION_API_BASE=https://e25b.invalid VITE_RHYTHM_LIVE_TOKEN=e25b-synthetic npm run dev -- --host 127.0.0.1 --port 7430 --strictPort',
    url: 'http://127.0.0.1:7430',
  },
});
