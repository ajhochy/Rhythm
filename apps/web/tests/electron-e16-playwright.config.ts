import { defineConfig } from '@playwright/test';
import live from './post-m1-phase-3-live-playwright.config';

const fixture = process.env.E16_FIXTURE === '1';
export default defineConfig({
  ...live,
  testMatch: fixture ? 'electron-e16-agents-fixture.spec.ts' : 'electron-e16-agents-safety.spec.ts',
  outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e16-results',
  use: { ...live.use, baseURL: 'http://127.0.0.1:4188', serviceWorkers: 'block' },
  webServer: { ...live.webServer as object,
    command: (live.webServer as { command: string }).command.replaceAll('4176', '4188').replace('VITE_RHYTHM_GATEWAY_MODE=live', `VITE_RHYTHM_GATEWAY_MODE=${fixture ? 'fixture' : 'live'}`),
    url: 'http://127.0.0.1:4188', reuseExistingServer: false,
  },
});
