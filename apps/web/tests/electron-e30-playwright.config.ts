import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: ['electron-e30-workspace-members.spec.ts', 'electron-e40-settings.spec.ts', 'electron-e40-settings-rendered.spec.ts'], workers: 1,
  reporter: [['line']], use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4175' },
  webServer: { command: 'VITE_RHYTHM_GATEWAY_MODE=live VITE_RHYTHM_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_EXPECTED_API_BASE=http://127.0.0.1:4098 VITE_RHYTHM_EXPECTED_ENGINE_BASE=http://127.0.0.1:4097 VITE_RHYTHM_PRODUCTION_API_BASE=https://members.invalid VITE_RHYTHM_LIVE_TOKEN=members-token npm run dev -- --host 127.0.0.1 --port 4175', url: 'http://127.0.0.1:4175', reuseExistingServer: false },
});
