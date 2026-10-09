import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'attachment-composer-limit.spec.ts',
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL as 'chrome' | undefined,
    baseURL: 'http://127.0.0.1:4592',
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live npm run dev -- --host 127.0.0.1 --port 4592 --strictPort',
    url: 'http://127.0.0.1:4592',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
