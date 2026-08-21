import { defineConfig, devices } from '@playwright/test';

// The paused live-mode contract only runs when RHYTHM_LIVE_E2E=1 is set explicitly.
const pausedLiveSpecs = process.env.RHYTHM_LIVE_E2E === '1' ? [] : [
  '**/issue-0-live-mode.spec.ts',
  '**/invalid-live.spec.ts',
];

export default defineConfig({
  testDir: './tests',
  testIgnore: ['electron/**', '**/bucket-a-rendered-repair.spec.ts', ...pausedLiveSpecs],
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
    colorScheme: 'light',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node tests/serve-dist.mjs',
      url: 'http://127.0.0.1:4174/index.html',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
