import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'electron-e34a-import.spec.ts', workers: 1,
  timeout: 20000, expect: { timeout: 3000 }, reporter: 'line',
  outputDir: '../../../docs/ai/runs/artifacts/e34a/results',
  // Test-only: index.html pins the deployed hostname; use an inert hostname instead.
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 }, baseURL: 'http://127.0.0.1:4195', serviceWorkers: 'block', bypassCSP: true },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4001 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4096 VITE_RHYTHM_PRODUCTION_API_BASE=https://e34a.invalid VITE_RHYTHM_LIVE_TOKEN=e34a-synthetic npm run dev -- --host 127.0.0.1 --port 4195 --strictPort',
    url: 'http://127.0.0.1:4195', reuseExistingServer: false,
  },
});
