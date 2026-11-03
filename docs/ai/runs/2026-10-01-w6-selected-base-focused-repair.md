---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-isolated-session-start-20261001
pr: 1598
issues: [W6-isolated-session-start]
status: unverified
tags: [run, Rhythm]
---

## Files

- `apps/api_server/src/controllers/agent_sessions_controller.ts`: choose isolation before any source checkout; pass the selected branch as the native worktree base. The nonisolated checkout path remains unchanged.
- `apps/api_server/src/services/opencode_client_service.ts`: forward optional `base` in the existing native worktree request.
- `apps/opencode_fork/packages/opencode/src/worktree/index.ts`: accept optional `base`, require an existing local branch, then create the focused branch from that ref without checking it out in the source tree. Existing requests without `base` retain source-HEAD behavior.
- `apps/api_server/src/__tests__/issue_1058_isolate_worktree.test.ts` and `apps/opencode_fork/packages/opencode/test/project/worktree.test.ts`: actual-Git dirty-source/selected-base fixtures, including spaces and a base branch checked out in another worktree. The API test exercises the real HTTP route with a mocked native engine boundary; the fork test exercises real native worktree creation.
- `apps/api_server/src/__tests__/w6_isolated_session_start_live_e2e.test.ts`: env-gated combined sandbox API+engine session Start contract with a disposable Git repository, exact source-state assertions, and owned session/worktree cleanup. Written but not run live in this lane.
- `apps/opencode_fork/packages/sdk/openapi.json` and `apps/opencode_fork/packages/sdk/js/src/v2/gen/types.gen.ts`: additive optional `base` contract for native Worktree.CreateInput; no broad regeneration or other SDK edits.

## Checks

- Before product edits, disposable real Git fixture: `git checkout selected-base` returned 1 with `Your local changes ... would be overwritten by checkout`; source remained on `main` and porcelain status matched exactly.
- After edits, disposable real Git fixture using the selected-base command sequence: local ref exists; focused worktree `HEAD` exactly matches the selected branch checked out elsewhere; selected marker present; source branch/index/status and staged, unstaged, and untracked bytes preserved; three expected worktrees (source, selected, focused).
- Bun TypeScript transpiler parsed the five initial changed source/test files successfully. `git diff --check` passed.
- After the parent authorized dependency symlinks, linked existing main-checkout `node_modules` into this W6 worktree for test execution. No install, lockfile, or manifest change.
- API Vitest `./node_modules/.bin/vitest run src/__tests__/issue_1058_isolate_worktree.test.ts -t 'W6:' --maxWorkers=1 --no-file-parallelism`: 1 pass / 13 skipped. Full relevant API command `./node_modules/.bin/vitest run src/__tests__/issue_1058_isolate_worktree.test.ts src/__tests__/opencode_worktrees_routes.test.ts --maxWorkers=1 --no-file-parallelism`: 28 pass / 0 fail.
- Fork focused `bun test test/project/worktree.test.ts --test-name-pattern 'W6:' --timeout 30000`: 2 pass / 0 fail; full `bun test test/project/worktree.test.ts --timeout 30000`: 15 pass / 0 fail, 45 assertions.
- API `npm run build`: exit 0. Fork package and SDK `bun run typecheck`: exit 0. The new env-gated `w6_isolated_session_start_live_e2e.test.ts` skips in the normal Vitest suite (1 skipped); it is written for the manager's serialized combined sandbox and requires the active `DB_PATH` under the owned sandbox, not the read-only fixture source DB.
- No live API/engine/sandbox or packaged Electron check was run. The W6 contract remains unverified.

## Notes

GitNexus upstream before symbol edits: controller `create` LOW/0; client `createWorktree` HIGH/23 with four direct callers and two indexed processes (session create and delegation); fork `setup`, `createFromInfo`, and `create` LOW/0. The changed fork `CreateInput` is LOW/0 and `Interface` MEDIUM/17; generated SDK/OpenAPI symbols were unindexed (UNKNOWN), so their additive field was inspected by source search. The HIGH impact was disclosed before implementation; the optional request field preserves existing callers. The prior W6 receipt recorded the `/agent-sessions` route as HIGH with eight consumers. No graph result proves runtime isolation.

This is a focused candidate, uncommitted and unpushed. The original contract's broader cases (existing destination, missing repository, concurrent Start) and real API+engine/installed-app gates still need observed results. The missing-base real-Git test checks an actionable error without source or worktree mutation. Source checkout and unrelated worktrees were not changed.
