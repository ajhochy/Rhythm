import { defineConfig, devices } from '@playwright/test';

const run = process.env.RHYTHM_LIVE_E2E === '1';
const apiBase = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4098';
const engineBase = process.env.RHYTHM_LIVE_ENGINE_URL ?? 'http://127.0.0.1:4097';
const origin = 'http://127.0.0.1:4175';

export default defineConfig({
  testDir: '.', testMatch: 'e1-approval-queue-live.spec.ts', workers: 1,
  timeout: 45_000, expect: { timeout: 15_000 }, reporter: 'line',
  outputDir: '../test-results/e1-approval-queue-live',
  // Vite's static CSP names shipping ports; this synthetic sandbox uses 4098/4097.
  // Packaged native CSP is a separate gate. HTTP is still real and unintercepted.
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: origin, serviceWorkers: 'block', bypassCSP: true, actionTimeout: 15_000, trace: 'retain-on-failure' },
  // Playwright may initialize webServer even for skipped tests. No live flag means no listener.
  webServer: run ? {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
    url: origin, reuseExistingServer: false,
    env: {
      VITE_RHYTHM_GATEWAY_MODE: 'live',
      VITE_RHYTHM_API_BASE: apiBase,
      VITE_RHYTHM_ENGINE_BASE: engineBase,
      VITE_RHYTHM_EXPECTED_API_BASE: apiBase,
      VITE_RHYTHM_EXPECTED_ENGINE_BASE: engineBase,
      VITE_RHYTHM_PRODUCTION_API_BASE: 'https://e1-sandbox.invalid',
      VITE_RHYTHM_LIVE_TOKEN: 'e02-synthetic-session-not-a-secret',
    },
  } : undefined,
});
