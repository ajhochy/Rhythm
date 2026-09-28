import { defineConfig } from '@playwright/test';

if (process.env.RHYTHM_LIVE_ELECTRON_TRANSPORT !== '1' || process.env.RHYTHM_LIVE_E2E !== '1' ||
    !process.env.RHYTHM_LIVE_TOKEN?.trim()) {
  throw new Error('Native hosted smoke requires RHYTHM_LIVE_ELECTRON_TRANSPORT=1, RHYTHM_LIVE_E2E=1, and an APIRequest-only bearer');
}

export default defineConfig({
  testDir: './live',
  testMatch: 'mega-2026-09-18-smoke.spec.ts',
  workers: 1,
  fullyParallel: false,
  reporter: [['line']],
  preserveOutput: 'never',
  grep: /(?:Facilities — #1515|Messages — #1516|Projects — #1517|Automations — #1518|Integrations — #1519|Settings — #1521|#1513 email:|live task rows keep)/,
  use: {
    baseURL: 'rhythm://app/index.html',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    bypassCSP: false,
  },
});
