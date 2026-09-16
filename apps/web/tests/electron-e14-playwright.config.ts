import { defineConfig } from '@playwright/test';
import live from './post-m1-phase-3-live-playwright.config';

const sandbox = process.env.RHYTHM_LIVE_E2E === '1';
const port = sandbox ? '4175' : '4176';

export default defineConfig({
  ...live,
  testMatch: 'electron-e14-task-planner.spec.ts',
  webServer: { ...live.webServer as object, url: `http://127.0.0.1:${port}`, command: (live.webServer as { command: string }).command.replace('VITE_RHYTHM_LIVE_TOKEN=post-m1-phase-3-disposable ', '').replaceAll('4176', port) + ' --strictPort' },
  use: { ...live.use, baseURL: `http://127.0.0.1:${port}`, timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' },
});
