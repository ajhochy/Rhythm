# OPC-M1-1 — Typed SDK wrappers replace all duck-typing (diff, permission respond, command)

**Milestone:** M1 — Foundation
**Branch:** `opc-m1-1-typed-sdk-wrappers`
**Depends on:** — (first issue; M1-2 may run in parallel)

## Summary

Every Opencode SDK call must go through a typed method on `OpencodeClientService` declared in
`@types/opencode-ai-sdk.d.ts`. Remove all duck-typed probes and `as unknown as` casts. A typed
wrapper that finds the SDK surface missing must **throw a descriptive error** (surfaced as
AppError → WS error frame), never silently no-op.

## Motivation

Root cause 3 of the prior failure: duck-typed SDK access produced silent no-ops —
`diffSession` (doesn't exist; the real method maps to `GET /session/{id}/diff`) made the
Changes tab permanently empty, and the permission-respond probe
(`opencode_client_service.ts:654-663`) can silently no-op, hanging the agent.

## Scope

Add/replace typed wrapper methods (names indicative):

- `getSessionDiff(sdkId): Promise<SessionDiff[]>` — maps to `GET /session/{id}/diff`
- `respondToPermission(sdkId, permissionId, decision, feedback?)` — maps to `POST /session/{id}/permissions/{permissionID}`; remove the 654-663 probe
- `dispatchCommand(sdkId, command, args)` — maps to `POST /session/{id}/command`
- `listMessages(sdkId)`, `getTodo(sdkId)`, `revert/unrevert`, `summarize`, `fork`, `listChildren`, `listMcp/connectMcp/disconnectMcp` — declared now (typed, unit-tested at the wrapper level) so M3/M4 consume them without re-touching the d.ts
- Single exported `PROVIDER_TO_AGENT_KIND` constant in the server, consumed by `agents_capabilities_routes.ts` and exposed via `GET /agents/capabilities` so Flutter's duplicated `_kProviderToAgentKind` map can be deleted in M1-3 (root cause 4)

## Likely files

- `apps/api_server/src/services/opencode_client_service.ts`
- `apps/api_server/src/@types/opencode-ai-sdk.d.ts`
- `apps/api_server/src/controllers/agent_sessions_controller.ts` (replace `diffSession` duck-type at :362-383 call site with the typed wrapper)
- `apps/api_server/src/routes/agents_capabilities_routes.ts`
- `apps/api_server/src/services/ws_gateway.ts` (permission respond path)

## Acceptance criteria

1. Repo-wide grep: zero occurrences of `diffSession`, zero `as unknown as` casts targeting SDK objects in `opencode_client_service.ts`, `agent_sessions_controller.ts`, `ws_gateway.ts`.
2. `getSessionDiff` invokes the SDK method that maps to `GET /session/{id}/diff` (spy.mock.calls asserts the SDK client method + sdkId argument) and returns its payload verbatim.
3. `respondToPermission` invokes the SDK permission endpoint with `{decision, feedback}`; when the SDK object lacks the method, it **throws** an Error whose message contains the method name (asserted), instead of returning undefined.
4. `dispatchCommand` invokes the SDK command endpoint with `{command, args}` shape.
5. Every wrapper, when called before SDK init, throws/rejects with the existing "engine not ready" AppError (no silent resolve).
6. `GET /agents/capabilities` response includes the provider→agent-kind mapping object.
7. `ai-workflow checks --level pr` exits 0.

## Required tests (vitest)

- New `opencode_client_typed_wrappers.test.ts`: one test per wrapper asserting SDK spy call shape using **real provider/part shapes from v1.14.49** (real-shape rule); missing-method → throw; not-ready → reject.
- Extend `agents_capabilities_routes.test.ts` for criterion 6.
- Mocks must not use arrow-function method mocks where production uses `this` (banned pattern per #617 retrospective).

## Out of scope

- No Flutter changes (M1-3 deletes the duplicated Flutter map).
- No new UI features consuming the new wrappers (M3/M4).
