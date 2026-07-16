# Discovery-003: Un-break the external-discovery crons

## Goal

Get the "found" path actually running on its intended schedule. Re-enable the disabled discovery scheduled-tasks, fix the errored daily `Org Self-Optimizer` task, and resolve the duplicate `Org External Discovery` / `Org External Discovery v2` seed so exactly one enabled task exists. Reconcile the stale doc comment that claims discovery is "skipped here" against the code, which runs it inline.

## Context

From live `rhythm.db`: the discovery schedules are half-broken —
- `Org Self-Optimizer` (daily @ 02:00): `enabled=0`, last run **errored** (2026-07-10).
- `Org External Discovery` (weekly, Sun @ 03:00): `enabled=0`, last success 2026-07-12.
- `Org External Discovery v2` (weekly): `enabled=1` but has **never run** (first run 2026-07-19).

So discovery has effectively run ~3 times in 5 days. This is a prerequisite for the found path being usable at all (though Discovery-004 makes it gap-driven and Discovery-005 makes it work on Postgres).

The seeder creates these at boot. The run-service header (`org_optimizer_run_service.ts:28-33`) and MCP tool description (`apps/mcp_server/src/tools/orgOptimizer.ts:28`) both claim external discovery is "skipped here / on its own separate schedule," but the Stage B code (`org_optimizer_run_service.ts:333-351`) runs it inline every pass. The comment is stale.

## Likely files

- `apps/api_server/src/services/org_optimizer_seed.ts` — `seedOrgOptimizerTask` (`:240`), daily seed (`:314-326`), weekly seed (`:363-376`), `EXTERNAL_DISCOVERY_PROMPT` (`:151-171`)
- `apps/api_server/src/server.ts` — seed call site (`:289`)
- `apps/api_server/src/services/org_optimizer_run_service.ts` — stale header (`:28-33`), inline Stage B discovery (`:333-351`)
- `apps/mcp_server/src/tools/orgOptimizer.ts` — stale description (`:28`)
- `agent_scheduled_tasks` rows (runtime data — fix via seed reconciliation, not a manual DB edit)

## Acceptance Criteria

- [ ] **Single enabled discovery task:** the seed reconciles the `Org External Discovery` / `v2` duplication so exactly one enabled weekly discovery task exists after boot (remove/disable the stale duplicate; do not leave two).
- [ ] **Daily optimizer re-enabled & non-erroring:** the `Org Self-Optimizer` daily task is enabled and its last-run error root cause is fixed (capture the error, fix, and add a regression guard). If the error is environmental (e.g. Postgres — see Discovery-005), note the dependency explicitly and gate accordingly.
- [ ] **Idempotent seeding:** re-running `seedOrgOptimizerTask` does not create duplicate tasks or re-disable a user-enabled task (respect an existing row's `enabled` unless it's a known-bad seed). Document the reconciliation rule.
- [ ] **Docs reconciled:** the stale "external discovery skipped here" comments (`org_optimizer_run_service.ts:28-33`, `orgOptimizer.ts:28`) are corrected to match the inline-every-pass behavior.
- [ ] **vitest:** cover (a) boot seeds exactly one enabled weekly discovery task; (b) re-seed is idempotent; (c) an already-enabled task is not clobbered.
- [ ] `tsc --noEmit && npx vitest run` passes in `apps/api_server`.

## Dependencies

- Interacts with Discovery-005 (Postgres): on Postgres the seeder currently early-returns, so "re-enable" only takes effect locally until 005 lands. Note the dependency; do not block 003 on 005.

## Out of Scope

- Making discovery gap-driven / event-triggered (Discovery-004).
- Postgres parity (Discovery-005).

## Data safety

- No customer/private data. Scheduled-task rows contain prompts/config only.
