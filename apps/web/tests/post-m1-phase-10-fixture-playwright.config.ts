import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'post-m1-phase-10-route-states.redspec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4379', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4379',
    url: 'http://127.0.0.1:4379',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
