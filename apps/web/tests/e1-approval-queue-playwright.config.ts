import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'e1-approval-queue.spec.ts', workers: 1,
  timeout: 20_000, expect: { timeout: 5_000 }, reporter: 'line',
  outputDir: '../test-results/e1-approval-queue',
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: 'http://127.0.0.1:5281', serviceWorkers: 'block', bypassCSP: true, trace: 'retain-on-failure' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=e1-synthetic-only npm run dev -- --host 127.0.0.1 --port 5281 --strictPort',
    url: 'http://127.0.0.1:5281', reuseExistingServer: false,
  },
});
