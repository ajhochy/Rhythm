import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'electron-e51-composer-transcript.spec.ts', workers: 1,
  reporter: [['line']], use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4182' },
  webServer: { command: 'VITE_RHYTHM_GATEWAY_MODE=fixture npm run dev -- --host 127.0.0.1 --port 4182', url: 'http://127.0.0.1:4182', reuseExistingServer: false },
});
