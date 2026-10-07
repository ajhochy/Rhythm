import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  projects: [
    { name: 'presentation', testMatch: 'notification-presentation.spec.ts' },
    // Existing E1 fixtures use alternate loopback ports, as their original harness does.
    { name: 'legacy-e1', testMatch: 'e1-approval-queue.spec.ts', use: { bypassCSP: true } },
  ],
  workers: 1, fullyParallel: false, timeout: 20_000, reporter: [['line']],
  outputDir: '../../../notification-test-results',
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: 'http://127.0.0.1:5417', viewport: { width: 1392, height: 912 }, timezoneId: 'America/Los_Angeles', locale: 'en-US', serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=synthetic-presentation-token npm run dev -- --host 127.0.0.1 --port 5417 --strictPort',
    url: 'http://127.0.0.1:5417', reuseExistingServer: false, timeout: 30_000,
  },
});
