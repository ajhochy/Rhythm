---
date: 2026-07-02
repo: Rhythm
branch: mega-846-ministry-recipes
pr: null
issues: [846]
status: done
tags: [run, rhythm]
---

## Files

- `apps/api_server/src/services/ministry_recipes_seed.ts` (new) — seeds three
  ministry recipes (Sunday Service Prep / Volunteer Follow-up / Weekly
  Ministry Review), each an `agent_scheduled_tasks` row + materialized
  `agent_skills` skill, idempotent by task name + skill title.
- `apps/api_server/src/__tests__/ministry_recipes_seed.test.ts` (new) —
  contract tests for issue-846-c1..c4.
- `apps/api_server/src/server.ts` — one additive boot-time seed call, mirrors
  the five sibling seeds already in the `env.agentExecutionEnabled` block
  (memory consolidation, agent-stack skills, skill metadata backfill,
  obsidian read-scope backfill, skill measurement recovery).
- `docs/ai/contracts/issue-846.json` (new) — acceptance contract, all 4
  criteria `pass`.

## Checks

- `npx vitest run recipe scheduler agent_skills seed` — 10 files / 95 tests
  pass.
- `npx vitest run` (full suite) — 183 files / 1569 tests pass.
- `./node_modules/.bin/tsc --noEmit` — clean.
- Falsification: replaced the idempotency guard
  (`existingTasks.some(t => t.name === recipe.taskName)`) with `false`;
  issue-846-c3 failed as expected (9 duplicated tasks instead of 3); guard
  restored, suite re-verified green.

## Notes

**Recipe definitions:**

| Recipe | Schedule | Agent (role) | Skill title | Vault output |
|---|---|---|---|---|
| Sunday Service Prep | weekly, Wed 09:00 | worship-planning | `ministry-sunday-service-prep` | `ministry/YYYY-MM-DD-sunday-service-prep.md` |
| Volunteer Follow-up | weekly, Mon 08:00 | secretary | `ministry-volunteer-follow-up` | `ministry/YYYY-MM-DD-volunteer-follow-up.md` |
| Weekly Ministry Review | weekly, Fri 16:00 | secretary | `ministry-weekly-review` | `ministry/YYYY-MM-DD-weekly-review.md` |

**Seeding mechanism:** mirrors `agentMemoryService.seedConsolidationTask()`
(scheduled task, idempotent by name) + `skill_materializer.materializeSkill()`
(agent_skills row idempotent by title, written to the Rhythm-managed skills
dir via `writeManagedSkill`, engine notified via `reloadSkills()`). Runs
inside `server.ts`'s existing `env.agentExecutionEnabled` boot block,
no-op under Postgres.

**Scoping design decision:** the task's `agentConfigId` is READ from the live
`.mcp-roles/<role>.mcp.json` file at seed time (never hardcoded, never
written) because that UUID is runtime data — the user's actual
worship-planning / secretary Agent Profile — that exists only in the role
file, not in any migration/preset. The task's own `allowedMcpsJson` is built
directly from the role file's `mcpServers` map (the exact grants already
declared there, passed through verbatim to
`resolveProfileScope`'s tools-map format) so the scheduled run gets the same
fine-grained scope the role file promises. `.mcp-roles/*.json` files
themselves were only READ, never modified, per this issue's ownership rules.

**Missing tool grants discovered:** none. All three recipes were written
using ONLY tools already granted in `worship-planning.mcp.json` /
`secretary.mcp.json` (verified by contract test issue-846-c4, which checks
every `rhythm_*`/`pco_*`/`obsidian_*` token in each skill body against the
real role file's `allowedTools`). Notably, the PCO tools available to
worship-planning are the bare `pco-services` names (`get_plans`,
`get_plan_items`, `get_needed_positions`, etc.) — NOT `rhythm_pco_*` (that
prefix is used elsewhere for a different tool registration path); the Sunday
Service Prep skill body was corrected to use the bare names during
implementation.

**Deviations from the issue text:** none of substance. The scheduled-task
`scheduleType` used is `weekly` with an explicit `scheduledDay` (numeric,
`computeNextRun`'s JS-Date convention) for all three recipes — the issue did
not specify exact cadence, so weekly on a sensible day (Wed for Sunday prep
lead time, Mon for follow-up, Fri for weekly review) was chosen as a
reasonable default; trivially adjustable via `agent_scheduled_tasks` update
once the maintainer smokes live PCO/vault behavior.

**Risks:**
- Live-run behavior (real PCO calls, real vault writes) is unverified by this
  change per the issue's explicit note — tests validate seeding, task/skill
  shape, scoping, and idempotency only.
- If a role file's `agentConfigId` changes (e.g. the profile is recreated in
  the agent designer), the seeded task's `agent_configs` binding goes stale
  until a human re-runs seeding or updates the task row — there is no
  reconciliation pass for that drift in this issue's scope.
- `reloadSkills()` fails harmlessly in any environment without a live
  opencode engine on `localhost` (caught + logged, non-fatal) — confirmed in
  the test run's stderr output, does not affect seeding correctness.
