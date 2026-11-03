import { defineConfig } from '@playwright/test';

// Gateway transport contracts use Node HTTP servers, without a browser or build.
export default defineConfig({ testDir: '.', testMatch: 'browser-approvals.spec.ts', workers: 1, retries: 0, reporter: 'line' });
