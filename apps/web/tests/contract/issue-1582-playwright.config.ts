import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['issue-1582.spec.ts', 'issue-1582-lifecycle.spec.ts', 'issue-1582-reasoning.spec.ts'],
  workers: 1,
  timeout: 20000,
  expect: { timeout: 3000 },
  reporter: [['line']],
  outputDir: '/private/tmp/rhythm-repair4/1582-playwright-results',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:6831', bypassCSP: true },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:6832 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:6832 VITE_RHYTHM_PRODUCTION_API_BASE=https://issue-1582.invalid VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:6833 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:6833 VITE_RHYTHM_LIVE_TOKEN=issue-1582-fixture-token npm run dev -- --host 127.0.0.1 --port 6831 --strictPort',
    url: 'http://127.0.0.1:6831',
    reuseExistingServer: false,
  },
});
