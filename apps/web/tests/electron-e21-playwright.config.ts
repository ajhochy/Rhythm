import { defineConfig, devices } from '@playwright/test';
const live = process.env.RHYTHM_LIVE_E2E === '1';
const api = live ? Number(process.env.RHYTHM_SANDBOX_API_PORT ?? 4098) : 4199;
const engine = live ? Number(process.env.RHYTHM_SANDBOX_ENGINE_PORT ?? 4097) : 4197;
export default defineConfig({
  testDir: '.', testMatch: live ? 'electron-e21-live.spec.ts' : 'electron-e21-reconciliation.spec.ts', workers: 1,
  timeout: 30000, expect: { timeout: 5000 }, reporter: [['line']],
  outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e21-results',
  // Unique test renderer is not on the manager-owned API CORS allowlist. No server changes.
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4187', bypassCSP: true, launchOptions: live ? { args: ['--disable-web-security'] } : {}, extraHTTPHeaders: live ? { Origin: 'http://127.0.0.1:4175' } : {} },
  webServer: {
    command: `VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:${api} VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:${engine} VITE_RHYTHM_PRODUCTION_API_BASE=https://e21.invalid VITE_RHYTHM_LIVE_TOKEN=e02-synthetic-session-not-a-secret npm run dev -- --host 127.0.0.1 --port 4187 --strictPort`,
    url: 'http://127.0.0.1:4187', reuseExistingServer: false,
  },
});
