# [mcp-scope-04] api_server: pass `mcpAllowlist` on `createSession` (both paths)

**Plan:** Per-session MCP tool-schema injection scoping
**Branch:** `feature/agent-scheduler`
**Dependencies:** mcp-scope-05 (expander must exist), mcp-scope-02 (engine must
accept the field — needed for end-to-end proof, not strictly for compilation)
**Blocks:** mcp-scope-06

---

## Context

`opencode_client_service.ts:478-513` defines `createSession(title, directory?,
mcpRoleConfig?)`. Today when `mcpRoleConfig` is provided it is logged and then
ignored — the SDK POST body only sends `{ title }` plus optional `{ directory }`:

```ts
// line 488-491 (today)
if (mcpRoleConfig) {
  logger.info('[OpencodeClientService] createSession: mcpRole=%s ... (stored on session row; SDK has no per-session allowlist param)', ...);
}
```

This issue replaces that no-op log with a real `mcpAllowlist` field on the POST
body, derived from the expander (Issue 05).

**SDK-type decision (resolved R3):** Extend the HTTP POST body directly in
`opencode_client_service.ts:478-513`. The forked engine reads `mcpAllowlist` off
`CreateInput` regardless of the typed `.d.ts`. The hand-written
`apps/api_server/src/@types/opencode-ai-sdk.d.ts` is left as-is (the body is
passed through an untyped dynamic `import()`). A boundary test assertion is added
to `opc_sdk_boundary_regression.test.ts` (or the surface guard) confirming the
`createSession` body actually carries `mcpAllowlist` when the expander returns a
non-empty result.

**Both call paths must be wired:**

1. **Interactive path** — `ws_gateway.ts` lines 442 and 478 call `createSession`.
   Both call sites already thread `mcpRoleConfig`; both must now call
   `expandMcpAllowlist(mcpRoleConfig)` and pass the result.

2. **Scheduled path** — `agent_runner.ts:606` calls `createSession`. Same pattern.

3. `agent_sessions_controller.ts:478,897` — audit whether these call
   `createSession` directly. If so, wire them too; if they delegate through
   ws_gateway / agent_runner, no change needed.

**Boundary:** no profile / no allowlist → no `mcpAllowlist` field in the POST
body (engine injects all — back-compat). Invalid role JSON → field omitted, warn
logged.

---

## Acceptance Criteria

- [ ] `opencode_client_service.ts` — when `mcpRoleConfig` is present, calls
  `expandMcpAllowlist(mcpRoleConfig)` and includes the result as `mcpAllowlist`
  in the `session.create` POST body.
- [ ] When `mcpRoleConfig` is `undefined` / `null`, the POST body contains no
  `mcpAllowlist` field.
- [ ] The no-op `logger.info` that says "SDK has no per-session allowlist param"
  is removed.
- [ ] `ws_gateway.ts` — both `createSession` calls at lines 442 and 478 thread
  the expanded allowlist.
- [ ] `agent_runner.ts:606` — the `createSession` call threads the expanded
  allowlist.
- [ ] `agent_sessions_controller.ts` — audited; any direct `createSession` calls
  wired; controller-layer calls that delegate through the service are unchanged.
- [ ] **New vitest tests** in `apps/api_server/src/services/opencode_client_service.test.ts`:
  - When called with a `mcpRoleConfig`, the outgoing HTTP request body carries
    `mcpAllowlist` matching the expander's output.
  - When called without `mcpRoleConfig`, the body has no `mcpAllowlist` field.
  - Both `ws_gateway` and `agent_runner` code paths are exercised (integration
    or unit-level, not just the service method alone).
- [ ] **SDK boundary tests still pass**: `opc_sdk_surface_guard.test.ts` and any
  existing `opc_sdk_boundary_regression.test.ts` exit 0 with no modifications.
- [ ] **New boundary assertion** added to `opc_sdk_surface_guard.test.ts` (or an
  equivalent file): asserts that a `createSession` call with `mcpRoleConfig`
  present produces a request body containing `mcpAllowlist`.
- [ ] `npx tsc --noEmit` exits 0; `npx vitest run` exits 0.

---

## Likely Files

- `apps/api_server/src/services/opencode_client_service.ts` (lines 467-513)
- `apps/api_server/src/services/ws_gateway.ts` (lines 442, 478)
- `apps/api_server/src/services/agent_runner.ts` (line 606)
- `apps/api_server/src/services/agent_sessions_controller.ts` (lines 478, 897 — audit)
- `apps/api_server/src/services/opencode_client_service.test.ts` (extend existing or create)
- `apps/api_server/src/__tests__/opc_sdk_surface_guard.test.ts` (add boundary assertion)

---

## Required Tests / Evaluation

| Test | Pass condition |
|---|---|
| `createSession` with `mcpRoleConfig` | POST body contains `mcpAllowlist` matching expander output |
| `createSession` without `mcpRoleConfig` | POST body has no `mcpAllowlist` key |
| ws_gateway interactive path | `mcpAllowlist` present when profile resolved |
| agent_runner scheduled path | `mcpAllowlist` present when profile resolved |
| SDK surface guard (existing) | `opc_sdk_surface_guard.test.ts` still passes unmodified |
| New boundary assertion | `createSession` body introspection passes |
| Full vitest suite | `npx vitest run` exits 0 |
| tsc | `npx tsc --noEmit` exits 0 |

---

## Safety Notes

- **Do not modify the hand-written `.d.ts`** beyond adding a `// TODO` comment
  noting `mcpAllowlist` is passed via untyped body. If the type system fights this,
  use a type cast at the call site, not a `.d.ts` expansion.
- **Back-compat.** Missing `mcpRoleConfig` must produce no `mcpAllowlist` in the
  body — the engine must receive exactly the same body as today for profile-less
  sessions.
- **SDK boundary discipline.** The hand-written `.d.ts` has historically drifted
  and caused false-green tests. Extending the body field without extending the
  `.d.ts` is intentional; the new boundary assertion is the guard.
- **GitNexus:** run `impact({ target: "createSession", direction: "upstream" })`
  before editing `opencode_client_service.ts`. `createSession` is called from
  ws_gateway, agent_runner, and agent_sessions_controller — HIGH risk symbol.
  Report blast radius before proceeding.

---

## Open Questions — RESOLVED (orchestrator, 2026-06-25)

**R3 (SDK types):** Extend the HTTP POST body directly in
`opencode_client_service.ts:478-513`. Do NOT extend the hand-written `.d.ts` for
the field (the body passes through untyped). Add a boundary test assertion instead
of a type-level guarantee. This avoids the false-green class of bug documented in
the SDK surface guard.
