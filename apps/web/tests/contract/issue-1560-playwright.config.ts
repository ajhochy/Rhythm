import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'issue-1560.spec.ts', workers: 1, outputDir: 'test-results',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:7166', viewport: { width: 1440, height: 900 }, bypassCSP: true, serviceWorkers: 'block' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7164 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7165 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:7164 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:7165 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=issue-1560-disposable npm run dev -- --host 127.0.0.1 --port 7166',
    port: 7166, reuseExistingServer: false,
  },
});
