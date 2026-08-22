import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: [
    'post-m1-phase-7-memory.redspec.ts',
    'post-m1-phase-7-research-gallery.redspec.ts',
    'post-m1-phase-7-playbooks-cookbook.redspec.ts',
    'post-m1-phase-7-schedules-quality.redspec.ts',
    'post-m1-phase-7-notifications.redspec.ts',
    'post-m1-phase-7-approvals.redspec.ts',
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
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
    colorScheme: 'light',
    serviceWorkers: 'block',
    bypassCSP: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=http://127.0.0.1:4198 VITE_RHYTHM_LIVE_TOKEN=phase-7-route-token npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
