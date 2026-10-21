import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './gateway',
  testMatch: ['org-evaluation-gateway.spec.ts', 'self-improvement-gateways.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
});
