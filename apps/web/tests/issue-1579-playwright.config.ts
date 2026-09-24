import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'issue-1579-notifications.spec.ts', workers: 1,
  timeout: 20000, expect: { timeout: 3000 }, reporter: [['line']],
  outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/issue-1579-results',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:6389' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:6388 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:6387 VITE_RHYTHM_PRODUCTION_API_BASE=https://issue1579.invalid VITE_RHYTHM_LIVE_TOKEN=synthetic-not-secret npm run dev -- --host 127.0.0.1 --port 6389 --strictPort',
    url: 'http://127.0.0.1:6389', reuseExistingServer: false,
  },
});
