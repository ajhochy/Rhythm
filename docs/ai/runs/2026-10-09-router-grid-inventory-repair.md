---
date: 2026-10-09
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: [router-grid-inventory]
status: ready-for-verification-offline
tags: [run, rhythm]
---

## Scope / coordination
Original Router runtime writer resumes solely triage9e1c5950's demonstrated bug:
nonempty unavailable usage hid healthy unknown-quota local account inventory.
Explicit parent handoff supplies authorization; no breadth or renewed approvals.
Only router_grid_turn.ts runtime function, its unit/integration test, this note and
contract changed this continuation. Fixtureowner449eb385 exclusively owns live
test isolation; NO live test/fixture changes here. Other Free Mode/config/selector
writers and all existing dirty baseline preserved. Prior proofs/run notes preserved.
Previously read AGENTS/project-state/current-plan and original steering retained
as session memory. acceptance-contract loaded first, then coding-agent. No peer
dispatch, native SDK, engine, provider server, model, credential, lifecycle, delete,
commit/push/install or online operations. Same sandbox HOME/TMPDIR/DB_PATH and
manager ownership API4398/engine4397/gateway4399; no live4001/4002/4096.

## Phase 0 RED
Added seven real-turn contracts using fake external cached usage/account inventory/
catalog/classifier boundaries. No selector/router/exhaustion state mocked. Tests
distinguish unavailable-only and mixed snapshots from disconnected inventory,
needs_relogin, active cooldown, known-zero quota, and known-positive quota ranking.
Assertions include persisted account/model/variant, ledger next consumer and
continuation without reclassification; deny cases have null account/model result.

Exact environment prefix (all commands cwd apps/api_server):
`HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4397 PORT=4398 npm_config_cache=/private/tmp/sdmr-grid-sandbox/npm-cache`

`npx --no-install vitest run src/services/decision/router_grid_turn.test.ts -t 'inventory-c' --no-file-parallelism`
BEFORE runtime edits: **2 failed / 5 passed / 18 skipped**, duration1.92s.
Both unavailable/mixed cases expected applied=true, Haiku/anthropic-1; received
applied=false baseline openai/gpt-6.1-sol (grid diagnostic chosen=null).

## Phase 1 impact / caller review
BEFORE edits: root `gitnexus impact routeGridTurn --direction upstream --repo /Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008`
returned repository-not-found. Risk UNKNOWN, no graph rating inferred. Exact caller
review: turn_routing.ts73 and agent_runner.ts1240 share routeGridTurn. Inspected
whole runtime function, accountHeadroom unavailable exclusion, local redacted
inventory health (`status: ok | needs_relogin`), usage/service health conventions.
No public handler edited. Shared-risk mitigation: preserve known snapshot values
through provider+ID dedupe; only supplement status=ok; keep existing persisted
exhaustion deadline; tests reject disconnected/relogin/cooldown/known-zero.
capacity_router and usage validation remain unchanged.

## Phase 2 smallest repair / validation
Removed empty-snapshot-only guard. Always supplement missing entries from local
inventory, status===ok only, quotaRemainingPct=null/resetsAt=null, existing
exhaustedUntil retained. Existing snapshot entries remain authoritative and are
not duplicated. No inline usage probing or new recovery behavior.

Initial focused validation:
`npx --no-install vitest run src/services/decision/router_grid_turn.test.ts src/services/decision/router_grid_select.test.ts src/services/decision/router_grid_exhaustion.test.ts src/services/decision/router_grid_attempts_repository.test.ts src/services/decision/capacity_router.test.ts --no-file-parallelism`
**1 failed / 102 passed**, duration10.34s. New inventory regressions green; old W4
OpenAI-only effort fixture removed Anthropic usage but left healthy Anthropic
inventory. Corrected this owned unit fixture to remove Anthropic inventory too;
preserved exact effort assertions (not a runtime rollback). One repair attempt.

Final exact command with prefix above:
`npx --no-install vitest run src/services/decision/router_grid_turn.test.ts src/services/decision/router_grid_select.test.ts src/services/decision/router_grid_exhaustion.test.ts src/services/decision/router_grid_attempts_repository.test.ts src/services/decision/capacity_router.test.ts src/services/decision/router_grid_spillover.test.ts src/controllers/__tests__/router_grid_accounts.test.ts --no-file-parallelism`
**7 passed files; 116 passed tests; exit0; duration12.46s**.
`npx --no-install tsc --noEmit` (same HOME/TMPDIR/DB_PATH/DB_CLIENT/npm cache):
**exit0, no output**, both initial and final validation.

Final exact source SHA-256 (`shasum -a 256`):
- router_grid_turn.ts: `349b70ec760f88e64bc0c0c17baef2ff5dc35075378aa366853139a731aba9c2`
- router_grid_turn.test.ts: `f14ae7ed12a27fea7b196d052eea3bca44564fcf9dfc1ce82df5d142e0fef3a1`
These identify dirty exact file content, not a committed repo SHA or whole-tree
freeze; other writers may still change their independently owned sources.

Final maintained contract rerun (same prefix, `-t 'inventory-c'` command above):
**1 passed file, 7 passed / 18 skipped tests, exit0, duration2.05s**. All four
owned untracked files checked with `git diff --no-index --check /dev/null <file>`:
no whitespace diagnostics. Both exact source hashes rechecked unchanged.

## Original-parent handoff / quiescence
READY_FOR_VERIFICATION for this precise offline repair only. No overall live PASS;
actual final runtime matrix is parent/fixture owner work, NOT RUN by this writer.
Prior PG/live limitations remain as documented in focused-repair note. No new
runtime verification claim. Writer quiescent after recorded final checks: no
active owned writes, background test jobs, servers, or dispatched children. Parent
may consume hashes and run matrix; fixture owner's live test was never edited.
