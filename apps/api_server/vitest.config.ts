import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // C6 item 5 — force safe, unique-per-run values for DB_PATH/
    // MEMORY_VAULT_PATH/MEMORY_VAULT_SUBDIR/AGENT_LOCAL/PORT BEFORE any test
    // file (and therefore config/env.ts) imports, overriding whatever a
    // developer's ambient shell already exported. See vitest.setup.ts.
    setupFiles: ['./vitest.setup.ts'],
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
    // Integration files own Express servers, SQLite handles, and background
    // services. Give their normal cleanup a wider budget on slower runners.
    // server_ci.yml pins Node 22 because Node 24.19 can abort inside
    // better-sqlite3's native cleanup hook while Vitest tears down workers.
    teardownTimeout: 60_000,
  },
});
