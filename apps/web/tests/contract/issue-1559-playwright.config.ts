import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'issue-1559.spec.ts', workers: 1, outputDir: 'test-results',
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: 'http://127.0.0.1:5673', bypassCSP: true, serviceWorkers: 'block' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:5698 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:5697 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:5698 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:5697 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=issue-1559-disposable npm run dev -- --host 127.0.0.1 --port 5673',
    url: 'http://127.0.0.1:5673', reuseExistingServer: false, timeout: 60_000,
  },
});
