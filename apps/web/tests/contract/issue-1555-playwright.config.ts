import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'issue-1555.spec.ts', workers: 1, timeout: 30_000, outputDir: 'test-results', reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:7440', bypassCSP: true, serviceWorkers: 'block' },
  webServer: [
    {
      command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7441 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7442 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:7441 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:7442 VITE_RHYTHM_PRODUCTION_API_BASE=https://issue1555.invalid VITE_RHYTHM_LIVE_TOKEN=issue-1555-disposable npm run dev -- --host 127.0.0.1 --port 7440 --strictPort',
      url: 'http://127.0.0.1:7440', reuseExistingServer: false, timeout: 60_000,
    },
    {
      command: 'VITE_RHYTHM_GATEWAY_MODE=fixture npm run dev -- --host 127.0.0.1 --port 7443 --strictPort',
      url: 'http://127.0.0.1:7443', reuseExistingServer: false, timeout: 60_000,
    },
  ],
});
