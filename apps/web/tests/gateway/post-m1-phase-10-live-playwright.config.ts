import { defineConfig, devices } from '@playwright/test';

// Scoped, in this unit, to the Phase 10 criteria actually implemented here (post-m1-p10-c5g,
// Automations). Other Phase 10 live criteria (c2a-c2e, c5a-c5f, c5h, c6a) remain pending and are not
// stubbed into this config — see docs/ai/contracts/post-m1-phase-10.json.
export default defineConfig({
  testDir: '.',
  testMatch: 'post-m1-phase-10-route-capabilities.live.redspec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4181', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_LIVE_TOKEN=post-m1-phase-10-disposable npm run dev -- --host 127.0.0.1 --port 4181',
    url: 'http://127.0.0.1:4181',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
