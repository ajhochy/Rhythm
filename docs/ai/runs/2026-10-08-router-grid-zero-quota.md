---
date: 2026-10-08
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: null
issues: []
status: READY_FOR_VERIFICATION
tags: [run, Rhythm]
---

## Files / approved scope
Assigned deterministic selector repair only: `apps/api_server/src/services/decision/router_grid_select.ts` and its `.test.ts`. Mandatory workflow receipts are additive; no peer files or project-state edited. No renewed scope approval needed. Production wiring and live fixture/tests remain other owners' responsibility.

Excluded: core/config/Free/private tests, quota caches, marker clearing, probes, online/key access, installs, commits/pushes, deletion, process/server management, live ports 4001/4002/4096. None performed. No broad backend/live completion claim.

## Phase 0 — acceptance RED
Loaded acceptance-contract first, then coding-agent. Real selector, no SUT mocks. Read AGENTS, project-state, current-plan, regression registry and testing guide.

Exact command, from `apps/api_server` (also used unchanged for GREEN):
```sh
env -i HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db PATH=/opt/homebrew/bin:/usr/bin:/bin RHYTHM_LIVE_E2E=1 node node_modules/vitest/vitest.mjs run src/services/decision/router_grid_select.test.ts
```
The existing RHYTHM_LIVE_E2E flag only skips global setup/teardown here, preserving files and the supplied sandbox DB_PATH. Exactly one deterministic test file selected; no live test selected or server launched. Existing AT10 injects a synthetic fetch boundary; it makes no network request.

RED at 23:15:57: `Test Files 1 failed (1); Tests 7 failed | 21 passed (28)`; duration 1.10s. Assertion failures (not import/setup errors):
- zero-c1, 0 and -1: expected null, received spent account with exhaustedUntil null.
- zero-c2: expected kind none/no_usable_route, received closed route.
- zero-c4: expected accountId a1 (unknown), received a2 (zero).
- zero-c5, tiers 2/3/4: expected reason exhausted, received reserve.
- Positive 12 (existing AT4), positive 0.1/ranking and per-account cooldown controls already passed.

## Phase 1 — impact
GitNexus upstream impact attempted before edits for pickGridAccount with repo `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/model-router-grid-20261008`; returned repository not found. **Risk UNKNOWN**, not graph PASS; no reindex/install attempted.
Fallback exact-reference search across API src: pickGridAccount's only caller is selectRoute in the same file. selectRoute is consumed by routeGridTurn, whose route/ledger trace flow was inspected. Other selector imports use accountsFromSnapshot (spillover and exhaustion tests); that adapter is unchanged. Consequential risk: tier-1 reserve exemption previously allowed spent accounts; newly excluded accounts can lead to unknown-account selection, OpenRouter fallback or none. Contract covers these outcomes and preserves cooldown, positive reserve exception, ranking/reset behavior. No API handler modified.

## Phase 2 — implementation and checks
Single implementation attempt: add finite known <=0 exhausted guard after per-account cooldown and before reserve. No changes to sorting, unknown-null eligibility, adapters or global state.
Exact production source diff:
```diff
     const reason = a.exhaustedUntil !== null && a.exhaustedUntil > now ? 'exhausted'
+      : a.quotaRemainingPct !== null && Number.isFinite(a.quotaRemainingPct) && a.quotaRemainingPct <= 0 ? 'exhausted'
       : tier !== 1 && a.quotaRemainingPct !== null && a.quotaRemainingPct <= reservePct ? 'reserve' : null;
```
Test diff: corrected existing unknown-versus-zero tier-1 assertion, added sole 0/-1 rejection plus exact exhausted trace and unchanged inputs; all-zero closed-route rejection/OpenRouter fallback; tiers 2–4 zero exhausted trace; positive 0.1 over unknown; positive/unknown cooldown boundary. Existing AT4 verifies 12 accepted.

GREEN at 23:16:32: `Test Files 1 passed (1); Tests 28 passed (28)`; duration 1.24s; test time 12ms.
Shared tsc command from `apps/api_server`:
```sh
env -i HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db PATH=/opt/homebrew/bin:/usr/bin:/bin node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
Passed, no output or peer error. Owned `git diff --check` passed; exact owned source/test diff inspected. Additive untracked receipts checked for trailing whitespace/newline and contract JSON parsed successfully. Pre-existing shared-worktree changes left untouched. No repair retry needed.

## Handoff
READY_FOR_VERIFICATION for this selector slice only. Live wiring qualification remains with the active smoke owner, NOT RUN here; unknown GitNexus impact remains explicitly unqualified. No project-state update, commit or push.
