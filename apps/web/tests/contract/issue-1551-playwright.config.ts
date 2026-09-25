import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'issue-1551.spec.ts', workers: 1, timeout: 30_000, outputDir: 'test-results', reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:7267', bypassCSP: true, serviceWorkers: 'block' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7268 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7269 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:7268 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:7269 VITE_RHYTHM_PRODUCTION_API_BASE=https://issue1551.invalid VITE_RHYTHM_LIVE_TOKEN=issue-1551-disposable npm run dev -- --host 127.0.0.1 --port 7267 --strictPort',
    url: 'http://127.0.0.1:7267', reuseExistingServer: false, timeout: 60_000,
  },
});
