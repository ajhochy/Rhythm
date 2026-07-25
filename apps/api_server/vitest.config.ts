import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Many API integration files boot an Express server, run SQLite
    // migrations, and close shared singleton services. Five seconds was below
    // the observed full-suite startup tail (5.03s) even though the same tests
    // were green alone. Explicit test-local timeouts still override this.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // #854 — tools/dev/agent_eval_driver.ts lives outside src/ (it's a
    // standalone dev harness that imports apps/api_server source) but its
    // unit tests are still run via this package's vitest so `npx vitest run`
    // covers them without a second config.
    include: ['src/**/*.test.ts', '../../tools/dev/**/*.test.ts'],
  },
});
