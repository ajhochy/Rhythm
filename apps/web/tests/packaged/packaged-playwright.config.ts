import { defineConfig } from '@playwright/test';

// One packaged app per run; tests share it serially. No webServer: the app is the server.
export default defineConfig({
  testDir: '.',
  testMatch: 'packaged-*.spec.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../../playwright-report/packaged' }]],
  outputDir: '../../test-results/packaged',
  use: { actionTimeout: 15_000, navigationTimeout: 30_000, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
