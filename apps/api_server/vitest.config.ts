import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // #854 — tools/dev/agent_eval_driver.ts lives outside src/ (it's a
    // standalone dev harness that imports apps/api_server source) but its
    // unit tests are still run via this package's vitest so `npx vitest run`
    // covers them without a second config.
    include: ['src/**/*.test.ts', '../../tools/dev/**/*.test.ts'],
  },
});
