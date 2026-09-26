import { defineConfig } from '@playwright/test';
import liveConfig from './gateway/live-playwright.config';
import { liveEnvironment } from './live-environment';

const environment = liveEnvironment({
  ...process.env,
  RHYTHM_LIVE_API_URL: process.env.RHYTHM_LIVE_API_URL ?? 'http://127.0.0.1:4098',
  RHYTHM_LIVE_ENGINE_URL: process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097',
});

export default defineConfig({
  ...liveConfig,
  testDir: './live',
  testMatch: 'mega-2026-09-18-smoke.spec.ts',
  fullyParallel: false,
  preserveOutput: 'never',
  use: {
    ...liveConfig.use,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: [
      'VITE_RHYTHM_GATEWAY_MODE=live',
      `VITE_RHYTHM_API_BASE=${environment.apiBase}`,
      `VITE_RHYTHM_ENGINE_BASE=${environment.engineBase}`,
      `VITE_RHYTHM_EXPECTED_API_BASE=${environment.apiBase}`,
      `VITE_RHYTHM_EXPECTED_ENGINE_BASE=${environment.engineBase}`,
      `VITE_RHYTHM_PRODUCTION_API_BASE=${environment.productionApiBase}`,
      'VITE_RHYTHM_LIVE_TOKEN="$RHYTHM_LIVE_TOKEN"',
      'npm run dev -- --host 127.0.0.1 --port 4175',
    ].join(' '),
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
