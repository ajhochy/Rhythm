---
date: 2026-10-08
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: [model-router-grid-repair]
status: ready-for-verification-offline
tags: [run, rhythm]
---

## Scope / authorization carried forward

Focused integration repair after childcfa2a011 BLOCKED; its dirty wiring is the
preserved baseline, not a diff to revert. Manager explicitly approved the additive
SQLite + PostgreSQL durable classification/attempt ledger expansion. No renewed
approval needed for these same in-scope symbols. Read AGENTS, regression registry,
project-state, current-plan, testing-guide, approved grid plan (including steering
lines 168–190), and 2026-10-08-router-grid-g2.md. Loaded acceptance-contract FIRST,
then coding-agent; no orchestrator/peer dispatch.

Excluded: Free Mode policy/state files (other writer), defaults/config, fork,
unrelated source, production/installed runtime, global account swaps, replay of
failed tasks, commits/pushes/installs, online/key/private-data access, file deletion
including test cleanup, server management. Sandbox manager owns API4398 / engine4397
/ gateway4399 at /private/tmp/sdmr-grid-sandbox. No live4001/4002/4096 access.
Project-state/current-plan left unchanged to avoid overwriting manager state.

## Phase 0 — acceptance RED

Canonical mapping: ../contracts/task-router-grid-repair.json.
Commands below ran from apps/api_server with this exact environment prefix:

```sh
HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4397 PORT=4398 npm_config_cache=/private/tmp/sdmr-grid-sandbox/npm-cache
```

- `npx --no-install vitest run src/services/decision/router_grid_exhaustion.test.ts src/services/decision/router_grid_spillover.test.ts --no-file-parallelism`
  — 2 failed files; 2 failed / 9 passed. Shorter cooldown expected5000/received2000;
  status-less fresh exhausted snapshot expected account exhaustion/received[].
- `npx --no-install vitest run src/controllers/__tests__/router_grid_accounts.test.ts src/services/decision/router_grid_attempts_repository.test.ts --no-file-parallelism`
  — 2 failed files; 6 failed / 1 passed. Both store-default/null create cases
  expected auto true/received false; both same-id provider PATCH cases expected
  auto false/received true; schema missing; repository absence asserted as a test
  failure (not module-load error).

These failures were captured BEFORE implementation. Expanded PG-boundary,
closed-validation, recovery-clear, diagnostic-no-op, and pinned-reselection cases
were added after the initial RED proof; do not claim each added clause had its own
preimplementation failing run. Live fixture proof is manual / NOT RUN, not waived.

## Phase 1 — bounded impact review

CLI from worktree root:
`gitnexus impact <symbol> --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008`
for markAutoAccountSession, isAutoAccountSession, clearAutoAccountSessionsForTests,
create, update, markExhausted, routeGridTurn, runMigrations, runPostgresBootstrap,
markGridSpillover: every result was repository-not-found, risk **UNKNOWN**.
MCP api_impact(file=apps/api_server/src/controllers/agent_sessions_controller.ts,
repo=<same worktree>) also returned repository-not-found. No reindex/install or
false rating. Inspected incoming literal references and entire intended production
surface: controller POST/PATCH; capacity provider checks; grid shared turn router
and runner; exhaustion intake; both bootstraps; local diagnostic writer; modified
live helper. routeGridTurn has turn_routing and agent_runner callers; markExhausted
production caller is grid intake; db init invokes backend bootstrap/migrations.
Provenance calls originate in controller and grid account application; legacy
capacity checks provider-specific eligibility. Existing local session repository
uses getDb throughout. API response shape/middleware unchanged.

Consequential risk review: pins must override a late legacy marker and exhausted
rerouting; stale receipts cannot shorten active cooldown; status-less overload
cannot be misclassified; hosted durability must not be SQLite-only; shadow must
remain detached. Tests exercise actual controller/repository/turn/intake with fake
engine, cached-usage, account-file and pool-query boundaries, not mocked routing.

## Files / repairs (this writer only)

- controllers/agent_sessions_controller.ts: create auto provenance independent of
  capacity mode, including null defaults; validated PATCH revokes provider auto
  even for same id. No default-account file changes/global swap.
- services/decision/capacity_router.ts + .test.ts: production unmark helper;
  explicit provider pin overrides generic marker and cannot be re-auto-marked by
  a late callback; sibling marker preserved. In-memory/restart-conservative as before.
- controllers/__tests__/router_grid_accounts.test.ts: actual create/PATCH consumers,
  Shadow defaults/null, explicit/profile pins, same-id sibling isolation.
- router_grid_exhaustion.ts + .test.ts: ignore past reports, max active deadline;
  separate clearRecovered requires fresh finite positive evidence, rejects future,
  stale/unknown/zero evidence. No new recovery caller or polling invented.
- router_grid_attempts_repository.ts + .test.ts: async backend-aware parameterized
  append/readState; closed classification/result/trace validators; local reason
  codes only; SQLite reopen, exact JSON keys, corrupt input no mutation, PG pool
  query boundary/bootstrap SQL, actual PG legacy diagnostic no-op. Shadow stored
  as kind=shadow and excluded from latest applied model; kind=none also excluded.
- database/migrations.ts + postgres_bootstrap.ts: additive id/session_id/created_at/
  classification_json/result_json table, index(session_id,id), no destructive SQL
  added. Migration twice tested; schema SQL exercised at simulated pool boundary.
- router_grid_turn.ts + .test.ts: awaits independent durable ledger, reuses first
  classification for exhaustion; pin blocks reselection authorization. Diagnostic
  no-op does not affect classification. Detached shadow and legacy paths retained.
  Missing ledger preserves carryover, never invents exhausted reclassification.
