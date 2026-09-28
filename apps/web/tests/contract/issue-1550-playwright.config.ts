import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'issue-1550.spec.ts', workers: 1, timeout: 30_000, outputDir: 'test-results', reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:7263', bypassCSP: true, serviceWorkers: 'block' },
  webServer: [
    {
      command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7264 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7265 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:7264 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:7265 VITE_RHYTHM_PRODUCTION_API_BASE=https://issue1550.invalid VITE_RHYTHM_LIVE_TOKEN=issue-1550-disposable npm run dev -- --host 127.0.0.1 --port 7263 --strictPort',
      url: 'http://127.0.0.1:7263', reuseExistingServer: false, timeout: 60_000,
    },
    {
      command: 'VITE_RHYTHM_GATEWAY_MODE=fixture npm run dev -- --host 127.0.0.1 --port 7266 --strictPort',
      url: 'http://127.0.0.1:7266', reuseExistingServer: false, timeout: 60_000,
    },
  ],
});
