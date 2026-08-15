#!/usr/bin/env npx tsx
/**
 * W5 — operator report for stale org-optimizer lifecycle rows.
 *
 *   npx tsx scripts/reconcile-org-proposals.ts            # dry run (default)
 *   npx tsx scripts/reconcile-org-proposals.ts --apply    # + retire metadata
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
 * covered by the test suite.
 */

import { runReconcileCli } from '../src/services/org_proposal_reconciler';

runReconcileCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`reconcile-org-proposals failed: ${String(error)}\n`);
  process.exitCode = 1;
});
