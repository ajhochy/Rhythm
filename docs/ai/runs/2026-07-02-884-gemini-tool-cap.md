---
date: 2026-07-02
repo: Rhythm
branch: issue-884-gemini-tool-cap
pr: null
issues: [884]
status: done
tags: [run, rhythm]
---

## Files

- `apps/api_server/src/services/gemini_tool_cap.ts` (new) — pure guard
  `capMcpAllowlistForProvider(allowlist, providerId)`. No-op for every
  provider except `google`. When over Gemini's 512-function-declaration cap
  (minus a 12-slot builtin reserve → `GEMINI_MCP_TOOL_BUDGET`), trims
  deterministically: explicit `tools[]` kept first (already the most
  deliberately-scoped part of the surface), then inherit-all `servers[]`
  (each charged at a flat 25-tool estimate, mirroring #841's
  `tool_surface_estimator.ts`). Returns `{ allowlist, trimmed,
  originalEstimatedCount, cappedEstimatedCount, warning }` — never throws.
- `apps/api_server/src/services/__tests__/gemini_tool_cap.test.ts` (new) —
  9 cases (C1–C7): under-cap unchanged, over-cap trimmed + warning contains
  "512", non-google (anthropic/openai/openrouter/ollama/github-copilot)
  completely untouched even when oversized, explicit-tools preferred over
  inherit-all servers, exactly-at-budget unchanged, null/undefined provider
  treated as non-google, trimmed result never exceeds the hard cap across a
  range of oversized inputs.
- `apps/api_server/src/services/opencode_client_service.ts` — `createSession`
  and `updateSessionAllowlist` both gained an optional `providerId` param;
  both call `capMcpAllowlistForProvider` on the expanded allowlist
  immediately before it's placed on the SDK body / PATCH body, and
  `logger.warn(...)` the returned warning when trimmed. This is the single
  choke point where both call sites below push allowlists to the engine.
- `apps/api_server/src/services/agent_runner.ts` — `_runOnce` passes
  `resolvedModel.providerID` into `createSession` (model is already resolved
  before session creation on the scheduled/headless path — no reordering
  needed here).
- `apps/api_server/src/services/ws_gateway.ts` — moved the
  `resolveModelForSessionTurn()` call earlier in `handleInputFrame` (before
  the MCP-allowlist push block) and reused the single resolved model both to
  pass `providerID` into `createSession`/`updateSessionAllowlist` (the cap)
  and for the existing prompt-send model resolution further down (removed
  the old second call to the same function with the same inputs — a pure
  move, not a behavior change; also saves one auth-catalog round trip per
  turn).
- `docs/ai/project-state.md` — added a "Recent coding-agent runs" entry
  (coding-agent skill contract) documenting this run in detail.

## Checks

- `apps/api_server`: `node_modules/.bin/tsc --noEmit` → 0 errors.
- `apps/api_server`: `npm test` (vitest) → **2017 passed / 1 skipped / 0
  failed**, 235 files. The 1 skip is the known pre-existing #881
  machine-local test skip (unrelated to this change).
- `apps/api_server`: `npm run build` (tsc -p tsconfig.json) → clean, exit 0.
- `apps/mcp_server`: `npm run build` → clean; `npm test` → 59/59 passed
  (untouched by this change — confirms no cross-package regression).
- GitNexus `detect_changes` was unavailable for this worktree (884-gemini is
  not in GitNexus's indexed repo list — only main + a subset of other
  worktrees are indexed). Fell back to `git diff --stat main...HEAD`, which
  confirmed the change scope is exactly the files listed above plus one
  pre-existing, unrelated commit already on the branch
  (`opc_curated_mcp_ensure.test.ts`, from `55cde8d0a`, not part of this run).

## Notes

- **Root cause (per issue #884):** Gemini's `GenerateContentRequest` proto
  rejects requests with >512 function declarations. Rhythm sessions routed
  to `google` (direct route, or a Claude→Gemini model-fallback via
  `ROUTE_FALLBACKS_BY_AGENT`) could be handed an unscoped/"Allow all" MCP
  surface exceeding that cap, producing a raw 400 (sometimes an aborted run)
  instead of a graceful degradation. Surfaced by the #865 Report Card: Claude
  Code 11x (+ Aborted 4x), another agent 2x over 30 days.
- **Design decision — single choke point:** the cap is enforced inside
  `opencode_client_service.ts`'s `createSession`/`updateSessionAllowlist`,
  which is where the expanded `{servers[], tools[]}` allowlist is placed on
  the wire, rather than duplicated at each of the two callers
  (`agent_runner.ts` scheduled/headless path, `ws_gateway.ts` interactive
  path). Both callers already funnel through these two methods, so this is
  the minimal-surface-area fix.
- **Design decision — ws_gateway model-resolution reorder:** the interactive
  path previously resolved the turn's model *after* pushing the MCP
  allowlist (the allowlist push only needed the profile, not the model). To
  gate on provider, the model must be known first. Rather than resolve twice
  (once early for the cap, once later for prompt-send — extra auth-catalog
  round trip and risk of the two calls diverging if inputs changed
  in-between), the model is now resolved once, early, and the later
  prompt-send code reuses that same result. Verified this is a pure move: the
  inputs (`agentKind`, `sessionProviderId`, `sessionModelId`,
  `perTurnOverride`) are read from the DB/frame before either call site and
  don't change between the old "early" and "late" positions.
- **Deliberately out of scope / no-op call sites (verified, not gaps):**
  - `agent_sessions_controller.ts`'s interactive pre-create `createSession`
    call (POST /agent-sessions) — no resolved profile/provider exists yet at
    that point (same reason `ws_gateway` re-pushes the allowlist per-turn
    today); `mcpRoleConfig` is generic/absent here.
  - `agent_sessions_controller.ts`'s legacy resume-path `createSession` call
    — passes no `mcpRoleConfig` at all, so there is no allowlist to trim.
  - `skill_extractor.ts` / `skill_refiner.ts` — call `createSession` with no
    `mcpRoleConfig` argument (throwaway internal sessions), so the cap has
    nothing to act on.
- **Residual risk:** the cap's budget math uses the same flat
  25-tools-per-inherit-all-server estimate as #841's
  `tool_surface_estimator.ts` (not a live per-server schema count — that
  would require an extra engine round trip this module deliberately avoids,
  per that module's own doc comment). A server with an unusually large real
  catalog (e.g. `propresenter` at 150+ tools) could in theory still push an
  allowlist that *looks* under-budget by this estimate over the real 512 cap
  on the wire. Acceptable given the issue's explicit "comparability over
  precision" framing (matches #841/#842's existing accepted imprecision);
  worth revisiting only if #884-shaped 400s recur with an
  under-the-estimate-but-still-402 allowlist.
- No fork edits (`apps/opencode_fork` untouched, per the issue's scope). No
  behavior change for any non-google provider — verified via test cases C3.
- Single commit `98a5be656` on `issue-884-gemini-tool-cap`, not pushed/PR'd
  yet (per this run's instructions: worktree-isolated implementation only).
