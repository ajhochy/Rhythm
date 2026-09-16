import { defineConfig } from '@playwright/test';
import { liveEnvironment } from './live-environment';

const { apiBase, engineBase } = liveEnvironment({
  RHYTHM_LIVE_API_URL: process.env.RHYTHM_LIVE_API_URL,
  RHYTHM_LIVE_ENGINE_URL: process.env.RHYTHM_LIVE_ENGINE_URL,
});
const gatewayBase = new URL(process.env.RHYTHM_LIVE_GATEWAY_URL ?? '').origin;
if (process.env.RHYTHM_LIVE_GATEWAY_URL !== gatewayBase || !gatewayBase.startsWith('http://127.0.0.1:')) throw new Error('RHYTHM_LIVE_GATEWAY_URL must be an assigned loopback base');

export default defineConfig({
  testDir: './contract', testMatch: 'daily-work-tasks-live-20260912.spec.ts',
  workers: 1, timeout: 45_000, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:4175', viewport: { width: 1440, height: 900 }, bypassCSP: true, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: `VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=${apiBase} VITE_RHYTHM_ENGINE_BASE=${engineBase} VITE_RHYTHM_EXPECTED_API_BASE=${apiBase} VITE_RHYTHM_EXPECTED_ENGINE_BASE=${engineBase} VITE_RHYTHM_PRODUCTION_API_BASE=https://tasks-live.invalid npm run dev -- --host 127.0.0.1 --port 4175 --strictPort`,
    url: 'http://127.0.0.1:4175', reuseExistingServer: false,
  },
});
