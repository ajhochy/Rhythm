import { defineConfig } from '@playwright/test';
import base from './post-m1-phase-10-live-playwright.config';

export default defineConfig(base, {
  testMatch: 'electron-e13-automation.spec.ts',
  outputDir: '/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/e13-playwright',
  use: { baseURL: 'http://127.0.0.1:4186' },
  webServer: { ...base.webServer, command: (base.webServer as { command: string }).command.replaceAll('4181', '4186'), url: 'http://127.0.0.1:4186' },
});
