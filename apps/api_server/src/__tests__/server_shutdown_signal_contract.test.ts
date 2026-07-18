/**
 * Regression-contract tests for the #614 clean-shutdown wiring in
 * apps/api_server/src/server.ts
 * (chore/server-shutdown-signal-contract — follow-up to #655 / PR #682,
 * no issue #).
 *
 * Context: PR #682 added a kill-stale-on-port reclaim BEFORE the opencode
 * engine spawn — the RECOVERY path for an already-orphaned `opencode serve`
 * holding :4096 (SIGKILL, force-quit). The complementary PREVENTATIVE path
 * is the #614 shutdown handler: on SIGTERM (Flutter kill) and SIGINT
 * (Ctrl-C in dev) the server must dispose the opencode SDK subprocess
 * before exiting so trappable terminations never create the orphan at all.
 * That wiring exists today (commit 726a5c4, extended by the #614b
 * parent-PID watchdog) but nothing guarded it: a refactor of server.ts
 * could silently drop a handler and the orphan would only resurface later
 * as a flaky "engine bricked on :4096" report.
 *
 * c1: SIGTERM and SIGINT are both registered and route to shutdown().
 * c2: shutdown() calls opencodeClient.dispose() before any process.exit.
 * c3: the #614b watchdog routes through the SAME shutdown (PARENT_GONE),
 *     so all three termination paths share one dispose sequence.
 * c4: shutdown() is idempotent (shuttingDown guard), so a double signal
 *     cannot race two teardown sequences.
 * c6: the watchdog parses --parent-pid=N from process.argv and uses it as
 *     trackedRootPid (fixes dev-mode flutter→npx→tsx→node depth gap where
 *     process.ppid never becomes 1 from the api_server's perspective).
 * c7: when --parent-pid is present the watchdog uses process.kill(trackedRootPid, 0)
 *     and calls shutdown on ESRCH — not the legacy ppid===1 check.
 *
 * These are source-inspection contracts (same style as
 * watchtower_compose_contract.test.ts): server.ts runs main() at import —
 * it opens the DB, HTTP, and WS listeners — so unit-importing it is not
 * practical, and a full spawn-a-child-process e2e is heavier than the
 * issue-level suite allows. Inspecting the wiring is the smallest
 * meaningful guard.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SERVER_TS = path.join(__dirname, '..', 'server.ts');
const source = readFileSync(SERVER_TS, 'utf8');

/**
 * Extract the body of the `shutdown` arrow function: from its declaration
 * to the first signal registration that follows it. Generous slicing keeps
 * the test stable across formatting-only changes.
 */
function shutdownBlock(): string {
  const start = source.indexOf('const shutdown');
  expect(start, '`const shutdown` declared in server.ts').toBeGreaterThan(-1);
  const end = source.indexOf("process.on('SIGTERM'", start);
  expect(end, 'signal registration follows the shutdown declaration').toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('server.ts — #614 shutdown signal contract (opencode orphan prevention)', () => {
  it('shutdown-c1: SIGTERM and SIGINT both route to shutdown()', () => {
    expect(source).toMatch(
      /process\.on\(\s*['"]SIGTERM['"]\s*,\s*\(\)\s*=>\s*shutdown\(\s*['"]SIGTERM['"]\s*\)\s*\)/,
    );
    expect(source).toMatch(
      /process\.on\(\s*['"]SIGINT['"]\s*,\s*\(\)\s*=>\s*shutdown\(\s*['"]SIGINT['"]\s*\)\s*\)/,
    );
  });

  it('shutdown-c2: shutdown() disposes the opencode client before any process.exit', () => {
    const block = shutdownBlock();
    const disposeAt = block.indexOf('opencodeClient.dispose()');
    expect(disposeAt, 'shutdown() must call opencodeClient.dispose()').toBeGreaterThan(-1);
    const exitAt = block.indexOf('process.exit');
    expect(exitAt, 'shutdown() exits the process after teardown').toBeGreaterThan(-1);
    expect(
      disposeAt,
      'dispose() must run before process.exit so the opencode child is reaped',
    ).toBeLessThan(exitAt);
  });

  it('shutdown-c3: the parent-PID watchdog reuses the same shutdown (PARENT_GONE)', () => {
    expect(source).toMatch(/shutdown\(\s*['"]PARENT_GONE['"]\s*\)/);
  });

  it('shutdown-c4: shutdown() is idempotent via the shuttingDown guard', () => {
    const block = shutdownBlock();
    expect(block).toMatch(/if\s*\(\s*shuttingDown\s*\)\s*return/);
    expect(block).toContain('shuttingDown = true');
  });

  it('shutdown-c6: watchdog parses --parent-pid=N from process.argv into trackedRootPid', () => {
    // The flag must be read before the watchdog interval is set up.
    const argvIdx = source.indexOf("process.argv.find((a) => a.startsWith('--parent-pid='))");
    expect(argvIdx, "process.argv.find for '--parent-pid=' must exist in server.ts").toBeGreaterThan(-1);
    const trackedIdx = source.indexOf('trackedRootPid');
    expect(trackedIdx, 'trackedRootPid variable must be declared').toBeGreaterThan(-1);
    // trackedRootPid must be declared before the WATCHDOG's setInterval —
    // server.ts also runs other independent setInterval-based background
    // jobs (e.g. #1072's daily org-instructions re-sync) that legitimately
    // appear earlier in the file, so find the first setInterval AFTER the
    // trackedRootPid declaration rather than the first occurrence anywhere.
    const watchdogIdx = source.indexOf('setInterval', trackedIdx);
    expect(watchdogIdx, "a setInterval must follow trackedRootPid's declaration (the watchdog)").toBeGreaterThan(-1);
    expect(trackedIdx, 'trackedRootPid must be declared before the watchdog setInterval').toBeLessThan(watchdogIdx);
  });

  it('shutdown-c7: when --parent-pid is present the watchdog uses process.kill(trackedRootPid, 0) / ESRCH', () => {
    expect(source).toMatch(/process\.kill\(\s*trackedRootPid\s*,\s*0\s*\)/);
    expect(source).toMatch(/\.code\s*===\s*['"]ESRCH['"]/);
  });
});
