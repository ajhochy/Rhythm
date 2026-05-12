# Smoke Test: API Notification Bug

Baseline: `state.plan` and `state.plan.coherenceRules`.

Evidence source: diff from base `59f5fec6e2778ef833451ff1cecfd3b03417a394` to `HEAD` on `/Users/ajhochhalter/Documents/wt-api-notification-bug-rvayd3-553`.

- [x] ✅ Diff scope is limited to `apps/api_server/src/app.ts` and `apps/api_server/src/__tests__/notifications_agent_local_bypass.test.ts`.
  - Evidence: `git diff --name-only 59f5fec6e2778ef833451ff1cecfd3b03417a394...HEAD` returned only those two files.
- [x] ✅ `apps/api_server/src/app.ts` only reorders the two notification route mounts so `app.use('/notifications/agent', notificationsAgentRouter)` is registered before `app.use('/notifications', notificationsRouter)`.
  - Evidence: `git diff --numstat ... -- apps/api_server/src/app.ts` returned `1 1`; the diff only moves `/notifications/agent` above `/notifications`. Current `app.ts` lines 67-68 register agent first, generic second.
- [x] ✅ Generic notification auth remains unchanged: `notificationsRouter` still applies `requireAuth`, and `notifications_agent_routes.ts` AGENT_LOCAL bypass logic is not modified.
  - Evidence: `git diff --quiet ... -- notifications_routes.ts notifications_agent_routes.ts` exited `0`; source inspection shows `notificationsRouter.use(requireAuth)` and unchanged `if (!env.agentLocal) notificationsAgentRouter.use(requireAuth)`.
- [x] ✅ New bypass test uses the required module-load pattern: sets `process.env.AGENT_LOCAL = 'true'` before dynamically importing `createApp`, calls `vi.resetModules()`, uses in-memory SQLite with migrations and `setDb`, and mocks `ws_gateway`.
  - Evidence: test lines include `vi.mock('../services/ws_gateway')`, `process.env.AGENT_LOCAL = 'true'`, `vi.resetModules()`, dynamic imports for migrations/db/app, `new Database(':memory:')`, `runMigrations(db)`, and `setDb(db)`.
- [x] ✅ New bypass test proves planned runtime behavior: unauthenticated `POST /notifications/agent` with `AGENT_LOCAL=true` returns `201` with a positive `id`, and invalid payload still returns `400`.
  - Evidence: test name explicitly says no Authorization header with `AGENT_LOCAL=true`; request headers only include `Content-Type`; assertions include `res.status` `201`, `data.id` greater than `0`, and invalid-payload `res.status` `400`.
- [x] ✅ Existing notification-agent auth tests still pass, proving the normal unauthenticated path still returns `401` when `AGENT_LOCAL` is not enabled.
  - Evidence: `cd apps/api_server && npx vitest run src/__tests__/notifications_agent_local_bypass.test.ts src/__tests__/notifications_agent.test.ts src/__tests__/notifications.test.ts` exited `0`; 3 files and 21 tests passed, including `notifications_agent.test.ts`.
- [x] ✅ Existing generic notification tests still pass, proving `/notifications`, `/notifications/read-all`, and `/notifications/:id/read` remain authenticated and unchanged.
  - Evidence: same focused vitest command exited `0`; 3 files and 21 tests passed, including `notifications.test.ts`.
- [x] ✅ TypeScript verification passes for `apps/api_server`.
  - Evidence: `cd apps/api_server && npx tsc --noEmit` exited `0`.

## Results

Passed. The implementation matches the planned route-order fix, adds the planned AGENT_LOCAL local-bypass regression test, preserves generic notification auth behavior, and passes focused API server verification.

Note: the first vitest attempt was blocked by a local `better-sqlite3` Node ABI mismatch (`NODE_MODULE_VERSION 137` vs required `127`). Running `npm rebuild better-sqlite3` in the worktree fixed the local native dependency; the rerun passed.
