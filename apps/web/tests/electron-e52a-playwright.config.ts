import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'electron-e52a-transcript.spec.ts', workers: 1,
  timeout: 20000, expect: { timeout: 3000 }, reporter: [['line']],
  outputDir: '../../../docs/ai/runs/artifacts/e52a/results',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4185', bypassCSP: true },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4199 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4199 VITE_RHYTHM_PRODUCTION_API_BASE=https://e52a.invalid VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_LIVE_TOKEN=e52a-public-test npm run dev -- --host 127.0.0.1 --port 4185 --strictPort',
    url: 'http://127.0.0.1:4185', reuseExistingServer: false,
  },
});
