import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'issue-1408-1410-1409-inspector.spec.ts',
  workers: 1,
  reporter: [['line']],
});
