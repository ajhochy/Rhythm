import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: '.', testMatch: 'electron-e25b-inspector.spec.ts', workers: 1,
  timeout: 20000, expect: { timeout: 3000 }, reporter: 'line',
  outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e25b-results',
  use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 }, baseURL: 'http://127.0.0.1:4193' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4199 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4197 VITE_RHYTHM_PRODUCTION_API_BASE=https://e25b.invalid VITE_RHYTHM_LIVE_TOKEN=e25b-synthetic npm run dev -- --host 127.0.0.1 --port 4193 --strictPort',
    url: 'http://127.0.0.1:4193', reuseExistingServer: false,
  },
});
