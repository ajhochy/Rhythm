import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'bucket-a-rendered-repair.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4181',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4180',
      url: 'http://127.0.0.1:4180',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=bucket-a-rendered-disposable npm run dev -- --host 127.0.0.1 --port 4181',
      url: 'http://127.0.0.1:4181',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
