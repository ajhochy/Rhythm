---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-01]
status: READY_FOR_VERIFICATION
tags: [run, api_server]
---

## Files

- Added additive SQLite/Postgres live-artifact metadata schema, per-user tab preference, and focused parity test.
- Added `LIVE_ARTIFACT_STORAGE_DIR` defaults, hosted `/data/live-artifacts` documentation, and sandbox-root injection.

## Checks

- `tools/dev/sandbox.sh up && apps/api_server/node_modules/.bin/vitest run apps/api_server/src/__tests__/live_artifacts_schema_parity.test.ts; test_status=$?; tools/dev/sandbox.sh down; exit $test_status` — expected failing acceptance run: 1 failed, `expected undefined to be defined` for missing `live_artifacts`.
- `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status && apps/api_server/node_modules/.bin/vitest run apps/api_server/src/__tests__/live_artifacts_schema_parity.test.ts && apps/api_server/node_modules/.bin/tsc --noEmit -p apps/api_server/tsconfig.json; check_status=$?; tools/dev/sandbox.sh down; exit $check_status` — passed: 1 test passed; TypeScript clean; status printed isolated root `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/live-artifacts`; sandbox removed.
- `git diff --check && git diff --name-only && git status --short` — passed whitespace/scope inspection. Preserved existing `docs/ai/current-plan.md` modification.

## Notes

- Postgres live bootstrap: **not_tested**. `THROWAWAY_POSTGRES_URL` is unset; no configured throwaway database was used.
- `migrate_sqlite_to_postgres.ts` was not changed: its fixed allowlist is for one-time SQLite data transfer and does not need empty, newly hosted artifact tables for this schema-only slice.

## Repair pass 1 (verification-gate FAIL at 617d904)

The gate failed on three items. Two are repaired; one is blocked.

**(1) Parity test did not enforce parity — FIXED.** Reproduced the hole with a
mutation harness before changing anything: the previous test used
`expect.arrayContaining` for SQLite columns and a handful of `toContain`
substrings for Postgres, so it never checked the Postgres column set, the
revision/hash CHECK constraints, the composite revision primary keys, the
column defaults, or `idx_live_artifacts_owner_updated`. Seven seeded drift
cases all stayed **GREEN** against it.

`live_artifacts_schema_parity.test.ts` was rewritten around a single approved
`SPEC`. Both dialects are asserted against that spec (not against each other,
so a matching drift in both still fails): exact column-set equality per table
— SQLite via `pragma table_info`, Postgres via paren-depth parsing of the
emitted `CREATE TABLE` bodies — plus every column/constraint clause verbatim,
SQLite nullability and primary-key ordinals, dialect-appropriate timestamp
defaults, and all three required indexes with their index expressions.

Re-running the same harness, all seven now go **RED**, baseline **GREEN**:

| Seeded drift | Before | After |
|---|---|---|
| Postgres `current_state_hash` column dropped | GREEN | RED |
| Postgres `CHECK (length(hash) = 64)` dropped | GREEN | RED |
| SQLite revision PK narrowed to `(artifact_id)` | GREEN | RED |
| Postgres `declared_capabilities_json` default dropped | GREEN | RED |
| `idx_live_artifacts_owner_updated` removed from both | GREEN | RED |
| Extra column added to SQLite only | GREEN | RED |
| `id NOT NULL` removed | GREEN | RED |

**Proven DDL defect found and fixed (the one product-code edit).** Writing the
nullability assertion surfaced a real cross-dialect divergence:
`live_artifacts.id` was `id TEXT PRIMARY KEY`, and SQLite permits a NULL TEXT
primary key while Postgres does not. Verified directly — `INSERT INTO
live_artifacts (id, title) VALUES (NULL, 'x')` **succeeded** on SQLite and
returned a row with `id: null`. Since local development runs SQLite, a NULL
artifact id could have been written locally but never in production. Both
dialects now declare `id TEXT PRIMARY KEY NOT NULL`; after the change SQLite
rejects the same insert with `NOT NULL constraint failed`. Additive,
non-destructive, and the table exists in no deployed database yet. Caveat: a
developer who already ran this branch's migration keeps the old definition,
because `CREATE TABLE IF NOT EXISTS` skips — the table is empty, so dropping
the local dev DB is sufficient.

**(2) Deployment doc contradicted the Postgres posture — FIXED.** Reconciled
only the stale statements: the `/data` volume description (twice), the
validation checklist, and the closing note that "the current production-ready
deployment path still assumes SQLite" (the same file already documented
`DB_CLIENT=postgres` as required). `/data` is now described as the file-backed
volume holding `/data/live-artifacts`, with relational data in Postgres.
Legitimate SQLite guidance was preserved untouched: the local SQLite set used
by the Flutter app (scheduler quarantine section), the hedged "legacy
single-node deploys" `sqlite3` commands, and `SQLITE_MIGRATION_PATH` as the
source side of the one-time transfer.

