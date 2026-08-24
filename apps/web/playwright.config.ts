import { defineConfig, devices } from '@playwright/test';

// The paused live-mode contract only runs when RHYTHM_LIVE_E2E=1 is set explicitly.
const pausedLiveSpecs = process.env.RHYTHM_LIVE_E2E === '1' ? [] : [
  '**/issue-0-live-mode.spec.ts',
  '**/invalid-live.spec.ts',
];
const e2ePort = Number(process.env.RHYTHM_E2E_PORT ?? 4173);
const distPort = Number(process.env.RHYTHM_DIST_PORT ?? e2ePort + 1);

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
    baseURL: `http://127.0.0.1:${e2ePort}`,
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
      command: `npm run dev -- --host 127.0.0.1 --port ${e2ePort}`,
      url: `http://127.0.0.1:${e2ePort}`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `RHYTHM_DIST_PORT=${distPort} node tests/serve-dist.mjs`,
      url: `http://127.0.0.1:${distPort}/index.html`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
