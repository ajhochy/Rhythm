import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './live',
  testMatch: 'electron-native-attach.spec.ts',
  reporter: [['line']],
  workers: 1,
  use: { trace: 'off', screenshot: 'off', video: 'off' },
});
