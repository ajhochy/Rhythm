import { defineConfig } from '@playwright/test';
import base from './regressions-manual-trigger-playwright.config';

export default defineConfig({
  ...base,
  testMatch: ['c1-live-reconnect.spec.ts'],
  timeout: 180_000,
  // The owned sandbox allowlists this renderer origin for both API and engine.
  use: { ...base.use, baseURL: 'http://127.0.0.1:4175', actionTimeout: 15_000 },
  expect: { timeout: 15_000 },
  webServer: {
    ...base.webServer,
    url: 'http://127.0.0.1:4175',
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://c1-sandbox.invalid VITE_RHYTHM_LIVE_TOKEN=e02-synthetic-session-not-a-secret npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
  },
});
