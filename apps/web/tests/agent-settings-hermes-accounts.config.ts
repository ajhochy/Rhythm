import { defineConfig } from '@playwright/test';
// All browser requests use in-memory fixtures. No web/API/engine listener.
export default defineConfig({ testDir: '.', testMatch: 'agent-settings-hermes-accounts.spec.ts', workers: 1, timeout: 10000, expect: { timeout: 1000 }, reporter: 'line', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } });
