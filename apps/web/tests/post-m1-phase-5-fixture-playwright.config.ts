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
    browserName: 'chromium',
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:4373',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
    colorScheme: 'light',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_LIVE_TOKEN=phase-5-route-token npm run dev -- --host 127.0.0.1 --port 4373',
    url: 'http://127.0.0.1:4373',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
