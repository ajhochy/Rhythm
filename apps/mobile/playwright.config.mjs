import { defineConfig, devices } from '@playwright/test';

function portFromEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be a TCP port`);
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be between 1024 and 65535`);
  }
  return port;
}

const fakePort = portFromEnv('PLAYWRIGHT_FAKE_PORT', 44096);
const webPort = portFromEnv('PLAYWRIGHT_WEB_PORT', 19006);
const fakeBaseUrl = `http://127.0.0.1:${fakePort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: webBaseUrl,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: [
    {
      command: 'node ./tests/fake-opencode/server.mjs',
      url: `${fakeBaseUrl}/path`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...process.env,
        FAKE_OPENCODE_PORT: String(fakePort),
      },
    },
    {
      command: `npm run build:web:ci -- --clear && serve -s dist-e2e -l ${webPort}`,
      url: webBaseUrl,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        CI: '1',
        EXPO_PUBLIC_E2E_MODE: '1',
        EXPO_PUBLIC_E2E_SERVER_URL: fakeBaseUrl,
      },
    },
  ],
});
