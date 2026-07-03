---
date: 2026-07-02
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Gemini function-declaration cap enforced at the allowlist wire choke point, not per-caller

## Context

Issue #884: agent runs routed to the `google`/Gemini provider (direct route,
or a Claude→Gemini model-fallback via `agent_model_resolver.ts`'s
`ROUTE_FALLBACKS_BY_AGENT`) were failing with Gemini's proto error "At most
512 function declarations can be specified" whenever the session's MCP tool
allowlist exceeded that cap — most commonly an unscoped/"Allow all" profile.
Two call sites push an expanded `{servers[], tools[]}` allowlist to the
opencode engine: `agent_runner.ts` (scheduled/headless runs) and
`ws_gateway.ts` (interactive runs). Both already funnel through
`opencode_client_service.ts`'s `createSession` / `updateSessionAllowlist`,
which call the shared `expandMcpAllowlist()` helper immediately before
placing the allowlist on the SDK/PATCH body.

## Decision

Add a new pure module, `gemini_tool_cap.ts`, exporting
`capMcpAllowlistForProvider(allowlist, providerId)` — a no-op for every
provider except `google`, and a deterministic trim (explicit `tools[]`
preferred over inherit-all `servers[]`) down to a safety-margined budget
when over cap. Wire this into `opencode_client_service.ts`'s two methods
(`createSession`, `updateSessionAllowlist`) rather than into each caller
separately. Both methods gained an optional `providerId` parameter that
callers pass once they've resolved the turn's model.

For `ws_gateway.ts`, this required moving the existing
`resolveModelForSessionTurn()` call earlier — before the MCP-allowlist push
block — because the interactive path previously resolved the model only
after pushing the allowlist (the allowlist push only ever needed the
profile, not the model). The later prompt-send code now reuses that same
early-resolved model instead of calling the resolver a second time.

## Alternatives considered

- **Cap inside `expandMcpAllowlist()` itself.** Rejected: that function is a
  pure, provider-agnostic expansion (also covered by its own
  `mcp_allowlist_expander.test.ts` contract suite for issue mcp-scope-05);
  conflating it with a Gemini-specific policy would require threading
  `providerId` through a function whose entire contract today is "shape
  transform only," widening its blast radius for no benefit since both real
  callers already pass through `opencode_client_service.ts` anyway.
- **Cap inside `agent_profile_scope.ts`'s `resolveProfileScope()`.** Rejected:
  that helper resolves scope from the *profile*, before any model/provider is
  known (see its own doc comment: "DATA-ONLY — it never touches the opencode
  SDK"). Capping there would mean guessing the eventual provider, which for
  `ws_gateway.ts`'s per-turn `perTurnAgent`/`perTurnOverride` inputs isn't
  settled until later in the same function.
- **Duplicate the cap call in both `agent_runner.ts` and `ws_gateway.ts`
  right after each computes its own allowlist.** Rejected: this is exactly
  the kind of per-call-site duplication the existing `expandMcpAllowlist()`
  centralization (mcp-scope-04/#855) was designed to prevent — a future third
  caller would have to remember to add the cap too. Centralizing in
  `opencode_client_service.ts` makes it structurally impossible to push an
  over-cap allowlist to `google` through either existing path, and any new
  caller inherits the guard automatically.
- **Resolve the model twice in `ws_gateway.ts`** (once early for the cap
  check, once late for prompt-send, as it already did for the latter).
  Rejected: `resolveModelForSessionTurn` does an auth-catalog probe
  (`opencodeClient.listAuthedProviders()` inside `resolveModelForAgent`/
  `resolveModelFromAgentConfigs`); calling it twice per turn doubles that
  cost for every turn (not just Gemini ones) and risks the two calls
  disagreeing if any input mutated between them (none currently does, but a
  future edit could introduce that hazard silently). Resolving once and
  reusing the result removes both concerns and is a value-preserving pure
  move (same inputs feed both call sites).

## Consequences

- Non-google providers are provably unaffected: `capMcpAllowlistForProvider`
  short-circuits to a pass-through on any `providerId !== 'google'`, verified
  by test case C3 with several thousand-tool oversized inputs across
  anthropic/openai/openrouter/ollama/github-copilot.
- A future caller of `createSession`/`updateSessionAllowlist` that omits
  `providerId` gets the pre-#884 behavior (no cap) rather than an error —
  matches the existing fail-open posture of the surrounding scope-resolution
  code (`resolveProfileScope`, `expandMcpAllowlist` failures are all
  non-fatal/logged, never turn-blocking).
- The trim is estimate-based (mirrors #841's `tool_surface_estimator.ts`
  25-tools-per-inherit-all-server flat estimate), not a live per-server
  schema count, so a pathologically large single server (150+ tools) could in
  theory still slip through under-estimated. Accepted per the issue's
  "comparability over precision" framing; revisit only if #884-shaped 400s
  recur with an allowlist this guard judged under-budget.
- `ws_gateway.ts`'s `handleInputFrame` now performs one fewer
  `resolveModelForSessionTurn` call per turn than before this change (was 2,
  now 1) — a minor latency improvement as a side effect, not the goal.
