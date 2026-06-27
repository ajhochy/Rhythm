---
date: 2026-06-24
repo: api_server
branch: feature/agent-scheduler
pr: "#734"
issues: [P1a]
status: verified-uncommitted
tags: [run, api_server]
index: "[[Rhythm]]"
---

# P1a — Shared profile scope helper + interactive MCP scoping parity

## Files changed

### New
- `apps/api_server/src/services/agent_profile_scope.ts` — `resolveProfileScope(agentConfigId, opts?)` returning `{ model, mcpRoleConfig, allowedSkillsJson, systemPrompt, ocAgent }`. Handles two `allowed_mcps_json` formats:
  - Server-name array `["rhythm","gmail-personal"]` (profile column format) → each server mapped to `{ allowedTools: [] }` (all tools for that server, server scope enforced)
  - Tools-map `{"server":["tool1"]}` (scheduled-task override format) → mirrors `_parseMcpServersFromJson` exact allowlist logic
  - Empty/null → returns null mcpRoleConfig (no restriction)
- `apps/api_server/src/__tests__/interactive_scope_parity.test.ts` — 6 tests: rhythm-only profile excludes gmail+pco; gmail-only profile includes gmail; null `allowed_mcps_json` → null mcpRoleConfig; null agentConfigId → graceful fallback (hardcoded model, null MCP); override takes precedence over profile; systemPrompt/allowedSkillsJson/ocAgent returned correctly.

### Modified
- `apps/api_server/src/services/agent_runner.ts` — replaced inline `resolveRunModel` + profile-load + mcpRoleConfig build in `_runOnce` with a single `await resolveProfileScope(effectiveConfigId, { allowedMcpsJsonOverride: allowedMcpsJson !== undefined ? allowedMcpsJson : undefined })` call. The scheduled-task `allowedMcpsJson` is passed as an explicit override → byte-for-byte preserved behavior. P4-1 `modelOverride` still bypasses the profile model. `AgentConfigsRepository` import retained (still used by `resolveRunModel`).
- `apps/api_server/src/services/ws_gateway.ts` — added `resolveProfileScope(agentKind ?? null)` call in `handleInputFrame` (no override = profile-derived scope). Resulting `wsMcpRoleConfig` forwarded to `createSession` in both fresh-session auto-resume paths (SDK gone + legacy fresh). Re-attach path unchanged (no `createSession` call there). Non-fatal try/catch guards the entire scope resolution.

## Checks run

| Check | Result |
|-------|--------|
| `npx tsc -p tsconfig.json --noEmit` | ✅ 0 errors |
| `npx vitest run interactive_scope_parity issue_738_agent_runner agent_sessions_mcp_role` | ✅ 22/22 PASS |
| `npx vitest run` (full) | ✅ 1140/1140 PASS, 134 files (baseline 1123 + 17 new) |
| GitNexus detect_changes | ✅ risk=low, 0 affected_processes |

## Decisions

Non-obvious choices are in `docs/ai/decisions/2026-06-24-p1a-profile-scope.md`.

Summary:
- **Server-name array → `allowedTools:[]`** (not per-tool from `.mcp-roles/*.mcp.json`): matching C1 design — the role-file resolution path is for explicit `mcpRole` slugs passed by external callers; profile's `allowed_mcps_json` is a server-scope-only gate. P1b can tighten this if needed.
- **`async` signature** on `resolveProfileScope` even though current DB calls are synchronous: ensures WS context compatibility and future-proofs for any async DB work in P1b/P2 without a signature change.
- **P1b seam**: `allowedSkillsJson` returned but not applied — P1b filters the skills preface using it.
- **P2 seam**: `systemPrompt`/`ocAgent` returned but not forwarded — P2 wires them when SDK supports per-session system prompt.

## Deviations from spec

None material. WS path wires `mcpRoleConfig` through auto-resume `createSession` calls; the re-attach path has no `createSession` so is unaffected. The `agent_sessions_controller.create()` path (REST POST) is not modified — it already has C1 role-file gating via `resolveMcpRole`.

## Follow-ups

- **P1b** — Apply `allowedSkillsJson` filter in skill injection preface (slot in at `buildSkillsPreface` call site using `resolveProfileScope`'s returned value).
- **P2** — Forward `systemPrompt` and `ocAgent` to SDK once per-session system prompt is supported.
- **WS auto-resume `createSession` scope** — the re-attach path (`existingSession` alive) does not call `createSession` so it cannot pass `mcpRoleConfig`. The session was already created with scope on the original `POST /agent-sessions` call; re-attach re-uses the existing SDK session and therefore retains whatever scope was applied at creation.
