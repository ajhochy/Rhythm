import { defineConfig } from '@playwright/test';

const projectRoot = '/Users/ajhochhalter/Library/Application Support/Open Design/namespaces/release-stable/data/projects/fc0be6da-6e7a-4650-aa68-3bd044a0712c/rhythm-desktop-agents';

// The paused live-mode contract only runs when RHYTHM_LIVE_E2E=1 is set explicitly.
const pausedLiveSpecs = process.env.RHYTHM_LIVE_E2E === '1' ? [] : ['**/issue-0-live-mode.spec.ts'];

export default defineConfig({
  testDir: '.',
  testIgnore: pausedLiveSpecs,
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: {
    browserName: 'chromium',
    launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    baseURL: 'http://127.0.0.1:4385',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Los_Angeles',
    locale: 'en-US',
    colorScheme: 'dark',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 4385',
      cwd: projectRoot,
      url: 'http://127.0.0.1:4385',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'RHYTHM_DIST_PORT=4186 node tests/serve-dist.mjs',
      cwd: projectRoot,
      url: 'http://127.0.0.1:4186/index.html',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
