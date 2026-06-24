# P4-1 — Manager delegation: design note

**Labels:** `design`, `api-server`, `agent-profiles`, `p4`, `epic`
**Depends on:** P1a (the design note must cite `resolveProfileScope` signature — P1a must land first so the seam is stable)

## Context / Background

The `agent_configs` table has an `is_manager` column that exists but is unused. The desired behavior is a delegation tool that allows a "manager" profile to invoke a target Rhythm agent profile as a re-scoped sub-run, then return the result to the caller session. The sub-run is scoped using the same `resolveProfileScope` helper introduced in P1a — the manager's scope is NOT inherited by the delegate.

This issue's **sole deliverable is a design decision note** at `docs/ai/decisions/2026-06-24-manager-delegation.md`. No code changes. Implementation is tracked in P4-2.

The design note must address:
- **Delegation seam:** the manager profile calls a `delegate_to(agentConfigId, prompt)` tool (a local MCP tool or built-in dispatch function registered only for `is_manager=true` profiles). The delegate run calls `resolveProfileScope(agentConfigId)` to get a fresh, independent scope — not inheriting the manager's mcpRoleConfig or skills.
- **Authorization:** only profiles with `is_manager = 1` in `agent_configs` may initiate delegation. The delegation tool returns an error if called from a non-manager session.
- **Allowed delegates list:** a new `allowed_delegates_json` column on `agent_configs` listing the `agentConfigId` values the manager may delegate to. Delegation to an unlisted profile is rejected (fail-closed).
- **Result return:** the delegate's output is returned as the tool call result to the manager session (no persistent child session required for MVP).
- **Re-entry guard:** prevent recursive delegation (a delegate invoking delegation) at the dispatch layer.

## Likely Files (for the design note — read-only)

- `apps/api_server/src/services/agent_profile_scope.ts` (from P1a) — cite the `resolveProfileScope` function signature.
- `apps/api_server/src/database/migrations.ts` — note the `is_manager` column location; the design note should specify the `ALTER TABLE` needed for `allowed_delegates_json`.
- `apps/api_server/src/repositories/agent_configs_repository.ts` — existing `AgentConfig` interface for context.
- `docs/ai/decisions/2026-06-24-manager-delegation.md` — **new file** (the only write target).

## Acceptance Criteria

- [ ] `docs/ai/decisions/2026-06-24-manager-delegation.md` exists with frontmatter `tags: [decision, api-server, agent-profiles]` and sections: Context, Decision, Alternatives Considered, Consequences.
- [ ] The note cites the `resolveProfileScope` function signature (from P1a) as the re-scope seam.
- [ ] The note describes the `allowed_delegates_json` column addition and its fail-closed semantics.
- [ ] The note describes `is_manager` authorization check.
- [ ] The note describes the re-entry guard.
- [ ] The note explicitly defers implementation to P4-2 issues.
- [ ] No code changes in `apps/api_server/src/`. No database changes. No Flutter changes.
- [ ] `tsc --noEmit` still passes (no new TypeScript files).

## Required Tests

None. This issue produces documentation only.

## Dependencies

- **P1a must land first** so the `resolveProfileScope` signature is stable before the design note cites it.
- P4-2 depends on this design note being written before filing implementation issues.

## Safety Notes

- The design note is documentation only — no DB schema changes happen in this issue.
- The `allowed_delegates_json` column addition (an `ALTER TABLE`) is specified in the design note but implemented in P4-2.
- Do not activate `is_manager` logic in any existing code path in this issue.
