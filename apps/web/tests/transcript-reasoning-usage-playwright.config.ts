import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'electron-e25a-reasoning-usage.spec.ts',
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 3_000 },
  reporter: 'line',
  outputDir: '/private/tmp/rhythm-1553-reasoning-playwright-results',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:7110' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7111 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7112 VITE_RHYTHM_PRODUCTION_API_BASE=https://transcript.invalid VITE_RHYTHM_LIVE_TOKEN=transcript-synthetic npm run dev -- --config tests/transcript-reasoning-usage-vite.config.ts --host 127.0.0.1 --port 7110 --strictPort',
    url: 'http://127.0.0.1:7110',
    reuseExistingServer: false,
  },
});
