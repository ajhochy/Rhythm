import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from './post-m1-phase-7-fixture-playwright.config';

export default defineConfig({
  ...base,
  testMatch: ['regressions-manual-trigger.spec.ts'],
  use: { ...base.use, baseURL: 'http://127.0.0.1:5273' },
  webServer: {
    ...base.webServer,
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=phase-7-route-token npm run dev -- --host 127.0.0.1 --port 5273 --strictPort',
    url: 'http://127.0.0.1:5273',
    reuseExistingServer: false,
  },
});
