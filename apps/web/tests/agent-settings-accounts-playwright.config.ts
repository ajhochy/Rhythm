import { defineConfig, devices } from '@playwright/test';

// The "Agent Settings live persistence" block in pages/agent-settings-list-inspector.spec.ts
// intercepts the local API boundary, so it needs a live-gateway dev server; the default
// suite serves fixture mode and skips the block. Run it with:
//   RHYTHM_LIVE_E2E=1 npx playwright test --config tests/agent-settings-accounts-playwright.config.ts
export default defineConfig({
  testDir: '.',
  testMatch: ['pages/agent-settings-list-inspector.spec.ts'],
  // The fixture-mode block in the same file needs the default config's fixture server.
  grep: /Agent Settings live persistence/,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    bypassCSP: true,
    browserName: 'chromium',
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
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=agent-settings-accounts-token npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
