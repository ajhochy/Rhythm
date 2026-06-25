# D2 — Manager delegation scoped sub-run runner

**Labels:** `api-server`, `agents`, `p4`
**Design authority:** `docs/ai/decisions/2026-06-24-manager-delegation.md`
**Depends on:** D1

## Goal

Add a programmatic sub-run path that invokes a target profile using the target's resolved scope.

## Acceptance Criteria

- [ ] New delegation service exposes a function that accepts caller profile/session context, target profile id, prompt, and depth.
- [ ] It calls `resolveProfileScope(targetAgentConfigId)` and uses the returned `mcpRoleConfig`, `model`, `systemPrompt`, and `ocAgent`.
- [ ] It creates a delegate session/sub-run record for observability.
- [ ] It returns the delegate output string.
- [ ] The runner can be unit-tested with opencode SDK mocks; no live SDK required.

## Likely Files

- `apps/api_server/src/services/agent_delegation_service.ts`
- `apps/api_server/src/services/agent_runner.ts`
- `apps/api_server/src/repositories/agent_sessions_repository.ts`

## Required Tests

- Add Vitest coverage proving the target profile scope is used at session creation and prompt dispatch.
