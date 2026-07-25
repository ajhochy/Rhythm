import { defineConfig, devices } from '@playwright/test';

function portFromEnv(names, fallback) {
  const configured = names
    .map((name) => [name, process.env[name]?.trim()])
    .filter(([, raw]) => Boolean(raw));
  const distinct = new Set(configured.map(([, raw]) => raw));
  if (distinct.size > 1) {
    throw new Error(
      `${names.join(' and ')} must select the same TCP port when both are set`,
    );
  }
  const [name, raw] = configured[0] ?? [names[0], undefined];
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

const fakePort = portFromEnv(
  ['PLAYWRIGHT_FAKE_PORT', 'RHYTHM_MOBILE_E2E_FAKE_PORT'],
  44096,
);
const webPort = portFromEnv(
  ['PLAYWRIGHT_WEB_PORT', 'RHYTHM_MOBILE_E2E_WEB_PORT'],
  19006,
);
const fakeBaseUrl = `http://127.0.0.1:${fakePort}`;
const webBaseUrl = `http://127.0.0.1:${webPort}`;

process.env.PLAYWRIGHT_FAKE_PORT = String(fakePort);
process.env.PLAYWRIGHT_WEB_PORT = String(webPort);
process.env.RHYTHM_MOBILE_E2E_FAKE_PORT = String(fakePort);
process.env.RHYTHM_MOBILE_E2E_WEB_PORT = String(webPort);

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
