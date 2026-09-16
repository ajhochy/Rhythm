import { defineConfig, devices } from '@playwright/test';
const live = process.env.RHYTHM_LIVE_E2E === '1';
export default defineConfig({
  testDir: '.', testMatch: live ? 'electron-e25a-live.spec.ts' : 'electron-e25a-transcript.spec.ts', workers: 1,
  timeout: 20000, expect: { timeout: 3000 }, reporter: 'line',
  outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e25a-results',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4192', permissions: ['clipboard-read', 'clipboard-write'], launchOptions: live ? { args: ['--disable-web-security'] } : {}, extraHTTPHeaders: live ? { Origin: 'http://127.0.0.1:4175' } : {} },
  webServer: {
    command: `VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:${live ? 4098 : 4199} VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:${live ? 4097 : 4197} VITE_RHYTHM_PRODUCTION_API_BASE=https://e25a.invalid VITE_RHYTHM_LIVE_TOKEN=e25a-synthetic npm run dev -- --host 127.0.0.1 --port 4192 --strictPort`,
    url: 'http://127.0.0.1:4192', reuseExistingServer: false,
  },
});
