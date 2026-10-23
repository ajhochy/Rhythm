import { defineConfig, devices } from '@playwright/test';

if (process.env.RHYTHM_LIVE_E2E !== '1' ||
  process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
  process.env.RHYTHM_M1_LIVE_BROWSER !== '1' ||
  process.env.RHYTHM_LIVE_URL !== 'http://127.0.0.1:4098' ||
  process.env.RHYTHM_LIVE_ENGINE_URL !== 'http://127.0.0.1:4097' ||
  process.env.RHYTHM_LIVE_GATEWAY_URL !== 'http://127.0.0.1:4099' ||
  !process.env.RHYTHM_LIVE_DB_PATH?.startsWith('/private/tmp/') ||
  !process.env.RHYTHM_SANDBOX_DIR?.startsWith('/private/tmp/')) {
  throw new Error('M1 live browser proof requires the approved isolated loopback sandbox.');
}

const fakePort = 44137;
const webPort = 4175;
const fakeBaseUrl = `http://127.0.0.1:${fakePort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'm1-live-sandbox.spec.mjs',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: webBaseUrl,
    // Native Device clients do not enforce web CORS. This browser-only gate
    // uses the sandbox's real Device gateway directly from the E2E web bundle.
    launchOptions: { args: ['--disable-web-security'] },
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'node ./tests/fake-opencode/server.mjs',
      url: `${fakeBaseUrl}/path`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { ...process.env, FAKE_OPENCODE_PORT: String(fakePort) },
    },
    {
      command: `npm run build:web:ci -- --clear && serve -s dist-e2e -l ${webPort}`,
      url: webBaseUrl,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        CI: '1',
        EXPO_APP_VARIANT: 'development',
        EXPO_PUBLIC_E2E_MODE: '1',
        EXPO_PUBLIC_E2E_LIVE_M1: '1',
        EXPO_PUBLIC_E2E_SERVER_URL: fakeBaseUrl,
      },
    },
  ],
});
