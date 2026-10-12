import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (!executablePath) throw new Error('PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH is required for the isolated Dayflow desktop fixture.');

export default defineConfig({
  testDir: '.',
  testMatch: 'dayflow-desktop.spec.ts',
  workers: 1,
  timeout: 20_000,
  use: {
    ...devices['Desktop Chrome'],
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: { executablePath, args: ['--no-first-run', '--no-default-browser-check'] },
  },
});
