import { defineConfig, devices } from '@playwright/test';

// The sandbox is operator-owned. Never start a backend or Vite from Playwright.
export default defineConfig({
  testDir: '.', testMatch: 'web-host-*.spec.ts', workers: 1, retries: 0,
  timeout: 60_000, reporter: 'line',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4098',
    trace: 'retain-on-failure', viewport: { width: 1440, height: 900 } },
});