**(3) Real Postgres bootstrap-twice evidence — BLOCKED.** No approved
throwaway Postgres is discoverable: `THROWAWAY_POSTGRES_URL` is unset, no
`image: postgres` service exists in any repo compose or CI file, and nothing
listens on 5432. Production credentials were not used and no database was
provisioned. Contract `av-01-c5` stays honest as `partial` — drift detection
proven, live execution `not_tested` — with the blocker recorded. The
pre-existing env-gated harness
`apps/api_server/src/__tests__/postgres_bootstrap_live.test.ts`
(`RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1` + `RHYTHM_LIVE_POSTGRES_URL`) skips cleanly
today and is where that evidence belongs once a disposable database exists.

### Repair-pass checks

- Drift mutation harness (7 cases, run against the old test then the new one) —
  7/7 GREEN before, 7/7 RED after, baseline GREEN both times. Harness kept at
  `$TMPDIR/opencode/av01-drift-check.sh`; it restores the DDL after each case
  and `git diff --stat` confirmed the DDL was byte-identical afterwards.
- `INSERT INTO live_artifacts (id, title) VALUES (NULL, 'x')` on SQLite —
  **succeeded** with `id TEXT PRIMARY KEY` (the defect), **rejected** with
  `NOT NULL constraint failed` after adding `NOT NULL`; a normal insert still
  works. Postgres rejects both cases already.
- `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status && vitest run
  live_artifacts_schema_parity.test.ts postgres_bootstrap_live.test.ts && tsc
  --noEmit -p apps/api_server/tsconfig.json; tools/dev/sandbox.sh down` —
  **passed, exit 0**. Engine and api_server both rebuilt; sandbox ready on
  `http://127.0.0.1:4098` (engine `:4097`); status printed the isolated root
  `…/rhythm-dev-sandbox/live-artifacts`; 1 test passed, 1 skipped (the live
  Postgres test, correctly skipped); TypeScript clean.
- The sandbox `up` runs `runMigrations` against a real copy of the live SQLite
  database, so the `NOT NULL` DDL executed against a real populated database
  without error — not only against `:memory:`.
- `tools/dev/sandbox.sh down` — sandbox removed. Confirmed afterwards: sandbox
  directory gone, nothing listening on 4097/4098, and the desktop engine on
  **:4096 still alive and untouched**.
- `git diff --check` clean; `git status --short` shows the same file set as
  before this repair pass — no new or unrelated files. Nothing was committed,
  pushed, or opened as a PR.

## Repair pass 2 (verification-gate FAIL — evidence hygiene + suite classification)

Production code was **not** touched in this pass. Two items were outstanding:
a contract that still claimed `blocked` after the evidence existed, and a
repo-wide suite failure that had never been classified.

### (1) `av-01-c5` was stale, not blocked — FIXED

