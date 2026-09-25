import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.RHYTHM_E2E_PORT ?? 7280);

export default defineConfig({
  testDir: '.',
  testMatch: 'colony-rail.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: `http://127.0.0.1:${port}`,
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    serviceWorkers: 'block',
  },
  webServer: {
    command: `npm run dev -- --config tests/pages/colony-vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
