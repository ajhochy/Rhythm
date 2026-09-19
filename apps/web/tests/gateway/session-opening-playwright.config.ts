import { defineConfig, devices } from '@playwright/test';
// Network is entirely intercepted; the source HTML CSP pins shipping ports.
// The opt-in native test exercises the real host's protocol and sandbox-port CSP.
export default defineConfig({
  testDir: '.', testMatch: ['session-opening.spec.ts', 'agent-session-link.spec.ts'], workers: 1, fullyParallel: false,
  timeout: 20_000, expect: { timeout: 5_000 }, reporter: [['line']],
  use: { ...devices['Desktop Chrome'], browserName: 'chromium', channel: 'chrome', bypassCSP: true, baseURL: 'http://127.0.0.1:4615', viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com npm run dev -- --host 127.0.0.1 --port 4615', url: 'http://127.0.0.1:4615', reuseExistingServer: false, timeout: 30_000 },
});
