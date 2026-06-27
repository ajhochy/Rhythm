---
date: 2026-06-24
tags: [decision, rhythm, api_server, agents, delegation, epic]
---

# P4 (design only) — Live manager→specialist delegation

> **Status: DESIGN NOTE / EPIC. No code this run.** Implementation is deferred
> until the user confirms. Tracked by `docs/ai/generated-issues/P4-2-manager-delegation-issues.md`.

## Context

`agent_configs.is_manager` exists but is **unused**. There is no tool that lets one
agent invoke another Rhythm profile mid-session, and no field describing *which*
profiles a manager may delegate to. The only delegation today is OpenCode's own
in-session subagents, which inherit the parent session's tool scope — Rhythm does
**not** re-scope each subagent to its own profile. That means a manager's
"specialist" subagent runs with the manager's MCP/skill scope, defeating the whole
point of per-profile scoping (P1).

## Desired feature

A manager profile can call a **delegation tool** that runs a *target* Rhythm
profile as a sub-run, fully **re-scoped to the target profile**, and returns the
result to the caller.

## Design (depends on the P1 shared helper)

### 1. Re-use `resolveProfileScope` (P1a)

The delegation sub-run MUST build its scope through the same helper the interactive
and scheduled paths use:

```
resolveProfileScope(db, targetAgentConfigId)
  → { model, mcpRoleConfig, allowedSkillsJson, systemPrompt, ocAgent }
```

This guarantees the delegated specialist gets its own MCP allowlist, skill
allowlist, model, system prompt (P2), and ocAgent — never the manager's. A new
opencode session is created for the sub-run with that scope (mcpRoleConfig at
`createSession`; systemPrompt/ocAgent on the prompt body per the P2 decision).

### 2. New column: `allowed_delegates_json`

Add `agent_configs.allowed_delegates_json` (JSON `string[]` of agent_config ids the
manager may call). Migration is an additive, pragma-guarded `ALTER TABLE` mirroring
the existing `allowed_mcps_json` / `allowed_skills_json` columns. Repository
(`agent_configs_repository.ts`) gains an `allowedDelegatesJson` field.

### 3. Authorization via `is_manager`

- The delegation tool is only exposed to profiles where `is_manager = 1`.
- A manager may delegate only to target ids present in its `allowed_delegates_json`
  (empty/null = no delegation permitted). Reject otherwise.
- Guard against cycles / runaway fan-out: cap delegation depth (e.g. 1–2 levels)
  and forbid a profile delegating to itself.

### 4. The delegation tool

Exposed as an MCP/agent tool (e.g. `rhythm_delegate`) available to manager sessions:
- Input: `targetConfigId`, `prompt` (the sub-task), optional context.
- Behavior: authorize → `resolveProfileScope(targetConfigId)` → create a scoped
  sub-run (reuse `agent_runner` sub-run machinery) → block for the result →
  return the specialist's final output to the manager turn.
- The sub-run is recorded (its own session row) for observability.

## Implementation issues (deferred — see P4-2)

- **D1** — `allowed_delegates_json` column + migration + repository/model field.
- **D2** — `resolveProfileScope`-backed scoped sub-run runner (extract the
  session-create + prompt path from `agent_runner` so a sub-run can be invoked
  programmatically and return its result).
- **D3** — the `rhythm_delegate` tool, exposed only to `is_manager` profiles.
- **D4** — authorization + depth/cycle guards + tests (manager with
  `allowed_delegates=[X]` can call X re-scoped; cannot call Y; non-manager cannot
  delegate at all).
- **D5** — config/importer + UI surface for `is_manager` and `allowed_delegates_json`
  (importer-driven so it survives re-sync, per P3).

## Alternatives considered

- *Use OpenCode's native subagents as-is.* Rejected — they share the parent's tool
  scope; no per-profile re-scoping, which is the core requirement.
- *Spawn a brand-new top-level session per delegation.* Possible, but reusing the
  sub-run machinery keeps result-return synchronous and observable under the
  manager's session.

## Consequences

- Delegation is only as safe as P1's scoping — this epic is correctly blocked on
  the P1 helper landing first.
- Adds a new authorization surface (`is_manager` + `allowed_delegates_json`) that
  must be set via the importer (P3) to survive re-sync, not hand-edited in the DB.
