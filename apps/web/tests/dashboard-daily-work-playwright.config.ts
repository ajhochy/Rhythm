import { defineConfig, devices } from '@playwright/test';

const mode = process.env.DASHBOARD_CHECK;
const port = mode === 'artifacts' ? 4178 : 4286;
export default defineConfig({
  testDir: '.',
  testMatch: mode === 'artifacts' ? ['post-m1-phase-8-live-artifacts.redspec.ts', 'post-m1-phase-8-html-import.redspec.ts', 'gateway/post-m1-phase-8-live-artifacts.live.redspec.ts', 'gateway/post-m1-phase-8-html-import.live.redspec.ts'] : mode === 'fixture' ? ['pages/dashboard.spec.ts', 'contract/issue-2001-dashboard.spec.ts'] : mode === 'live' ? 'contract/daily-work-dashboard-live-20260912.spec.ts' : 'contract/daily-work-dashboard-20260912.spec.ts',
  outputDir: `/private/tmp/rhythm-daily-work-dashboard-${mode ?? 'contract'}-results`,
  workers: 1,
  timeout: 30_000,
  reporter: 'line',
  use: {
    ...devices['Desktop Chrome'], channel: 'chrome',
    baseURL: `http://127.0.0.1:${port}`, viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Los_Angeles', locale: 'en-US',
    // Alternate intercepted origins are outside the packaged CSP; phase-8 owns CSP proof.
    bypassCSP: true, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure',
  },
  webServer: process.env.DASHBOARD_OWNED_RENDERER === '1' ? undefined : {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4287 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4288 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4287 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4288 VITE_RHYTHM_PRODUCTION_API_BASE=https://design-fixture.invalid npm run dev -- --host 127.0.0.1 --port 4286 --strictPort',
    url: 'http://127.0.0.1:4286', reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
