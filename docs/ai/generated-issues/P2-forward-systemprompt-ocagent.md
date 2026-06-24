# P2 — Forward system_prompt + ocAgent on both paths via the P1 helper

**Labels:** `feature`, `api-server`, `agent-profiles`, `p2`
**Depends on:** P1a (`resolveProfileScope` must exist and return `systemPrompt` + `ocAgent`)

## Context / Background

`agent_runner._runOnce` loads `systemPrompt` and `ocAgent` from the profile (~493–496) but drops both with explicit TODO comments (~502–505):

```
// TODO: pass effectiveSystemPrompt to createSession once the SDK supports a
// TODO: forward effectiveOcAgent per-turn once there's a profile-level override
```

`ws_gateway.handleInputFrame` applies `ocAgent` only when a per-turn override arrives from the client (~290–292) and never reads the profile's `ocAgent`. Neither path forwards `systemPrompt`.

The implementing agent **must re-read `node_modules/@opencode-ai/sdk` types** before choosing strategy — the SDK capability may have changed since the TODOs were written. The finding must be recorded in `docs/ai/decisions/`.

**Two possible outcomes:**
- **SDK supports per-session system prompt:** forward `systemPrompt` via `createSession` on both paths through the P1a helper.
- **SDK does NOT support per-session system prompt:** implement a documented fallback (first-turn system-message injection OR per-turn agent override) applied consistently on both paths. The fallback choice must be the same on runner and WS — no divergence.

`ocAgent` forwarding must happen on both paths regardless of the system-prompt outcome.

## Likely Files

- `node_modules/@opencode-ai/sdk` — **read-only inspection** of TypeScript type definitions to determine `session.create()` signature and any `systemPrompt` param.
- `apps/api_server/src/services/agent_runner.ts` — TODO lines ~502–505; `_runOnce` send call ~602 area.
- `apps/api_server/src/services/ws_gateway.ts` — `ocAgent` per-turn apply ~290–292; `createSession` calls ~411 and ~444; SDK opts assembly ~557–566.
- `apps/api_server/src/services/opencode_client_service.ts` — `createSession` method (~478–513); extend signature if SDK supports the param.
- `apps/api_server/src/services/agent_profile_scope.ts` (from P1a) — `resolveProfileScope` already returns `systemPrompt` + `ocAgent`; no interface change needed.
- `docs/ai/decisions/2026-06-24-sdk-per-session-system-prompt.md` — **new file**: SDK capability finding.

## Acceptance Criteria

- [ ] The implementing agent reads `node_modules/@opencode-ai/sdk` TypeScript types and records whether `session.create()` accepts a `systemPrompt` (or equivalent) parameter.
- [ ] `docs/ai/decisions/2026-06-24-sdk-per-session-system-prompt.md` exists and documents: (a) SDK version inspected, (b) whether the param exists, (c) which strategy was chosen (forward vs. fallback), (d) any code comment pointing back to this decision.
- [ ] **If SDK supports per-session system prompt:** `createSession` on both `agent_runner` and `ws_gateway` forwards `systemPrompt` from the resolved scope; a test asserts the SDK `createSession` call receives it.
- [ ] **If SDK does NOT support per-session system prompt:** the documented fallback (first-turn injection or per-turn agent override) is applied identically on both paths; a test asserts the fallback fires on both the runner path and the WS path.
- [ ] Profile `ocAgent` is forwarded on both paths (runner and WS) — not only on per-turn WS override.
- [ ] `systemPrompt` text delivered via any fallback mechanism is **transient** — not persisted to the DB session row, `config.systemPrompt`, or an opencode `.md` file.
- [ ] All `issue_738_agent_runner.test.ts` tests stay green.
- [ ] `tsc --noEmit` passes with zero errors.

## Required Tests

New or extended test file (name TBD by implementing agent based on strategy chosen):
```
describe('system_prompt + ocAgent forwarding (P2)', () => {
  it('runner path: resolved systemPrompt forwarded to createSession [or fallback fires]')
  it('WS path: resolved systemPrompt forwarded to createSession [or fallback fires]')
  it('runner path: profile ocAgent applied on both paths')
  it('WS path: profile ocAgent applied even without per-turn override')
})
```
Use injected-dependency pattern (mock `opencode_client_service`). Assert against the spy-able SDK call argument or the forwarded-prompt capture, not end-to-end.

## Dependencies

- **P1a must land first** — this issue consumes `resolveProfileScope`'s `systemPrompt` and `ocAgent` return values.
- P1b does not block P2 (can land in either order after P1a).

## Safety Notes

- `systemPrompt` content is transient — the **transient-injection invariant** forbids persisting any scope-derived prompt text.
- The SDK inspection is read-only — do not modify `node_modules/`.
- If the fallback path is chosen, the code comment in the source must cite the decision note filename so future readers can find the rationale.
- No Flutter changes. No new database tables.
