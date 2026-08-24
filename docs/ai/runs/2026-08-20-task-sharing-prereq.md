---
date: 2026-08-20
repo: Rhythm
branch: codex/mega-prereq-task-sharing
pr: null
issues: [task-bucket-a-task-sharing-prereq]
status: ready_for_verification
tags: [run, Rhythm]
---

## Contract

- Contract: `docs/ai/contracts/task-bucket-a-task-sharing-prereq.json`
- Test: `apps/api_server/src/__tests__/tasks_permissions.test.ts`
- Failing before fix: `npx vitest run src/__tests__/tasks_permissions.test.ts --no-file-parallelism` ran 5 tests with 1 failure. The collaborator PATCH returned the correct collaborator data but `isShared: false` instead of `true`.
- Passing after fix: the same command ran 5/5 tests successfully.

## Files changed

- `apps/api_server/src/repositories/tasks_repository.ts`
- `apps/api_server/src/__tests__/tasks_permissions.test.ts`
- `docs/ai/contracts/task-bucket-a-task-sharing-prereq.json`
- `docs/ai/runs/2026-08-20-task-sharing-prereq.md`

## Checks run

- `cd apps/api_server && npx tsc --noEmit` — exit 0.
- `cd apps/api_server && npx vitest run src/__tests__/tasks_permissions.test.ts --no-file-parallelism` — 1 file passed, 5 tests passed.
- `cd apps/api_server && npm run build` — exit 0; TypeScript build and advisory copy completed.
- GitNexus pre-edit impact: exact method/class symbols were unavailable in the current index (`UNKNOWN`), while the containing repository and controller files both reported `LOW` risk with zero indexed dependents/processes. No HIGH/CRITICAL result.
- GitNexus `detect_changes(scope: all)` — low risk; 2 changed indexed files, no affected indexed processes.

## Notes

- Root fix: `findByIdAsync` and `findById` now select the established list-query expression `CASE WHEN tasks.owner_id != <viewer bind> THEN 1 ELSE 0 END AS is_shared`. The expression is centralized in `taskSharingSelect`; SQLite binds the viewer once for the projection and once for visibility.
- The integration test drives the real HTTP `PATCH /tasks/:id` controller path as the collaborator and verifies the returned task title, `isShared: true`, and collaborator projection.
- Sibling reads were checked. Viewer-scoped list/filter reads now reuse the same expression; unsafe, legacy, and source reads have no viewer context and were left unchanged.
- The worktree initially lacked dependencies. `npm ci` was run in `apps/api_server`; `node_modules` is ignored and not part of the diff.
- Sandbox/live verification was not run per dispatch; final stacked verification owns it.
