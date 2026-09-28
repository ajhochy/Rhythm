import { defineConfig, devices } from '@playwright/test';

// Standalone live-mode config for transcript-attachment-thumbnails.spec.ts, modeled on
// post-m1-phase-4-live-playwright.config.ts. Own ports (4176/4198/4197) so it never collides
// with that suite when both run standalone.
export default defineConfig({
  testDir: '.',
  testMatch: 'transcript-attachment-thumbnails.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    bypassCSP: true,
    browserName: 'chromium',
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:4176',
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4198 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4198 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=thumbnails-contract-token npm run dev -- --host 127.0.0.1 --port 4176',
    url: 'http://127.0.0.1:4176',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
