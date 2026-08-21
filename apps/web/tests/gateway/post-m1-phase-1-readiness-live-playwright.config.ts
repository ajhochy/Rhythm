import { defineConfig, devices } from '@playwright/test';
import { liveEnvironment } from '../live-environment';

const { apiBase, engineBase, productionApiBase } = liveEnvironment();

export default defineConfig({
  testDir: '.',
  testMatch: 'post-m1-phase-1-readiness.live.redspec.ts',
  workers: 1,
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4175',
    viewport: { width: 1440, height: 900 },
    bypassCSP: true,
  },
  webServer: {
    command: `VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=${apiBase} VITE_RHYTHM_EXPECTED_API_BASE=${apiBase} VITE_RHYTHM_ENGINE_BASE=${engineBase} VITE_RHYTHM_EXPECTED_ENGINE_BASE=${engineBase} VITE_RHYTHM_PRODUCTION_API_BASE=${productionApiBase} VITE_RHYTHM_LIVE_TOKEN=$RHYTHM_LIVE_TOKEN npm run dev -- --host 127.0.0.1 --port 4175`,
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
