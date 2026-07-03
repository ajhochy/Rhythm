# org-optimizer-14: Seeded optimizer cron task(s)

## Goal

Seed the recurring optimizer as a name-guarded scheduled task bound to a new,
narrowly-scoped "Org Optimizer" agent profile, plus a separate, less-frequent
seeded task for external discovery. Wire per-run caps and the #746 cold-start
throttle.

## Context

Per decision doc §1/§6/§8: the optimizer is a seeded scheduled task of the same
shape as `agentMemoryService.seedConsolidationTask()` — name-guarded
(`listAllAsync().some(t => t.name === 'Org Self-Optimizer')`), dispatched via the
unchanged `AgentRunner.run` local path. The optimizer agent's `.mcp-roles` role is
read-audit + write-proposals only; it cannot write `agent_configs` /
`allowed_delegates_json` / `agent_webhook_endpoints` from its tool surface.

## Likely files

- `apps/api_server/src/services/agentMemoryService.ts` (add `seedOrgOptimizerTask`)
  or NEW `apps/api_server/src/services/org_optimizer_seed.ts`
- boot wiring (wherever `seedConsolidationTask()` is invoked at startup)
- NEW `.mcp-roles/org-optimizer.mcp.json` (read-audit + write-proposals scope)
- NEW `.mcp-roles/org-external-discovery.mcp.json` (external sources +
  write-proposals)

## Acceptance Criteria

- [ ] `seedOrgOptimizerTask()` is idempotent — name-guarded; calling it on every
  boot inserts at most one "Org Self-Optimizer" task and one external-discovery
  task.
- [ ] The internal audit task runs daily (e.g. 02:00); the external-discovery task
  runs less frequently (e.g. weekly) — both configurable.
- [ ] Both tasks are bound to narrowly-scoped profiles with valid `.mcp-roles`
  role files that pass the alignment guards; the optimizer role grants only
  read-audit + write-proposals (no config/delegation/webhook write tools).
- [ ] The run respects the #746 cold-start window and enforces per-run caps
  (proposals/run, LLM calls/run; external results/run for the discovery task).
- [ ] The seeded prompt instructs the agent to: build the audit snapshot, run the
  generators, write proposals (deduped), let low-risk auto-apply, and leave
  high-risk in the queue.

## Required tests

- seed idempotency contract: no duplicate task on repeated seed; both tasks
  present once.
- throttle/cap contract: a run exceeding the cap stops at the cap; cold-start
  window respected.
- role-file contract: the optimizer role file is valid and names ⊆ live; it omits
  any privileged-write tool.

## Dependencies / order

Depends on 03–13 (the audit, predicate, auto path, generators, queue). Last
functional issue before guards/smoke (15).

## Safety notes

The optimizer agent is powerful — its scope is the strongest safety boundary.
Privileged writes happen server-side behind the queue, never from the agent's
tools. Local-only; no production scheduling in v1.
