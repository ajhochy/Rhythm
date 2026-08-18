import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './contract',
  testMatch: [
    'issue-2001-dashboard.spec.ts',
    'issue-2002-planner.spec.ts',
    'issue-2003-tasks.spec.ts',
    'issue-2004-rhythms.spec.ts',
    'issue-2005-projects.spec.ts',
    'issue-2006-messages.spec.ts',
    'issue-2007-facilities.spec.ts',
    'issue-2008-automations.spec.ts',
    'issue-2009-integrations.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4175', viewport: { width: 1440, height: 900 } },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
