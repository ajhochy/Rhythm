---
date: 2026-08-14
repo: Rhythm
branch: self-improvement-engine-foundation
pr: 1398
issues: [W1, W2, W3, W4, W5, W6, W7]
status: integrated, not merged
tags: [run, Rhythm]
---

# Self-improvement engine foundation — campaign record

The plan's step-19 deliverable. This is the index and the honest summary; the
per-phase detail lives in the sibling run files listed at the bottom, which are
kept rather than collapsed because each carries reproduction detail this
document would bury.

## Scope

75 commits, 148 files, +28,020 / −970 against `main`. Seven work packages, each
built in an isolated worktree, each independently reviewed before integration,
none self-certified by the worker that wrote it.

## Commands and outputs

Node v22.23.1 throughout (`export PATH=/opt/homebrew/opt/node@22/bin:$PATH`).

- Full API suite (`npx vitest run`, apps/api_server), three consecutive runs on
  the integrated head: `561 passed | 106 skipped (667)` files,
  `5206 passed | 176 skipped (5382)` tests, exit 0.
- `npm run build` → 0. `npx tsc --noEmit -p tsconfig.json` → 0.
  `git diff --check` → 0.
- Live E2E (`RHYTHM_LIVE_E2E=1`, isolated sandbox, ports 4087–4089):
  `Test Files 1 passed (1)` / `Tests 8 passed (8)`, twice consecutively.
- Live Postgres bootstrap (`RHYTHM_LIVE_PG=1`, disposable `postgres:16`):
  `Tests 5 passed | 1 expected fail (6)`. Skips entirely without the gate.
- GitNexus `detect_changes --base main`, after reindexing (the first attempt
  ran against a stale index and reported 15 symbols / 0 processes across a
  148-file diff, which is the absence of data, not a clean result):
  **153 files, 624 symbols, 20 affected execution flows, risk level CRITICAL.**

## What each package established

- **W1** — scope lifecycle safety: revision as a monotonic CAS token enforced by
  triggers in both engines; inverse (not restorative) rollback; legacy
  whole-field snapshots refused rather than best-effort reverted; a single
  import-enforced projection boundary; durable `reconciliation-required` where
  cross-store atomicity is impossible; a bounded recovery sweep.
- **W2** — capability telemetry with a canonical server identity shared by
  successful and denied paths, failing closed when telemetry is unavailable.
- **W3** — learning signals that cannot be manufactured by prose: retry-policy
  text creates no retry-loop signal; internal learner sessions cannot
  recursively harvest skills.
- **W4** — an immutable run-outcome ledger plus append-only feedback, one
  terminal outcome per ROOT run, explicit and inferred verdicts as distinct
  fields, no prompts/arguments/secrets in the tables.
- **W5** — shadow-by-default optimizer policy and a strictly read-only
  lifecycle reconciler with a dry-run operator script.
- **W6** — versioned evidence bundles, a validator that rejects totally, and a
  controlled experiment record with predeclared stopping rule, exposure cap and
  a `promote | inconclusive | regress` decision. Six named proxies cannot
  promote.
- **W7** — the env-gated live E2E suite, executed for the first time against a
  real sandbox.

Durable decisions: `2026-08-15-optimizer-shadow-by-default.md`,
`2026-08-15-scope-rollback-cas-and-inverse-semantics.md`,
`2026-08-15-w1-scope-lifecycle-no-durable-applying.md`.

## What review caught that the workers did not

Recorded because the pattern is the point, not the individual bugs.

- **W5 shipped a P0 that the suite structurally could not catch.** The operator
  script never called `initDb()`; `getDb()` threw; the repository constructor
  caught it and substituted a fresh in-memory database. The operator got
  well-formed, deterministic, all-zeros JSON and exit 0 — a safety-reporting
  tool certifying nothing was wrong because it was reading a database it had
  just created. Every test imported the function directly after `setDb()`, so
  none of them exercised the script.
- **W4 overclaimed immutability.** Triggers block UPDATE and DELETE but not
  `INSERT OR REPLACE`, because SQLite only fires BEFORE DELETE for REPLACE when
  `PRAGMA recursive_triggers` is on, and it is off. The claim was rescoped to
  what the schema actually delivers and pinned in both directions.
- **W4's interactive hook recorded success it never observed.** `session.idle`
  is a TURN boundary and the row is written once, so the first turn defines the
  run forever — and the call site hard-coded `producedArtifact: true`. Every
  interactive session with clean tool telemetry was permanently recorded
  `success`. W6 promotes on this ledger.
