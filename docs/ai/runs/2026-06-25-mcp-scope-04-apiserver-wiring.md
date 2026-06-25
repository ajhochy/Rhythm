---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: null
issues: [mcp-scope-04]
status: complete
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# mcp-scope-04 — api_server: pass `mcpAllowlist` on `createSession`

Wires the expander (mcp-scope-05) to the engine (mcp-scope-02): `createSession`
now expands the session's `McpRoleConfig` and sends `mcpAllowlist` on the
`session.create` POST body, scoping MCP tool-schema injection by Agent Profile.

## Files changed

- `apps/api_server/src/services/opencode_client_service.ts` — replaced the no-op
  `logger.info` with `expandMcpAllowlist(mcpRoleConfig)` (try/catch → warn+omit on
  failure); builds `body: Record<string,unknown>` and adds `mcpAllowlist` ONLY when
  a profile is present; passes via a narrow function cast (not `as unknown as`, so
  the typed-wrappers guard holds; no `.d.ts` change, per R3).
- `apps/api_server/src/services/opencode_client_service.test.ts` — 6 new tests
  (deep-equal captured body, exact-content, `not.toHaveProperty` back-compat,
  path-agnostic, error-guard).
- `apps/api_server/src/__tests__/opc_sdk_surface_guard.test.ts` — 1 new structural
  guard block (AC-05).
- `docs/ai/contracts/issue-mcp-scope-04.json` (new) — contract.

## Checks run (independently re-verified by orchestrator)

- targeted vitest (service + surface guard) → 67/67 ✓
- full suite `npx vitest run` → 1214/1214 across 142 files ✓ (HIGH-risk createSession, no regression)
- `npx tsc --noEmit` → exit 0 ✓

## Notes

- **GitNexus impact (createSession): HIGH** — 4 direct callers, 2 flows (resume,
  create). Change is purely additive (new optional body field; no field when no
  profile), so callers/flows intact; full suite confirms no regression.
- **Centralized expansion** inside `createSession` (single choke point). Verified
  all three call sites already pass the role config — `ws_gateway.ts:442` & `:478`
  (`wsMcpRoleConfig`), `agent_runner.ts:606` (`mcpRoleConfig`) — so all paths
  (interactive resume/create + scheduled) get the allowlist without call-site edits.
- **Semantics:** no profile → no `mcpAllowlist` field → engine injects all tools
  (back-compat). Profile present → `mcpAllowlist` sent (even `{[],[]}` → engine
  filters to zero MCP tools, the correct "lite" behavior).
- **Minor coverage note:** ws_gateway/agent_runner paths are covered path-agnostically
  (any caller passing mcpRoleConfig gets the field) rather than by spinning up those
  modules; acceptable since the only new logic is the choke point and the call sites
  were pre-existing/unchanged.
- **Carried concern:** the `session.create` cast is narrow but not `.d.ts`-tracked;
  if the upstream SDK changes its create signature the cast drifts silently. Accepted
  per R3 (avoids the false-green `.d.ts` drift class); the boundary tests are the guard.