The blocker recorded in repair pass 1 ("no throwaway Postgres is
discoverable") is no longer true, so the contract was disagreeing with
reality. Rather than transcribe the previous verification run's claim, the
evidence was reproduced first-hand on a disposable server. `postgres:16` was
already present in the local image cache — nothing was installed.

```bash
docker run -d --rm --name av01-throwaway-pg -e POSTGRES_PASSWORD=av01 \
  -e POSTGRES_USER=av01 -e POSTGRES_DB=av01 -p 55433:5432 postgres:16
# → PostgreSQL 16.13 (Debian 16.13-1.pgdg13+1), ready after 2s
```

- **Pre-existing live harness** —
  `env AGENT_LOCAL=true RHYTHM_LIVE_POSTGRES_BOOTSTRAP=1
  RHYTHM_LIVE_POSTGRES_URL=postgres://av01:av01@127.0.0.1:55433/av01
  node_modules/.bin/vitest run src/__tests__/postgres_bootstrap_live.test.ts`
  → **1 passed** (it runs `runPostgresBootstrap` twice into a fresh schema).
- **Exact catalog inspection** — a throwaway script kept *outside* the repo
  (`$TMPDIR/opencode/av01-triage/inspect_live_pg.ts`, so `git status` is
  unchanged) ran the bootstrap twice into schema `av01_inspect` and dumped
  `information_schema.columns`, `pg_constraint` and `pg_indexes`. Both runs
  returned OK, and the live shape matched the parity-test `SPEC` exactly:
  16 `live_artifacts` columns with **only** `deleted_at` /
  `deleted_by_user_id` nullable; all six CHECKs (`type = 'html'`, the
  visibility IN-list, both `revision > 0`, both `length(hash) = 64`); all four
  foreign keys; `PRIMARY KEY (artifact_id, revision)` on both revision tables
  and `(artifact_id, user_id)` on collaborators; and all three required
  indexes, including `idx_live_artifacts_owner_updated … btree (owner_user_id,
  updated_at DESC)`.
- **The c3 divergence, on the real server** — `INSERT INTO live_artifacts (id,
  title) VALUES (NULL, 'x')` → `null value in column "id" … violates not-null
  constraint`.
- **Postgres backfill for an already-deployed profile** — dropped
  `users.artifact_tab_ids_json`, inserted a user row, re-ran the bootstrap:
  the column came back `text NOT NULL DEFAULT '[]'::text` and the pre-existing
  row read back `[]`.
- Container removed (`docker rm -f av01-throwaway-pg`); no production Postgres
  credentials were used at any point.

`av-01-c5` is therefore `pass`, and `not_tested` / `blocked` are now empty.

### (2) Repo-wide `apps/api_server` suite — NOT caused by AV-01

Two distinct problems were conflated here. Both were reproduced.

**(2a) The 10 failures are runner environment contamination, not a defect.**
An agent shell spawned by the Rhythm desktop app inherits `AGENT_LOCAL=true`,
`MEMORY_VAULT_PATH=<Obsidian>/AGENT-MEMORY`, an **empty** `MEMORY_VAULT_SUBDIR`,
`PORT=4001`, and — most dangerously — `DB_PATH=~/Library/Application
Support/Rhythm/rhythm.db`, the live desktop database. `env.dbPath` and
`env.memoryVaultPath` both let those win, so `npm test` run bare from an agent
shell points a 4 000-test suite at the user's real database and real Obsidian
vault. Reproducing with the same *semantics* but redirected to temp paths
(the live DB and the real vault were deliberately not used) gives the gate's
number exactly:

```bash
env -u PORT AGENT_LOCAL=true MEMORY_VAULT_PATH=$T/vault-contam \
  MEMORY_VAULT_SUBDIR= DB_PATH=$T/contam.db npm test
# → 10 failed | 4031 passed | 128 skipped
```

The ten are `agent_research_owner_visibility` (×2),
`delegation_caller_identity`, `issue_1135_audit_lock_contract`,
`memory_index_rebuild`, `memory_injection` (×2), `projects_checkout`, and
`issue_1219_memory_provenance` (×2) — every one a memory-vault-layout or
`AGENT_LOCAL` auth-bypass assertion, i.e. exactly what those two variables
control. None touches `live_artifacts`. Sanitizing the environment clears all
ten.

**(2b) The 2 remaining failures are pre-existing suite flakiness.** The same
sanitized command was run four times on `feat/artifact-viewer` and three times
on the **base commit `617d9045` with no AV-01 code at all**
(`$TMPDIR/opencode/rhythm-main-baseline`, clean worktree):

```bash
env -u AGENT_LOCAL -u MEMORY_VAULT_PATH -u MEMORY_VAULT_SUBDIR \
  -u DB_PATH -u PORT npm test
```

| Where | Result |
|---|---|
| branch run 1 | 2 failed / 4039 passed — `opc_m4_3_mcp_routes.test.ts` (2 cases) |
| branch runs 2–4 | **4041 passed** / 128 skipped, exit 0 |
| base runs 1–2 | **4040 passed** / 128 skipped, exit 0 |
| base run 3 | 2 failed / 4038 passed — `notifications_agent_local_bypass.test.ts`, `opencode_commands_routes.test.ts` |

The base branch fails intermittently too, in **different files**, at a similar
rate (1/3 vs 1/4). `opc_m4_3_mcp_routes.test.ts` run alone on the branch is
**20 passed, exit 0**. Different victims per run, green in isolation, and
present without the change → order/parallel-dependent cross-test state leak in
the api_server suite, pre-existing and unrelated to AV-01. Filed as a
follow-up: `docs/ai/generated-issues/api-server-suite-order-dependent-flake.md`.

### Repair-pass-2 checks

- Nothing was committed, pushed, or dispatched; no product code changed. The
  only edits are `docs/ai/contracts/live-artifacts-av01.json` and this note.
- The desktop engine on **:4096 was verified alive and untouched before and
  after** each run (PID 33193 both times); no api_server was started, so
  `tools/dev/sandbox.sh` was not needed for these test-only commands. `PORT`
  was unset on every run so no test could bind the live `:4001`.
- Full logs kept outside the repo at
  `$TMPDIR/opencode/av01-triage/run-*.txt`.
