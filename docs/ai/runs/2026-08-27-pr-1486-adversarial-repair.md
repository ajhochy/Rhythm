---
date: 2026-08-27
repo: Rhythm
branch: fix/session-list-and-task-board
pr: 1486
issues: [1466, 1475, 1476, 1477]
status: ready_for_verification
tags: [run, Rhythm]
---

# PR #1486 adversarial-review repair

## Files

- Session repository: activity ordering, 500-row descendant cap, inherited filters, cycle-safe recursive IDs, explicit root/child arrays.
- Session consumers: nested children flattened for workflow failure extraction, org audit, MCP memory consolidation, web, and Flutter clients.
- Task status: shared Flutter `isActive`, shared API SQL predicate, dashboard count repair, MCP/mobile Deferred parity, full-history Flutter criterion.
- Web: avatar paint containment, shared `ProfileAvatar`, O(1) session parent/child maps, truthful disclosure controls, no test-only tree wrapper.
- Contracts/tests: repaired #1466 AC4 rationale and evidence; added #1466 bounds/filter tests, #1477 paint assertion, #1475 MCP/mobile/data-source/dashboard coverage, and Deferred empty-state assertion.

## Checks

### Phase 0 failing acceptance evidence

- `cd apps/api_server && npx vitest run src/repositories/agent_sessions_repository.test.ts`
  - Expected failure: 3 failed, 24 passed.
  - `issue-1466-c4`: old root with newest `last_activity_at` was absent from the 100-root result.
  - `issue-1466-c5`: 501 descendants were returned instead of the 500 cap.
  - `issue-1466-c6`: archived, system, and cross-category children leaked into a chat root.
- `cd apps/web && npx playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts -g issue-1477`
  - Expected failure: 1 failed.
  - `.profile-avatar` computed `overflow: visible`, contradicting paint-containment evidence.

### Passing focused validation

- `cd apps/api_server && npm run build`
  - PASS: TypeScript build.
- `cd apps/api_server && npx vitest run src/repositories/agent_sessions_repository.test.ts src/__tests__/delegated_session_isolation.test.ts src/__tests__/workflow_failure_signal_extractor.test.ts src/services/__tests__/org_audit_service.test.ts src/__tests__/tasks_repository.test.ts src/__tests__/dashboard_summary.test.ts`
  - PASS: 6 files, 152 tests.
- `cd apps/mcp_server && npm run typecheck`
  - PASS.
- `cd apps/mcp_server && npm test -- --run src/tools/__tests__/tasks.test.ts src/__tests__/agentSessions_tool.test.ts`
  - PASS: 2 files, 18 tests.
- `cd apps/web && npm run build`
  - PASS.
- `cd apps/web && npx playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts -g issue-1477`
  - PASS: 1 rendered test.
- `cd apps/web && npx playwright test --config tests/post-m1-phase-5-fixture-playwright.config.ts tests/post-m1-phase-5-approvals-delegation.redspec.ts -g issue-1476`
  - PASS: 1 rendered test.
- `cd apps/desktop_flutter && /Users/ajhochhalter/development/flutter/bin/dart format . --set-exit-if-changed`
  - PASS after formatting the two intended changed files.
- `cd apps/desktop_flutter && /Users/ajhochhalter/development/flutter/bin/flutter analyze --no-fatal-infos`
  - PASS (exit 0; 318 pre-existing infos).
- `cd apps/desktop_flutter && /Users/ajhochhalter/development/flutter/bin/flutter test test/features/tasks/issue_1037_kanban_view_test.dart test/features/tasks/tasks_local_data_source_test.dart`
  - PASS: 10 tests.
- `cd apps/mobile_flutter && /Users/ajhochhalter/development/flutter/bin/flutter analyze --no-fatal-infos`
  - PASS: no issues.
- `cd apps/mobile_flutter && /Users/ajhochhalter/development/flutter/bin/flutter test test/features/tasks/task_status_test.dart`
  - PASS: 1 test.
- `git diff --check`
  - PASS.
- `gitnexus detect_changes(scope=all, worktree=...)`
  - FAILED for the recorded infrastructure mismatch: index storage v42, runtime storage v41.

### Deferred serial verification

- The env-gated `issue_1466_1475_live_e2e.test.ts` was extended to seed 100 newer roots around one old root with newest activity, while retaining the 101-child nesting proof.
- It was not run because the user reserved the single shared sandbox for later serial verification.

### Clean-main full-suite test repair

- `WAIVED: test-only assertion repair with no product behavior change; verification is the focused four-test run, clean-environment full API suite, build/tsc, and product-source-empty diff.`
- Repaired only inherited test assumptions: explicit empty CORS input, nested child visibility, flattened duplicate counting, and direct persisted SDK-session lookup. The nested repository contract and product consumers were unchanged.
- `cd apps/api_server && RHYTHM_LOCAL_RENDERER_ORIGINS='' npx vitest run src/services/opencode_client_service.test.ts src/__tests__/background_status.test.ts src/__tests__/issue_743_child_session_persistence.test.ts src/__tests__/issue_751_session_mapping.test.ts`
  - PASS: 4 files, 86 tests.
- `cd apps/api_server && /usr/bin/env -i HOME="$HOME" PATH="$PATH" TMPDIR="$TMPDIR" npm test`
  - PASS: 636 files / 5,970 tests; 118 files / 207 tests skipped by their existing gates; 754 files / 6,177 tests total.
- `cd apps/api_server && npm run build`
  - PASS: TypeScript build and postbuild.
- `cd apps/api_server && npx tsc --noEmit`
  - PASS.
- `git diff --check`
  - PASS.
- `git diff --exit-code -- ':(glob)apps/api_server/src/**/*.ts' ':(glob,exclude)apps/api_server/src/**/*.test.ts'`
  - PASS: product-source diff empty.
