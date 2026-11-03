import { defineConfig, devices } from '@playwright/test';

// Dedicated opt-in suite. It never launches an API, engine, app or dev server.
const origin = process.env.RHYTHM_WEB_PUBLIC_ORIGIN ?? 'http://rhythm-web.test:4001';
export default defineConfig({
  testDir: '.', testMatch: 'real-account.spec.ts', workers: 1, retries: 0,
  maxFailures: 1, timeout: 90_000, reporter: 'line',
  use: { ...devices['Desktop Chrome'], baseURL: origin,
    launchOptions: { args: [`--host-resolver-rules=MAP ${new URL(origin).hostname} 127.0.0.1`] },
    // Real account pages can contain unrelated private records. Never retain them.
    trace: 'off', screenshot: 'off', video: 'off', serviceWorkers: 'block',
  },
});
