import { defineConfig } from '@playwright/test';
import previous from './electron-e25b-playwright.config';

// #1374 slice 3 — dedicated live-mode server, kept off the shared default fixture server and off
// the sandbox-reserved port ranges (4000-4002, 4096-4099, 5173). Ports stay inside the 7520-7529
// block reserved for this campaign's Playwright runs.
const port = Number(process.env.RHYTHM_E2E_PORT ?? 7524);

export default defineConfig({
  ...previous,
  testMatch: 'issue-1374-remote-attach.spec.ts',
  timeout: 40_000,
  outputDir: '/tmp/rhythm-remote-1374-results/issue-1374-remote-attach',
  use: { ...previous.use, baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    ...previous.webServer,
    command: `VITE_RHYTHM_API_BASE=http://127.0.0.1:7525 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:7526 VITE_RHYTHM_PRODUCTION_API_BASE=https://issue1374.invalid VITE_RHYTHM_LIVE_TOKEN=issue1374-synthetic npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
  },
});
