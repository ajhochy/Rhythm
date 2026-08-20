---
date: 2026-08-19
repo: Rhythm
branch: codex/mega-h2-api-ocu
pr: null
issues: [1058, 1063, 1088]
status: blocked
tags: [run, Rhythm]
---

## Files

- `apps/api_server/src/services/agent_runner.ts` — background-run worktree isolation.
- `apps/api_server/src/database/migrations.ts` — corrected the Postgres parity note.
- `apps/api_server/src/__tests__/issue_738_agent_runner.test.ts` — AgentRunner isolation contract.
- `apps/api_server/src/__tests__/live_e2e_1057_worktree.test.ts` — env-gated real API/engine session + VCS contract.
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — transcript-header idle refresh.
- `apps/desktop_flutter/test/features/agents/ocu_1063_1066_header_actions_test.dart` — idle-refresh widget contract.
- `docs/ai/contracts/issue-1058-1063-1088.json` — combined acceptance contract.
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — primary-root resolution shared by hard delete, reset, and standalone removal; engine-session deletion now precedes opted-in worktree removal.
- `apps/api_server/src/services/vcs_probe.ts` — fail-closed primary-worktree porcelain parser/probe.
- `apps/api_server/src/__tests__/issue_1058_isolate_worktree.test.ts` — primary-root, ordering, parser/probe, reset/remove, and failed-removal row-retention coverage.
- `apps/api_server/src/__tests__/live_e2e_1057_worktree.test.ts` — exact linked directory and branch-ref deletion assertions.
- `apps/api_server/src/__tests__/live_e2e_1088_hidden_schedulable.test.ts` — `completed_no_op` terminal expectation, sandbox projection path, mandatory nonempty output, and clear credential/credit environment failure.
- `apps/desktop_flutter/test/features/agents/ocu_1063_1066_header_actions_test.dart` — actual `_TranscriptHeader` golden assertion through `TranscriptHeaderTestHarness`.
- `apps/desktop_flutter/test/features/agents/goldens/ocu_1063_branch_dirty_header.png` — checked-in 1200×180 branch/dirty header golden.

## Checks

- Pre-implementation: `npx vitest run src/__tests__/issue_738_agent_runner.test.ts` — **failed as expected**: `mockCreateWorktree` had 0 calls.
- Pre-implementation Flutter attempt: header test did not complete before the tool timeout; replaced its stream-heavy fixture with a deterministic header transition harness.
- `npx tsc --noEmit` — **pass**.
- `npx vitest run src/__tests__/issue_1058_isolate_worktree.test.ts src/__tests__/issue_738_agent_runner.test.ts src/__tests__/issue_1063_1066_vcs_shell_init.test.ts src/__tests__/opencode_worktrees_routes.test.ts src/services/__tests__/opencode_agent_writer_projection.test.ts src/repositories/agent_configs_repository.test.ts` — **pass, 118/118**.
- `npx vitest run src/__tests__/live_e2e_1057_worktree.test.ts` — **compiled; 2 skipped** because `RHYTHM_LIVE_E2E` was not set.
- `dart format . --set-exit-if-changed` — **pass, 507 files checked, 0 changed**.
- `flutter test test/features/agents/ocu_1063_1066_header_actions_test.dart` — **pass, 12/12**.
- `flutter analyze --no-fatal-infos` — **exit 0**, 311 pre-existing infos; no new error/warning.
- GitNexus `detect_changes(scope: all)` — **LOW**, 5 indexed changed symbols, 0 affected processes. The index did not resolve private AgentRunner symbols.
- Live sandbox contract — **not run**: dispatch explicitly forbids `tools/dev/sandbox.sh`; workflow-orchestrator owns serial sandbox verification.

### H2 repair attempt 1 — 2026-08-20

