import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './gateway',
  testMatch: ['org-evaluation-gateway.spec.ts', 'self-improvement-gateways.spec.ts', 'org-evaluation-schedule-terminal.spec.ts', 'schedule-mcp-readiness.spec.ts'],
  fullyParallel: false,
  workers: 1,
  reporter: [['line']],
});
