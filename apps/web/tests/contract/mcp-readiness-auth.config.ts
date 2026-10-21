import { defineConfig, devices } from '@playwright/test';

// Browser-only renderer contract: all API/engine requests are intercepted in the spec.
export default defineConfig({
  testDir: '.', testMatch: 'mcp-readiness-auth.spec.ts', workers: 1,
  outputDir: 'test-results/mcp-readiness-auth', reporter: [['line']],
  use: { ...devices['Desktop Chrome'], channel: 'chrome', baseURL: 'http://127.0.0.1:7593', serviceWorkers: 'block' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7594 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7595 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com npm run dev -- --host 127.0.0.1 --port 7593',
    url: 'http://127.0.0.1:7593', reuseExistingServer: false, timeout: 60_000,
  },
});