- GitNexus impact attempts for `resolveOpencodeCorsOrigins`, `listAll`, `flattenAgentSessionTree`, and `findBySdkSessionId`, plus `detect_changes(scope=all)`, returned the expected index storage v42/runtime storage v41 incompatibility. Risk remained `UNKNOWN`; no HIGH or CRITICAL result was returned.
- Sandbox/live gate intentionally not run: this change is test-only and PR #1489 owns sandbox verification. Existing PR #1486 live evidence remains ready for that serial gate.

## Finding disposition

- **F1 fixed.** Root queries use `COALESCE(last_activity_at, updated_at, created_at) DESC`. #1466 AC4 is `pass` on executable evidence, not the former contradicted rationale.
- **F2 fixed.** Recursive descendants are globally capped at 500, bounding a default response to at most 100 roots + 500 descendants.
- **F3 fixed.** Descendants inherit archive/category/system predicates; project lists also inherit project/system predicates. Recursive IDs use `UNION`, preventing duplicate-ID cycling.
- **F4 fixed.** Workflow failure extraction and org audit flatten nested children before child-aware processing; `rhythm_list_sessions` does the same before projection.
- **F6 fixed.** The web mapper comment now documents canonical `parentSessionId` normalization instead of forbidding the assignment it performs.
- **F7 fixed.** Removed the empty “Sub agents” disclosure button and its false `aria-expanded` state.
- **F9/F10 fixed.** Avatar cells now use `overflow:hidden; white-space:nowrap`; Playwright asserts computed overflow and `scrollWidth <= clientWidth`. `AgentsWorkspace` reuses `ProfileAvatar`.
- **F12 fixed.** `rhythm_update_task` accepts and documents `deferred`; schema test passes.
- **F13 fixed.** Flutter uses `TaskStatus.isActive`; API SQL uses `ACTIVE_TASK_STATUS_SQL`; canonical sorting and dashboard past-due/deadline counts exclude Deferred.
- **F14 fixed.** Mobile Flutter decodes and re-encodes Deferred without silently PATCHing Open.
- **F15 fixed/disclosed.** #1475 now includes an explicit criterion; a real loopback HTTP test proves `fetchAll()` requests `/tasks?status=all`. This intentionally downloads full task history so Done/Deferred columns work.
- **F16 fixed.** The fifth Deferred empty state is asserted.
- **Ponytail fixed.** Removed duplicate avatar markup, unreachable parent fallback, O(n·m) session lookups, test-only tree wrapper, and positional root/child slice coupling.

## Notes

- Sandbox intentionally not started: the shared serial sandbox is reserved while sibling worktrees are active.
- GitNexus query and every planned symbol impact call failed with the requested recorded compatibility error: index storage v42, current runtime storage v41. Risk therefore remained `UNKNOWN`; exact caller/file inspection was used as the fallback. No HIGH or CRITICAL result was returned.
- This run is included in the single test-only repair commit; no push performed.

## Final PR #1486 evidence gate

WAIVED: evidence-only screenshots/tests/docs with no product behavior change; verification is: existing rendered Playwright fixtures generate stable PNGs, pass their normal comparator, and production-source diff remains empty.

- Live behavior remains green from the isolated S5 gate: `issue_1466_1475_live_e2e.test.ts` passed **2/2** against API `:4098` and engine `:4097`; cleanup restored `users:1 sessions:1 agent_sessions:0 tasks:0`, all marker queries returned zero, and `PRAGMA integrity_check` returned `ok`.
- API: focused six-file product regression passed **152 tests** after adversarial repair; clean-environment full suite passed **5,970** with **207** existing gated skips; build and `tsc --noEmit` passed.
- MCP: typecheck passed; focused session/task suites passed **18/18**.
- Web/Electron: `cd apps/web && npm run build` passed; the exact #1476 and #1477 rendered fixture commands passed **1/1** each under their existing configs with the normal screenshot comparator (no update flag).
- Flutter desktop: format and analyze passed (318 pre-existing infos); focused task tests passed **10/10**, the earlier six-file grouping/task gate passed **33/33**, and constrained #1477 header passed **1/1**.
- Mobile Flutter: analyze passed with no issues; Deferred status test passed **1/1**.
- Standalone artifacts:
  - `apps/web/tests/post-m1-phase-5-approvals-delegation.redspec.ts-snapshots/issue-1476-nested-session-darwin.png` — **1440x900**, SHA-256 `9488c0dc55b7d9e5c6b35b13a92bcddd254069f6b50c1162c8fc4fd52b18cfca`.
  - `apps/web/tests/bucket-a-rendered-repair.spec.ts-snapshots/issue-1477-constrained-session-header-darwin.png` — **1024x768**, SHA-256 `26b935d1a9c4e5d24a579d0a5c6e1f3e86b33a31dc503e7cdebfae6223e2a9f4`.
- Integrity: sanitized fixture config remained SHA-256 `600e88fa2f58de29accb587d1eb489061a4b095bbecb6cee986fd9a0e014d7c0` before/after the live run. `git diff --check` passed, and `git diff --exit-code HEAD -- ':(glob)apps/**/src/**' ':(glob)apps/desktop_flutter/lib/**' ':(glob)apps/mobile_flutter/lib/**'` proved this evidence run's production-source diff empty.
- GitNexus remains **UNKNOWN**: query/impact/detect attempts fail because the index is storage v42 while the connected runtime is v41; no HIGH/CRITICAL result was returned.
- Manual item retained: #1476 cross-client visual parity is subjective and remains `not_tested`; these web/Electron artifacts do not falsely mark it pass.
- No sandbox or standalone preview was started for this evidence run; only the existing Playwright fixture configs launched their managed Vite servers.
