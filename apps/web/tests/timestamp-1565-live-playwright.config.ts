import { defineConfig, devices } from '@playwright/test';

const api = 'http://127.0.0.1:6598';
const engine = 'http://127.0.0.1:6597';
const token = 'e02-synthetic-session-not-a-secret';
if (process.env.RHYTHM_LIVE_E2E !== '1' || process.env.RHYTHM_LIVE_API_URL !== api || process.env.RHYTHM_LIVE_ENGINE_URL !== engine) {
  throw new Error('Timestamp live probe requires RHYTHM_LIVE_E2E=1 and exact isolated API :6598 / engine :6597 URLs');
}

export default defineConfig({
  testDir: '.', testMatch: 'timestamp-1565.live.spec.ts', workers: 1,
  outputDir: '/private/tmp/rhythm-1565-playwright-output',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4175', locale: 'en-US', timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175 --strictPort',
    env: { VITE_RHYTHM_GATEWAY_MODE: 'live', VITE_RHYTHM_API_BASE: api, VITE_RHYTHM_ENGINE_BASE: engine, VITE_RHYTHM_EXPECTED_API_BASE: api, VITE_RHYTHM_EXPECTED_ENGINE_BASE: engine, VITE_RHYTHM_PRODUCTION_API_BASE: 'https://timestamp-test.invalid', VITE_RHYTHM_LIVE_TOKEN: token },
    url: 'http://127.0.0.1:4175', reuseExistingServer: false, timeout: 30_000,
  },
});
