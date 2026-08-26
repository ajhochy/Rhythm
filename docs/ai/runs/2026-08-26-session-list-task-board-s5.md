---
date: 2026-08-26
repo: Rhythm
branch: fix/session-list-and-task-board
pr: pending
issues: [1466, 1476, 1477, 1475]
status: ready-for-verification
tags: [run, rhythm]
---

# S5 — session list and task board UI

## Files

- API session model/repository and delegated-session regression tests.
- Web session gateway, nested rail, header avatar, and Playwright contracts.
- Flutter nested-session adapter and existing grouping contracts.
- API, Flutter, and web task status/filter/board models for `deferred`.
- Acceptance contracts: `docs/ai/contracts/issue-{1466,1475,1476,1477}.json`.

## Checks

- Phase 0 red evidence:
  - `cd apps/api_server && npx vitest run src/repositories/agent_sessions_repository.test.ts src/__tests__/tasks_permissions.test.ts src/__tests__/tasks_controller.test.ts` — 6 expected contract failures.
  - `cd apps/web && npx playwright test --config tests/post-m1-phase-5-fixture-playwright.config.ts tests/post-m1-phase-5-approvals-delegation.redspec.ts -g issue-1476` — expected nesting failure.
  - `cd apps/web && npx playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts -g issue-1477` — expected raw asset-path failure.
  - `cd apps/web && RHYTHM_E2E_PORT=4273 RHYTHM_DIST_PORT=4274 npx playwright test tests/tasks/task-live-lifecycle.fixture.spec.ts -g issue-1475` — expected missing Deferred column failure.
  - `cd apps/desktop_flutter && $HOME/development/flutter/bin/flutter test test/features/tasks/issue_1037_kanban_view_test.dart --plain-name issue-1475` — 2 expected missing Deferred failures.
- API final: `npx vitest run src/repositories/agent_sessions_repository.test.ts src/__tests__/delegated_session_isolation.test.ts src/__tests__/agent_sessions.test.ts src/__tests__/tasks_permissions.test.ts src/__tests__/tasks_controller.test.ts src/__tests__/tasks_repository.test.ts && node_modules/.bin/tsc --noEmit` — 136/136 passed; typecheck exit 0.
- Web final:
  - `npm run build` — exit 0.
  - issue #1476 Playwright contract plus prior child-identity contract — 2/2 passed.
  - issue #1477 Playwright header collision contract — 1/1 passed.
  - task count/click-through/Deferred contracts — 3/3 passed.
- Flutter final: `dart format . --set-exit-if-changed && flutter analyze --no-fatal-infos && flutter test test/features/tasks/issue_1037_kanban_view_test.dart test/features/tasks/issue_908_sort_test.dart test/contract/issue_1244_task_organization_test.dart` — format exit 0; analyze exit 0 with 318 pre-existing infos; focused tests passed (15 reported in the task-board suite).
- `git diff --check origin/main...HEAD` — exit 0.
- GitNexus impact and `detect_changes(scope: compare, base_ref: main)` were invoked before edits/commits but unavailable: LadybugDB index storage version 42, connected client version 41. Risk remains `UNKNOWN`; no HIGH/CRITICAL result was returned.
- Dev sandbox: intentionally not started per shared-resource constraint.

## Notes

- #1466 keeps `created_at` ordering. `last_activity_at` was considered but is not reliably propagated from descendants to roots, so changing it would not solve the quota bug and was left out of scope.
- #1477 is web/Electron-only. Flutter uses a normal `Row`, a typed `AgentKindBadge`, and an `Expanded` title with ellipsis; it never paints the raw asset path into the header.
- #1475 needs no SQLite migration, Postgres enum change, or backfill: both schemas store task status as unconstrained `TEXT`. Runtime validation/types were widened identically for both database clients.
- Manual verification remains for visual parity of nested session grouping and cross-client visual confirmation; these criteria are listed in the contract `not_tested` arrays.

## Test-coverage repair handoff

- Intent: add the missing live HTTP and rendered layout evidence only; no product source was changed and no product defect was found.
- Added env-gated `issue_1466_1475_live_e2e.test.ts`. It seeds only a disposable sandbox user/session token and #1466 rows in SQLite, drives #1466/#1475 through `127.0.0.1:4098`, and cleans up its marked rows. The real live run remains pending because S3 owns the sole sandbox; contract criteria remain `UNVERIFIED`/`not_tested`.
- Phase 0 fail-closed check: `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/issue_1466_1475_live_e2e.test.ts --no-file-parallelism` rejected the unattested environment with `Issues #1466/#1475 live E2E requires the attested isolated sandbox`.
- Pre-verification commands run without starting a sandbox:
  - `npx vitest run src/__tests__/issue_1466_1475_live_e2e.test.ts --no-file-parallelism` — suite skipped cleanly (1 file, 2 tests).
  - API focused six-file regression command — 136 tests completed; `node_modules/.bin/tsc --noEmit` exited 0.
  - `npm run build` and the issue #1476/#1477 Playwright config commands — build exited 0; each rendered spec completed once.
  - `$HOME/development/flutter/bin/dart format . --set-exit-if-changed` and `$HOME/development/flutter/bin/flutter analyze --no-fatal-infos` — exited 0; analyze reported 318 pre-existing infos. Corrected five-file focused Flutter command completed 33 tests. The first test command named a nonexistent `issue_910_session_grouping_test.dart`; the retry used the existing `issue_910_subagent_collapse_test.dart`.
  - `git diff --check` — exited 0.
- GitNexus impact and `detect_changes(scope: all)` were retried and remain unavailable because the index is storage v42 while the connected client is v41. Risk is `UNKNOWN`; no HIGH/CRITICAL result was returned.
- Verification handoff: rerun the new live suite serially in S3's isolated sandbox with the contract command, then update evidence/statuses only from that observed run.
