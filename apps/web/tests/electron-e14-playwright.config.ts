import { defineConfig } from '@playwright/test';
import live from './post-m1-phase-3-live-playwright.config';

export default defineConfig({
  ...live,
  testMatch: 'electron-e14-task-planner.spec.ts',
  use: { ...live.use, timezoneId: 'America/Los_Angeles', serviceWorkers: 'block' },
});
