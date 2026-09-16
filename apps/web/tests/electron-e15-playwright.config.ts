import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'electron-e15-facilities-safety.spec.ts', workers: 1,
  reporter: [['line']], use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4180' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=e15-disposable npm run dev -- --host 127.0.0.1 --port 4180',
    url: 'http://127.0.0.1:4180', reuseExistingServer: false,
  },
});
