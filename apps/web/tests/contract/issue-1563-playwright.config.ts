import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'issue-1563.spec.ts', workers: 1, outputDir: 'test-results',
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:7260', bypassCSP: true, serviceWorkers: 'block' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7261 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7262 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:7261 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:7262 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=issue-1563-disposable npm run dev -- --host 127.0.0.1 --port 7260',
    url: 'http://127.0.0.1:7260', reuseExistingServer: false, timeout: 60_000,
  },
});
