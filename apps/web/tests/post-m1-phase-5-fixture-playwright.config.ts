import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: [
    'post-m1-phase-5-permissions.redspec.ts',
    'post-m1-phase-5-questions.redspec.ts',
    'post-m1-phase-5-approvals-delegation.redspec.ts',
    'post-m1-phase-5-catalogs-commands.redspec.ts',
    'post-m1-phase-5-gateways.redspec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    bypassCSP: true,
    browserName: 'chromium',
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
    colorScheme: 'light',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=phase-5-route-token npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
