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
    // The suite mutates process-global state and owns SQLite/server fixtures.
    // One worker preserves those isolation assumptions. scripts/run-tests.mjs
    // bounds full-suite memory by executing deterministic shards in fresh,
    // sequential processes instead of asking CI to reap hundreds of forks.
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 1,
    // Intermittent CI failure: every test passes but the run exits non-zero
    // with ~20 pool-level errors — "[vitest-pool]: Timeout terminating forks
    // worker for test files <X>" (a different random ~10 files each run),
    // "Worker exited unexpectedly", "Worker forks emitted error".
    //
    // It is NOT a leaked child handle. With the default `forks` pool +
    // per-file isolation, vitest tears down a fork after each of the ~625 test
    // files: graceful `stop` → wait for the worker's `stopped` reply → SIGTERM
    // → SIGKILL@500ms. The forks worker installs no SIGTERM handler (only under
    // --prof), so an open socket/DB/fs.watch/child can NOT delay termination —
    // SIGKILL always reaps it. What fails is the *parent* orchestrating
    // hundreds of these teardown handshakes on 2 saturated vCPUs: under that
    // scheduling starvation some stops aren't confirmed within the default 10s
    // teardownTimeout — the sole gate on the "Timeout terminating" log
    // (vitest cli-api.js) — which cascades into the unexpected-exit path and
    // flips the exit code. Reproduced locally by lowering teardownTimeout to
    // 20ms (→ ~30 identical errors naming random files, tests still passing);
    // at the default 10s a fast dev box reaps every fork in <20ms so it never
    // fires. Widen the budget so the starved CI parent has room to confirm the
    // orderly stops it already completes. Safe: SIGKILL@500ms still guarantees
    // no real hang, so this never actually delays a healthy run.
    teardownTimeout: 60_000,
  },
});
