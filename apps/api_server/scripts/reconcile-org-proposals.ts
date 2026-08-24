#!/usr/bin/env npx tsx
/**
 * W5 — operator report for stale org-optimizer lifecycle rows.
 *
 *   DB_PATH=/path/to/rhythm.db npx tsx scripts/reconcile-org-proposals.ts
 *   DB_PATH=/path/to/rhythm.db npx tsx scripts/reconcile-org-proposals.ts --apply
 *
 * Prints one stable JSON document to stdout and nothing else, so it diffs
 * cleanly between runs.
 *
 * Dry run is the default and reads only. `--apply` records, in a sidecar table,
 * that a stale row has been handed to an operator — it never restores or
 * removes a permission, and it never touches the proposal row itself (that
 * table's AFTER UPDATE trigger advances the lifecycle CAS token on any write).
 *
 * All logic lives in src/services/org_proposal_reconciler.ts: tsconfig's
 * rootDir excludes scripts/, so anything written here is neither compiled nor
 * covered by the test suite. Keep this wrapper as close to nothing as possible.
 *
 * WHY THE EXPLICIT initDb: without it `getDb()` throws, and
 * AgentOrgProposalsRepository's constructor CATCHES that and quietly falls back
 * to a fresh in-memory database. The operator then gets well-formed,
 * deterministic, all-zeros JSON and exit 0 — a safety-reporting tool cheerfully
 * certifying that nothing is wrong because it is looking at an empty database
 * it just created. Failing loudly is the only acceptable behaviour here.
 */

import { env } from '../src/config/env';
import { initDb } from '../src/database/db';
import { runReconcileCli } from '../src/services/org_proposal_reconciler';

async function main(): Promise<void> {
  if (env.dbClient === 'postgres') {
    // The sidecar table this script writes under --apply exists only in the
    // SQLite migration path, so refuse rather than half-work.
    throw new Error(
      'reconcile-org-proposals is SQLite-only; run it against the local agent DB (DB_CLIENT=sqlite).',
    );
  }
  process.stderr.write(`reconcile-org-proposals: using database ${env.dbPath}\n`);
  await initDb();
  await runReconcileCli(process.argv.slice(2));
}

main().catch((error) => {
  process.stderr.write(`reconcile-org-proposals failed: ${String(error)}\n`);
  process.exitCode = 1;
});
