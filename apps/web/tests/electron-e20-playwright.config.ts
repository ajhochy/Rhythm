import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'electron-e20-session-ordering.spec.ts', workers: 1,
  timeout: 15000, expect: { timeout: 3000 }, reporter: [['line']],
  outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e20-results',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4186', bypassCSP: true },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4199 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4199 VITE_RHYTHM_PRODUCTION_API_BASE=https://e20.invalid VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_LIVE_TOKEN=e20-public-test npm run dev -- --host 127.0.0.1 --port 4186',
    url: 'http://127.0.0.1:4186', reuseExistingServer: false,
  },
});
