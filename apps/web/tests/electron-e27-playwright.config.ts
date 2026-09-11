import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: /electron-e27-pty(-live)?\.spec\.ts/, workers: 1,
  timeout: 25_000, expect: { timeout: 4000 }, reporter: [['line']],
  outputDir: '../../../docs/ai/runs/artifacts/e27',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4184', bypassCSP: true },
  webServer: process.env.RHYTHM_LIVE_E2E === '1' ? undefined : {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4199 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4199 VITE_RHYTHM_PRODUCTION_API_BASE=https://e27.invalid VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_LIVE_TOKEN=e27-public-test npm run dev -- --host 127.0.0.1 --port 4184 --strictPort',
    url: 'http://127.0.0.1:4184', reuseExistingServer: false,
  },
});
