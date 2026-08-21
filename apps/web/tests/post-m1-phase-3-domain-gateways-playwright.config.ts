import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './gateway',
  testMatch: ['post-m1-phase-3-domain-gateways.redspec.ts'],
  fullyParallel: false,
  workers: 1,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  reporter: [['line']],
});
