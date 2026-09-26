import { defineConfig, devices } from '@playwright/test';

// Lane port block: 7550-7559 (rhythm-models-1580).
export default defineConfig({
  testDir: '.', testMatch: 'issue-1580-model-curation.spec.ts', workers: 1, outputDir: 'test-results',
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: 'http://127.0.0.1:7550', bypassCSP: true, serviceWorkers: 'block' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7551 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7552 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:7551 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:7552 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=issue-1580-disposable npm run dev -- --host 127.0.0.1 --port 7550',
    url: 'http://127.0.0.1:7550', reuseExistingServer: false, timeout: 60_000,
  },
});
