import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['post-m1-phase-3-live-pages.redspec.ts', 'post-m1-phase-3-selection-reload.redspec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4176', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_LIVE_TOKEN=post-m1-phase-3-disposable npm run dev -- --host 127.0.0.1 --port 4176',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