- **W6's contract could be satisfied by a brick.** The first draft was all
  refusals: `validate() → false` and `decide() → 'inconclusive'` satisfied six
  of eleven criteria. `W6-c12` was added to require `promote` AND `regress` to
  be reachable in the same fixture table as the six proxy refusals. The
  implementation review then verified it by executing ~15 mutations.
- **Two W6 mutations survived and were real**: `primaryMetric.direction` had
  never executed (a candidate with a HIGHER error rate would have promoted), and
  the retro-declaration guard was dead code.

## What only EXECUTION caught

Source review had already fixed the live suite twice. Running it found five more
defects — four in the test, one in production:

1. `POST /agent-configs` returns 201, not 200. The shared `createProfile` helper
   asserted 200, so all eight cases died on their first HTTP call. Third
   instance of one defect class in this file.
2. `GET /agent-sessions/:id/messages` returns `{ messages, pageInfo }`, not an
   array.
3. W7-9 was self-blocking: the shared helper hard-codes `maxLlmCallsPerRun: 0`
   and the lane it asserts breaks out before creating anything at that budget.
4. A generated profile id is never in `ROUTE_FALLBACKS_BY_AGENT`, so the gateway
   refused every turn.
5. **Production defect** — the deterministic workflow-signal lanes wrote
   `audit_run_id = NULL` while the LLM path in the same file stamped it.
   Unattributed proposals are invisible to per-run reporting and to
   `deleteRunProposals` cleanup.

And executing the Postgres bootstrap for the first time found that
**`runPostgresBootstrap` could not complete against a fresh database** — an
`ALTER` declared a foreign key to a table created ~280 lines later — plus 13
columns present in SQLite and absent in Postgres.

## Limitations — read before treating any of this as done

- **GitNexus reports risk CRITICAL**, and the repo's own rule is to surface
  HIGH/CRITICAL rather than proceed quietly. The 20 affected execution flows
  are dominated by the `agent_configs` / `agent_org_proposals` read-write paths
  — `readPersistedRevision`, `rowToModel`, `getById`, `approve`, `patch`,
  `create`, `securityLock`, `reviewedReenable`. Those are exactly the symbols
  W1's revision-CAS work set out to change, so the blast radius is consistent
  with the intended design rather than evidence of an accident — but it is
  large, it touches the human approval path, and it deserves a human's eyes
  before merge. Mitigations already in place: an independent review per work
  package, a first integrated cross-package review, 5,206 passing tests, and a
  live E2E gate executed twice.
- **The GitNexus MCP tool cannot read this index.** `analyze` wrote a v42
  database; the MCP server's build reads v41. All GitNexus results above came
  from the CLI (`node .gitnexus/run.cjs detect-changes --repo <path>`), which
  matches what it wrote. Anyone re-running this via the MCP tool will get an
  unavailable-database error until the server build catches up.
- **W6's `verified` reachability** — see the contract's own
  `explicitly_out_of_scope` entry for the state at the time of writing.
- **The `created_at` engine divergence** — Postgres writes ISO-8601 UTC, SQLite
  writes `YYYY-MM-DD HH:MM:SS` parsed as local: a seven-hour skew on
  identically-named columns.
- **Postgres coverage remains partial** even with the new harness: column TYPES
  are not compared (names only), nor constraints, defaults, index/FK parity, or
  any runtime repository behaviour.
- **The sandbox reads the live database.** `tools/dev/sandbox.sh:179` runs
  `sqlite3 "$LIVE_DB" ".backup"` in its only supported bring-up. All recorded
  live results came from a sandbox re-seeded from an EMPTY database via
  `RHYTHM_LIVE_DB_PATH`; to reproduce safely, do the same and stage a HOME
  containing only static-API-key credentials (OAuth entries are keychain-bound,
  resolve to an empty model list, and then suppress the routes that do work).

## Manual review items

- The plan's "Deferred by design" list is untouched and remains deferred.
- Merging is a human decision. This branch has never been merged to `main`.

## Sibling records

- `2026-08-14-w1-scope-safety.md`
- `2026-08-14-w1-corrective-6-package-b-revisions.md`
- `2026-08-15-w1-corrective-6-packages-abc.md`
- `2026-08-15-w4-w5-integrated.md`
- `2026-08-15-w7-live-e2e-suite.md`
- `2026-08-15-w6-w7-suite-integrity.md`
