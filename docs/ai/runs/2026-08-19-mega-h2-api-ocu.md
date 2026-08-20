---
date: 2026-08-19
repo: Rhythm
branch: codex/mega-h2-api-ocu
pr: null
issues: [1058, 1063, 1088]
status: ready_for_verification
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