- Acceptance red: `npx vitest run src/__tests__/issue_1058_isolate_worktree.test.ts --no-file-parallelism` — **failed as expected, 3/12**: linked cwd was passed as engine directory, engine deletion did not precede failed cleanup, and primary-worktree helpers were absent.
- `node .gitnexus/run.cjs analyze` — **could not run** because `.gitnexus/run.cjs` is absent in this worktree. Required impacts for `AgentSessionsController.destroy`, `resetWorktree`, `removeWorktree`, and `probeVcs` remained **UNKNOWN**; destructive path was manually treated as **HIGH**. `_TranscriptHeader` was not edited.
- `npx tsc --noEmit` — **pass** (before and after live-test adjustment).
- `npx vitest run src/__tests__/issue_1058_isolate_worktree.test.ts src/__tests__/live_e2e_1057_worktree.test.ts --no-file-parallelism` — **pass, 13 passed / 2 live skipped**.
- `npx vitest run src/__tests__/issue_1048_engine_session_delete.test.ts src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts --no-file-parallelism` — **pass, 5/5**.
- `dart format . --set-exit-if-changed` — first run formatted the new golden test; rerun **pass, 507 files / 0 changed**.
- `flutter analyze --no-fatal-infos` — **exit 0**, 311 pre-existing infos.
- `flutter test --update-goldens test/features/agents/ocu_1063_1066_header_actions_test.dart` — **pass, 13/13**, generated `goldens/ocu_1063_branch_dirty_header.png` at **1200×180**.
- `flutter test test/features/agents/ocu_1063_1066_header_actions_test.dart` — **pass, 13/13**.
- Fork build: `bun run build --single` — **pass**, smoke-tested `opencode-darwin-arm64`.
- API build: `npm run build` — **pass**.
- Sandbox: only `/tmp/rhythm-dev-sandbox-mega-h2-repair`, API `4698`, engine `4697`; preflight proved both free. Protected listeners were API `4001` PID 30369 and engine `4096` PID 30381.
- Live #1058: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4698 DB_PATH=/tmp/rhythm-dev-sandbox-mega-h2-repair/rhythm.db RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-mega-h2-repair/rhythm.db RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-mega-h2-repair npx vitest run src/__tests__/live_e2e_1057_worktree.test.ts --no-file-parallelism` — **pass, 2/2**. Hard delete returned 204; the exact test-created linked directory and exact `worktreeBranch` ref were absent.
- Live #1088, same sandbox/env: first run exposed the test reading host HOME instead of sandbox HOME; adjusted the test-only path. Rerun reached scheduler terminal status **`completed_no_op`**, projected `mode: all`, and created a session bound to the generated profile ID, but assistant output was empty because the configured provider reported insufficient credits. **Environment failure; issue-1088-c3 remains UNVERIFIED and in `not_tested`.** No credential value is recorded.
- Cleanup: `tools/dev/sandbox.sh down` removed the exact sandbox; ports `4698/4697` are free; protected listeners `4001` PID 30369 and `4096` PID 30381 remained intact.

## Notes

- #1057's worktree wrappers, routes, and typed lifecycle relay exist in this checkout.
- The base commit already contained the interactive #1058 implementation, #1063 wrappers/routes/typed branch relay/header badge, and #1088 schedulability separation. This run closes the uncovered AgentRunner-isolation and turn-idle-refresh criteria.
- `agent_sessions` is skipped by hosted-cloud Postgres bootstrap, but it is created for role-enabled Postgres agent-execution deployments. Therefore `postgres_bootstrap.ts` **does need parity there**, and already defines `worktree_name`, `worktree_path`, and `worktree_branch`. The prior SQLite-only comment was corrected.
- SQLite migration SQL is exactly:
  - `ALTER TABLE agent_sessions ADD COLUMN worktree_name TEXT`
  - `ALTER TABLE agent_sessions ADD COLUMN worktree_path TEXT`
  - `ALTER TABLE agent_sessions ADD COLUMN worktree_branch TEXT`
- All three statements are PRAGMA-guarded, additive, nullable, and non-destructive. No drop, alter-type, rewrite, or data deletion was added.
- #1088 projection remains intentionally disabled when `dbClient === 'postgres'`; hidden profiles use `schedulable ?? sessionSelectable` locally, while picker visibility still uses `sessionSelectable`.
- GitNexus reported no HIGH or CRITICAL impact. `_TranscriptHeader` was LOW; private AgentRunner symbols were unresolved/UNKNOWN.
- Primary-root algorithm: registered project cwd → first validated `worktree` entry from `git -C <linked> worktree list --porcelain` (including a valid bare entry) → existing linked-path fallback. Git/protocol failures return null; destructive engine calls still fail closed and retain local metadata.
- Deletion ordering/fail-closed proof: unit invocation order asserts engine `deleteSession` before `removeWorktree`; a false worktree removal returns 502 while preserving worktree name/path/branch and the local row. Omitted `removeWorktree` still performs no worktree cleanup.
