import { existsSync, readdirSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// If the pinned Playwright's browser build is missing, fall back to any installed Chromium
// under PLAYWRIGHT_BROWSERS_PATH (e.g. the sandbox's /opt/pw-browsers).
function fallbackChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  for (const dir of readdirSync(root).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()) {
    for (const sub of readdirSync(`${root}/${dir}`)) {
      const exe = `${root}/${dir}/${sub}/chrome`;
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}
const executablePath = process.env.RHYTHM_CHROMIUM_PATH ?? fallbackChromium();

// Lane port block: 7560-7569 (router-auto-model).
export default defineConfig({
  testDir: '.', testMatch: 'router-auto-model.spec.ts', workers: 1, outputDir: 'test-results',
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, baseURL: 'http://127.0.0.1:7560', bypassCSP: true, ...(executablePath ? { launchOptions: { executablePath } } : {}), serviceWorkers: 'block' },
  webServer: {
    command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:7561 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7562 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:7561 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:7562 VITE_RHYTHM_PRODUCTION_API_BASE=https://api.vcrcapps.com VITE_RHYTHM_LIVE_TOKEN=router-auto-disposable npm run dev -- --host 127.0.0.1 --port 7560',
    url: 'http://127.0.0.1:7560', reuseExistingServer: false, timeout: 60_000,
  },
});
