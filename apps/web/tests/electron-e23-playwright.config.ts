import { defineConfig, devices } from '@playwright/test';
const live = process.env.RHYTHM_LIVE_E2E === '1';
export default defineConfig({
  testDir: '.', testMatch: 'electron-e23-lifecycle.spec.ts', workers: 1,
  grep: live ? /E23-c11/ : undefined,
  timeout: 20000, expect: { timeout: 3000 }, reporter: [['line']],
  outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e23-results',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4190', launchOptions: live ? { args: ['--disable-web-security'] } : {}, extraHTTPHeaders: live ? { Origin: 'http://127.0.0.1:4175' } : {} },
  webServer: {
    command: `VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:${live ? 4098 : 4199} VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:${live ? 4097 : 4197} VITE_RHYTHM_PRODUCTION_API_BASE=https://e23.invalid VITE_RHYTHM_LIVE_TOKEN=e23-synthetic-not-a-secret npm run dev -- --host 127.0.0.1 --port 4190 --strictPort`,
    url: 'http://127.0.0.1:4190', reuseExistingServer: false,
  },
});
