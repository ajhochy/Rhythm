import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'post-m1-phase-1-readiness.live.redspec.ts',
  workers: 1,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4375',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_LIVE_TOKEN=$RHYTHM_LIVE_TOKEN npm run dev -- --host 127.0.0.1 --port 4375',
    url: 'http://127.0.0.1:4375',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
