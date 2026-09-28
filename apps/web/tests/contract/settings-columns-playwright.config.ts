import { defineConfig, devices } from '@playwright/test';

// Lane port block: 7590-7592 (settings column browser, live gateway with intercepted API).
export default defineConfig({
  testDir: '.', testMatch: 'settings-columns-live.spec.ts', workers: 1, outputDir: 'test-results',
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: 'http://127.0.0.1:7590', bypassCSP: true, serviceWorkers: 'block' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7591 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7592 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:7591 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:7592 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=settings-columns-disposable npm run dev -- --host 127.0.0.1 --port 7590',
    url: 'http://127.0.0.1:7590', reuseExistingServer: false, timeout: 60_000,
  },
});
