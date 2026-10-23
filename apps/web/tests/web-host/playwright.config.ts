import { defineConfig, devices } from '@playwright/test';

// The sandbox is operator-owned. Never start a backend or Vite from Playwright.
const origin = process.env.RHYTHM_WEB_PUBLIC_ORIGIN ?? 'http://rhythm-web.test:4098';
export default defineConfig({
  testDir: '.', testMatch: 'web-host-*.spec.ts', workers: 1, retries: 0,
  timeout: 60_000, reporter: 'line',
  use: { ...devices['Desktop Chrome'], baseURL: origin,
    launchOptions: { args: [`--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`, `--unsafely-treat-insecure-origin-as-secure=${origin}`] },
    trace: 'on', screenshot: 'only-on-failure', viewport: { width: 1440, height: 900 } },
});