- router_grid_spillover.ts + .test.ts: explicit429 behavior retained; status-less
  only reported-account windows with finite remaining<=0 and snapshot age<=15min
  (not future). Uses exhausted window resets when available; generic rate_limited
  alone rejected; explicit529 always rejected; no failed-turn retry. No existing
  typed usage-limit/reset signal was found in API intake/current plugin, so no new
  untrusted callback flag was invented to bypass snapshot evidence.
- __tests__/router_on_apply_live_e2e.test.ts: removed hard-delete/profile-delete/
  rm cleanup, preserved fixture sessions/profiles/temp directories, temp cwd under
  TMPDIR; literal gpt-6-luna and captured-request assertions ensure incapable
  fixtures fail instead of reporting placeholders. Existing exact fake token and
  effort assertions retained. No live execution, including skipped-mode run.
- This run note + canonical acceptance contract. Existing G2 note preserved.

## Checks / repair loop

All test commands use the prefix above; typecheck uses same HOME/TMPDIR/DB_PATH/
DB_CLIENT/npm cache (no runtime port override needed).

1. `npx --no-install vitest run src/controllers/__tests__/router_grid_accounts.test.ts src/services/decision/router_grid_attempts_repository.test.ts src/services/decision/router_grid_turn.test.ts src/services/decision/router_grid_exhaustion.test.ts src/services/decision/router_grid_spillover.test.ts src/services/decision/capacity_router.test.ts --no-file-parallelism`
   — 1 failed / 5 passed files; 1 failed / 79 passed tests. PG test pool fixture
   lacked connect(), used by an unrelated pre-existing transactional bootstrap.
   Repair attempt1: supplied fake connect/query/release at actual pool boundary.
2. `npx --no-install tsc --noEmit` — exit0, no output.
3. `npx --no-install vitest run src/controllers/__tests__/router_grid_accounts.test.ts src/services/decision --exclude '**/router_grid_config.test.ts' --exclude '**/sol-choice-boundary.test.ts' --exclude '**/openai_decisions_backend.test.ts' --exclude '**/model_router.test.ts' --exclude '**/model_catalog_config.test.ts' --exclude '**/decision_settings.test.ts' --exclude '**/decision_backends.test.ts' --exclude '**/decision_client.test.ts' --no-file-parallelism`
   — **24 passed files; 310 passed tests; exit0; 19.92s**.
4. `npx --no-install tsc --noEmit` — exit0, no output.

Preservation-safe scope is NOT all decision/controller-account suites. The eight
excluded decision files have deleting cleanup and/or listening HTTP fixtures.
Older anthropic_session_routing/openai_session_routing tests both delete account
fixtures and start listening HTTP servers. They were inspected but NOT RUN or
edited to expand this writer's source ownership. New direct-controller contracts
exercise account behavior without listening sockets. Owned tests' file cleanup is
disabled/preserved; file-based restart fixture uses journal_mode=MEMORY. Never ran
blanket API suite, live suite, or server/sandbox lifecycle command.

## Runtime limitations / handoff

- **PG live NOT RUN.** This change supports durable grid attempt append/readState
  and additive bootstrap on PostgreSQL. Query-boundary simulation is not a PG
  server or hosted runtime pass. AgentSessionsRepository/controller/account/model
  application still use local getDb paths; no full hosted-engine runtime claim.
- **W11 NOT RUN** by explicit dispatch prohibition. Manager must qualify actual
  synthetic account+effort against its own sandbox, with operator-seeded loopback
  openai/gpt-6-luna, advertised efforts and fake account. No real credentials read.
- Status-less receipt cannot see immediate quota exhaustion until positive fresh
  cached usage is visible; generic rate_limited does not prove429. Max15min cache
  age is the existing grid freshness limit. No plugin change/auto-retry.
- Durable classification survives SQLite reopen/PG repository reconstruction;
  account auto provenance remains in-memory and unknown concrete accounts after
  restart remain conservatively pinned. No persistent provenance schema inferred.
- Manager owns Free Mode integration/runtime/verifier, full unsafe-suite adaptation,
  live/PG qualification, build/install and any eventual PR decision.

Handoff: READY_FOR_VERIFICATION for scoped offline repairs, **not PR-ready**, not
runtime qualified. No commit/push. Free Mode files, defaults, fork, sandbox tools,
and every other existing dirty integration path preserved and excluded from this
writer's ownership. Final contract rerun and diff checks recorded below.

### Final receipt

- Maintained canonical six-file contract command (same environment prefix):
  **6 passed files, 81 passed tests, exit0, duration11.39s**. This final run also
  checks that shadow/none attempts never replace the latest applied model and
  asserts the exact closed persisted JSON key sets after SQLite reopen.
- Final `npx --no-install tsc --noEmit`: **exit0, no output**.
- Root `git diff --check`: clean. Each of the nine owned untracked files checked
  with `git diff --no-index --check /dev/null <file>`: no whitespace diagnostics.
- Final `git status --porcelain` confirms all prior dirty wiring remains, Free
  Mode policy/state remains untracked and untouched, plus a concurrently created
  original-router-memory-dayflow-ledger contract (not this writer's file).
- Eight owned tracked paths show +132/-17 against HEAD, **including inherited G2
  baseline hunks**, not an attribution of all132 lines to this repair. Four owned
  grid turn/intake files were already untracked baseline files; only the changes
  described above are this writer's repairs. No file deletions performed and no
  Git staging/commit/push or process lifecycle operations performed.
- One validation repair attempt (PG fake pool connect fixture); no second repair
  needed. Phases0/1/2 complete for this bounded offline slice; live/manual and
  excluded unsafe-suite gates remain explicitly incomplete.
