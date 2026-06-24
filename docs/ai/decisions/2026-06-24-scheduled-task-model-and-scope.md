---
date: 2026-06-24
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Scheduled-task per-task model override + profile scope inheritance

## Context

`agent_scheduled_tasks` bind to an agent profile via `agent_config_id`. Two gaps:

1. **No per-task model.** A scheduled run was locked to the bound profile's
   model (`resolveRunModel`). Running one task on a different model (e.g. a
   Sonnet-default profile whose monthly report should run on Opus) required
   splitting the profile.
2. **Scope drift.** The scheduler passed `task.allowedMcpsJson` to the runner
   even when it was `null`. The P1a helper `resolveProfileScope` reads a
   non-`undefined` `allowedMcpsJsonOverride` (including `null`) as an explicit
   "unrestricted" override — so a task with no own allowlist did **not** inherit
   its profile's scope; it ran unrestricted. Skills were never forwarded from
   the task at all.

## Decision

- Add nullable `model_provider` / `model_id` columns to `agent_scheduled_tasks`
  (idempotent ALTER on SQLite via pragma-guard; `IF NOT EXISTS` on Postgres).
- The scheduler passes a `modelOverride` to `AgentRunner.run` **only when both**
  columns are set. Final precedence in `_runOnce`:
  **task override > profile model (`resolveRunModel`) > hardcoded default.**
  The chat path is untouched.
- Fix scope inheritance **at the scheduler**, not the helper: a new
  `resolveTaskScopeOverride()` maps `null`/empty (`[]`/`{}`) → `undefined`
  (inherit) and a concrete allowlist → itself (override). This keeps the P1a
  helper's `undefined = inherit / value = override` contract intact for every
  caller. Precedence: **task-level override > profile > none.**
- Apply the same override-or-inherit rule to skills: added
  `allowedSkillsJsonOverride` to `resolveProfileScope` (symmetric with
  `allowedMcpsJsonOverride`) and `allowedSkillsJson` to `AgentRunOptions`. The
  runner already feeds `profileScope.allowedSkillsJson` into `buildSkillsPreface`,
  so the skills override flows automatically.
- Create paths (REST + MCP tool) make the allowlist **optional** (omit =
  inherit) and expose the two model fields, paired + validated.

## Alternatives considered

- **Normalize null→inherit inside `resolveProfileScope`.** Rejected: that would
  remove the ability to pass an explicit "unrestricted" override, changing
  semantics for the interactive path too. The scheduler is the only place that
  knows "this task has no own scope," so the normalization belongs there.
- **Reuse the P4-1 teacher-escalation `modelOverride` as-is** (it was documented
  "never set by external callers"). Accepted but with a widened doc comment —
  the field's behavior is exactly right; only its contract note needed updating.

## Consequences

- Editing a profile's scope now changes all its scheduled tasks' behavior on the
  next run with no task edit — single source of truth.
- A task may still pin its own MCP/skill allowlist and/or model as an explicit
  override.
- **Scope:** changes apply to the local `AgentRunner` path (`AGENT_LOCAL=true`).
  The production path (`pending_claude_triggers` drained by a separate executor)
  still forwards the task's raw allowlist and is unchanged; bringing it to parity
  is a follow-up.
- Contract tests: `scheduled_task_columns_contract`, `scheduled_task_scope_helper_contract`,
  `scheduler_dispatch_contract` (15 tests) lock in the behavior.
