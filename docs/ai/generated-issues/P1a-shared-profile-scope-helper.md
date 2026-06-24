# P1a — Shared profile-scope helper + interactive MCP scoping

**Labels:** `feature`, `api-server`, `agent-profiles`, `p1`, `keystone`
**Depends on:** P0 (parallel OK — P0 does not block P1a)

## Context / Background

Today, `agent_runner.ts` `_runOnce` builds its run scope inline: it calls `resolveRunModel` (~203–241) to pick the model, then loads the full agent config profile (~484–506) to get `systemPrompt`/`ocAgent`, then builds `mcpRoleConfig` from `allowedMcpsJson` (~575–603). The interactive WebSocket path (`ws_gateway.ts` `handleInputFrame` ~226–490) never loads the profile at all — interactive sessions get no MCP scoping, no skill allowlist, and no profile-level model override.

This issue extracts one shared helper `resolveProfileScope(agentConfigId, opts?)` that both paths call, wires it into `ws_gateway.handleInputFrame`, and regression-locks the runner path with the existing `issue_738_agent_runner.test.ts` suite.

The helper returns DATA only — it does not perform the send. Each call site keeps its own send mechanics (`prompt()` vs `promptAsync()`).

**SDK constraint (known):** `session.create()` accepts only `{ title, directory }` — no per-session tool-allowlist param. MCP scoping is enforced by passing `mcpRoleConfig` at the `createSession` / resume seam (init-time, same as the scheduled path). The acceptance criterion is framed against this observable seam, not a runtime tool-call rejection guarantee.

## Likely Files

- `apps/api_server/src/services/agent_profile_scope.ts` — **new file**: exports `resolveProfileScope`.
- `apps/api_server/src/services/agent_runner.ts` — refactor `_runOnce` (~446 entry; model resolution ~481–482; profile load ~484–506; `mcpRoleConfig` build ~575–603) to call the helper. `resolveRunModel` (~203–241) is consumed by the helper internally and may remain exported for backward compat.
- `apps/api_server/src/services/ws_gateway.ts` — `handleInputFrame` (~226 entry; `createSession` calls at ~411 and ~444; `buildSkillsPreface` call at ~599); wire helper call here.
- `apps/api_server/src/services/opencode_client_service.ts` — `createSession` (~478–513): already accepts `mcpRoleConfig` as a passthrough arg; no new interface change expected, but verify the passthrough reaches the SDK call.
- `apps/api_server/src/repositories/agent_configs_repository.ts` — `findById` / `getById` (~3–46 range); read-only reference for the `allowed_mcps_json` field shape.
- `apps/api_server/src/__tests__/interactive_scope_parity.test.ts` — **new file**: interactive-path MCP scoping tests.

## Acceptance Criteria

- [ ] New file `src/services/agent_profile_scope.ts` exports `resolveProfileScope(agentConfigId: string | null | undefined, opts?: { allowedMcpsJsonOverride?: string | null }) => Promise<{ model: ResolvedModel, mcpRoleConfig: McpRoleConfig | null, allowedSkillsJson: string | null, systemPrompt: string | null, ocAgent: string | null }>`.
- [ ] `agent_runner._runOnce` calls `resolveProfileScope` instead of its current inline `resolveRunModel` + profile-load + `mcpRoleConfig` build. All existing `issue_738_agent_runner.test.ts` tests stay green (zero behavior change on the scheduled/runner path).
- [ ] When a scheduled task provides `allowedMcpsJson` (e.g. `agentSchedulerService.ts:266`), the helper's `allowedMcpsJsonOverride` is passed through so the scheduled-task row's value takes precedence over the profile value — byte-for-byte unchanged behavior.
- [ ] `ws_gateway.handleInputFrame` calls `resolveProfileScope` using the session's `agentKind` (which equals `agentConfigId` on the interactive path) before the `createSession` / resume call.
- [ ] New test `interactive_scope_parity.test.ts`: an interactive turn where the resolved profile has `allowed_mcps_json = '["rhythm"]'` results in a `mcpRoleConfig` passed to `createSession` that **excludes** gmail and pco servers.
- [ ] New test `interactive_scope_parity.test.ts`: an interactive turn where the resolved profile has `allowed_mcps_json = '["gmail"]'` results in a `mcpRoleConfig` that **includes** gmail.
- [ ] Model precedence is unchanged: per-turn override > session selection > profile default > `ROUTE_FALLBACKS_BY_AGENT` catalog fallback.
- [ ] `tsc --noEmit` passes with zero errors.
- [ ] `npx vitest run` passes (all existing suites stay green).

## Required Tests

New `src/__tests__/interactive_scope_parity.test.ts`:
```
describe('interactive session MCP scope (P1a)', () => {
  it('rhythm-only profile → mcpRoleConfig excludes gmail and pco')
  it('gmail profile → mcpRoleConfig includes gmail')
  it('null allowed_mcps_json → mcpRoleConfig is null (no restriction)')
})
```
Mirror the spy/inject pattern from `issue_738_agent_runner.test.ts` — inject a mock `createSession` and assert the `mcpRoleConfig` argument.

Regression suite: `src/__tests__/issue_738_agent_runner.test.ts` must remain green.

## Dependencies

- P0: parallel OK.
- P1b, P2, P4: all block on P1a completing (`resolveProfileScope` signature is the shared seam).

## Safety Notes

- Scope-derived prompt text (systemPrompt, skills preface) must remain **transient** — never persisted to `config.systemPrompt`, the message store, or an opencode agent `.md`.
- Agent traffic is hard-pinned to `localhost:4001` — do not couple `resolveProfileScope` to `serverConfigService.url`.
- The helper must fail gracefully when `agentConfigId` is null/unknown (fall through to model catalog default, return null mcpRoleConfig).
- No Flutter changes. No new database tables.
