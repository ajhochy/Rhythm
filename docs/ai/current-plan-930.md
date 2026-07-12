---
issue: 930
title: Add automatic model fallback chain when rate limits hit
repo: Rhythm
branch: main (planning only)
status: plan
tags: [plan, rhythm, "930"]
---

# Plan — #930: Automatic model fallback chain on rate limits

---

## ⚠️ RECONCILIATION (2026-07-08 scoping pass) — most of this is ALREADY BUILT

A branch **`issue-930-model-fallback-chain`** already exists (4 commits off the
current `main` HEAD `09253cd55`, checked out in the worktree
`.claude/worktrees/agent-a723a1be8853538b5`). It is **not empty or abandoned —
it implements Units 1, 2, 3(scoped), 4 and 5.** Verdict: **REUSE, do not
re-implement.**

- `apps/api_server/src/services/model_fallback.ts` (163 lines) — Unit 1
  (`classifyProviderError`, `FALLBACK_CHAIN`) + Unit 2 (`AGENT_FALLBACK_CHAIN`
  env override, `resolveAuthedFallbackChain`, `nextFallbackTier`) + Unit 3
  decision (`resolveCrossProviderHandoff`). Matches this plan's Unit 1
  acceptance exactly.
- `apps/api_server/src/services/__tests__/model_fallback.test.ts` — **24 tests,
  re-run 2026-07-08 in the worktree: all green.**
- `apps/api_server/src/routes/opencode_spillover_routes.ts` — Unit 3/4:
  `/opencode/spillover` now accepts `{exhausted:true}`, calls
  `resolveCrossProviderHandoff('anthropic', authed)`, persists
  `providerId/modelId`, broadcasts `session.spillover` with
  `reason:'rate_limit_cross_provider'`.
- Vendored plugin `rhythm-anthropic-accounts/dist/{index.js,accounts.js}` —
  tagged diff adding `markAccountsExhausted()`.
- Run log `docs/ai/runs/2026-07-07-issue-930-model-fallback-chain.md` claims
  full api_server suite green (2478 passed) + `tsc` clean.

**The one thing NOT done (by design):** actually re-dispatching the in-flight
turn's prompt onto the new provider mid-run. The route decides+persists+notifies;
the *next* turn picks up the new route via session-pin precedence. Live-engine
re-dispatch + the `markAccountsExhausted` plugin path were left for a live-engine
smoke session. That residual is the only real remaining work.

### Q1 (credential gap) — RESOLVED, no product decision required for the mechanism
The `resolveAuthedFallbackChain()` filter via `listAuthedProviders()` makes the
chain **self-skipping**: a tier with no credentials is dropped, never errors.
So no credential setup blocks Units 1–4. Grep-confirmed today:
- `openai` (Codex, via `opencode-openai-codex-auth`) and `google` (Gemini, via
  `opencode-gemini-auth`) ARE wired loaders (`services/opencode_plugin_config.ts`
  L19–20) — authable if AJ has connected those accounts.
- `glm` appears **nowhere** in `apps/api_server/src` (only in the vendored
  opencode_fork's i18n strings) → genuine gap. Correctly left inert as data.
- **`openrouter` IS a fully-wired, authable aggregator provider** (routes,
  auth `/opencode/auth/openrouter`, migration model `openrouter/free`). So tier
  6 "OpenRouter free" is **NOT** a hard gap like GLM. The branch mapped it to a
  non-existent providerID `openrouter-free`, making it permanently inert.

**Only remaining Q1 sub-question (narrow product choice), see below.**

## What already exists (do NOT design from scratch)

Two working patterns already do most of what #930 asks. #930 = generalize the
first from *same-provider account swap* to *cross-provider chain*, and make the
event/config surfaces first-class.

### 1. Anthropic account spillover (the "team → personal Claude auto-swap")
- **Where:** vendored engine plugin
  `apps/api_server/opencode_plugins/rhythm-anthropic-accounts/dist/` (`index.js`,
  `accounts.js`). It intercepts every Anthropic request. On `429`/`529` (after
  `fetchWithRetry` exhausts retries / retry-after) it re-resolves to the next
  usable account (`resolveForSession` → `{account, fallback}`, filters
  `status==='ok' && access`), retries once on the fallback, and calls
  `markSpillover(sessionId, fromId, toId)`.
- **Continuity:** preserved because it swaps only the bearer token mid-request;
  same SDK session, same prompt/context. `RHYTHM_FORCE_SPILLOVER=<accountId>`
  is a deterministic test hook.
- **Durable write / event:** plugin POSTs fire-and-forget to
  `apps/api_server/src/routes/opencode_spillover_routes.ts` (`/opencode/spillover`).
  api_server is the single writer: `repo.setAnthropicAccountId`,
  `anthropicAccountsService.setRouting`, and broadcasts a `session.spillover`
  WS event. This is the model for the "surface a concise status event" AC.
- **Error classification today:** literally `status === 429 || status === 529`
  in the plugin. That is the ENTIRE classifier. There is no shared classifier.

### 2. Route fallback list at session/turn start (cross-provider, but not on rate limit)
- **Where:** `apps/api_server/src/services/agent_model_resolver.ts`.
  `ROUTE_FALLBACKS_BY_AGENT` is an ordered per-agent-kind list
  (claude-code / codex / gemini-cli / opencode) of `{providerID, modelID}`.
  `resolveModelForAgent` picks the first route whose provider is in
  `opencodeClient.listAuthedProviders()`. `resolveModelForSessionTurn` layers
  per-turn override → session pin → `agent_configs.model_provider/model_id`
  (#854) → static list. `resolveTieredModel` adds a budget-aware downgrade.
- This chain is consulted **once, before the turn starts** — it does NOT react
  to a rate-limit that happens mid-run, and its ordering is per-agent-kind
  (all-Claude, then all-Codex…), NOT the cross-provider chain #930 wants.

### 3. Teacher-escalation (retry-same-prompt-on-different-model, at api_server layer)
- `escalateAndCapture` in `apps/api_server/src/services/agent_runner.ts`
  (~L320–453): when a run returns `status==='error'`, it re-runs the SAME
  `AgentRunOptions` with `modelOverride: teacherModel` and an `_isEscalation`
  recursion guard. This is the reusable shape for "re-run the same prompt on the
  next model" — but it currently only escalates *up* to one teacher model, not
  down a chain, and only for the AgentRunner path (delegated/triggered runs),
  not interactive WS sessions.

### Per-profile provider/model constraints today
- `agent_sessions` rows carry `providerId` / `modelId` (`models/agent_session.ts`).
- `agent_configs` carries `model_provider` / `model_id` (read via #854 path).
- Authorization gate = `opencodeClient.listAuthedProviders()`. A route to an
  unauthed provider is already skipped everywhere. **There is no per-profile
  allow/deny list of providers today** — "allowed providers" is currently just
  "which providers are authed globally". So "respect per-agent/profile allowed
  provider constraints" (#930) either means (a) reuse the authed-set gate as-is,
  or (b) introduce a real per-profile allowlist. See Open Question 3.

---

## Decomposition (sequential, atomic)

### Unit 1 — Shared rate-limit classifier + canonical fallback chain constant
- **Goal:** One `classifyProviderError(status, body?) → 'rate_limit' | 'auth' |
  'other'` helper and one exported ordered `FALLBACK_CHAIN` (Team Claude →
  Personal Claude → Codex → Gemini → GLM-5.2 → OpenRouter-free) expressed as
  provider/agent-kind identifiers. No behavior wired yet — pure, unit-tested.
- **Likely files:** new `apps/api_server/src/services/model_fallback.ts`;
  reference (not yet edit) `agent_model_resolver.ts`. Test alongside.
- **Acceptance:** 429/529 → `rate_limit`; 401 → `auth`; 500 → `other`. Chain
  constant lists the 6 tiers in order with the provider IDs each maps to.
- **Depends on:** nothing.
- **Risk:** LOW. No live session/turn state touched. No new credentials — chain
  entries for unconfigured tiers (GLM, OpenRouter-free) are just data.

### Unit 2 — Configurable chain (env + optional per-profile allow-list gate)
- **Goal:** Make the Unit-1 chain overridable (env var, e.g.
  `AGENT_FALLBACK_CHAIN`, parsed like the existing tier-hint env vars) and
  filter it through `listAuthedProviders()` so unconfigured/disallowed tiers are
  dropped. If Open Question 3 → real per-profile allowlist, add the profile
  filter here.
- **Likely files:** `model_fallback.ts`, `config/env.ts`; tests.
- **Acceptance:** chain is env-overridable; unauthed providers never appear in
  the resolved chain; empty/malformed env → falls back to the default chain
  (fail-safe, matching `NEAR_BUDGET_REMAINING_THRESHOLD` parsing style).
- **Depends on:** Unit 1.
- **Risk:** LOW. Config only.

### Unit 3 — Generalize plugin spillover to cross-provider (the core behavior)
- **Goal:** On a rate-limit the request-layer failover should be able to hand
  off to the NEXT tier in the chain even when that tier is a *different
  provider* (not just another Anthropic account). Cleanest lazy option:
  **keep classification/retry-once at the plugin for the Anthropic→Anthropic
  case (already works), and for cross-provider handoff report the exhaustion up
  to api_server** (extend `/opencode/spillover` intake to accept a
  `nextProviderId`/`nextModelId` and let api_server re-dispatch the turn on the
  next chain tier). Confirm during impl whether the vendored plugin can itself
  switch provider or whether only api_server can (single-writer boundary).
- **Likely files:** `opencode_plugins/rhythm-anthropic-accounts/dist/*` (vendored
  — minimal, tagged diff per AGENTS.md), `routes/opencode_spillover_routes.ts`,
  `services/model_fallback.ts`, `agent_sessions_repository.ts`.
- **Acceptance:** Team-Claude rate-limit with no personal Anthropic account left
  → run continues on Codex (next authed tier) with the same session context;
  disallowed/unauthed tiers skipped.
- **Depends on:** Units 1–2.
- **Risk:** HIGH. Touches live in-flight session/turn state and the vendored
  fork (test against the BUILT fork binary, `RHYTHM_OPENCODE_BIN`, per
  project-state). Continuity across a *provider* switch (different tool schema
  formats, different context handling) is the real risk — same-account token
  swap was trivial; provider swap is not. May need to cap re-dispatch depth
  (reuse the `_isEscalation` guard idea) to avoid chain-walking loops.

### Unit 4 — Fallback status event + persisted record
- **Goal:** Extend the existing `session.spillover` WS event (or add a sibling
  `session.fallback`) to carry `fromProvider/fromModel → toProvider/toModel` and
  `reason: 'rate_limit'`, and persist the fallback on the session row / a small
  audit line so AJ sees it without intervening. Reuse the broadcast +
  single-writer pattern already in `opencode_spillover_routes.ts`.
- **Likely files:** `routes/opencode_spillover_routes.ts`,
  `services/ws_gateway.ts`, `services/opencode_stream_bridge.ts` (surface to UI),
  optionally Flutter agents view (separate follow-up if UI polish needed).
- **Acceptance:** every fallback emits ONE structured event + one log line
  (metadata only, no prompt text — mirror `[ModelRouting]` logging discipline).
- **Depends on:** Unit 3.
- **Risk:** MEDIUM. Touches the WS/stream path used by live sessions.

### Unit 5 — Tests: Claude team→personal AND a generic cross-provider fallback
- **Goal:** Satisfy the explicit test AC. Reuse `RHYTHM_FORCE_SPILLOVER` for the
  deterministic Anthropic→Anthropic case; add a generic case that forces a
  rate-limit and asserts the run continues on the next authed chain tier and
  emits the event.
- **Likely files:** `apps/api_server/src/__tests__/anthropic_*routing.test.ts`
  (existing spillover tests), new `model_fallback.test.ts`,
  `opencode_spillover_routes` test.
- **Acceptance:** both scenarios green; no fallback to an unauthed provider
  asserted.
- **Depends on:** Units 1–4.
- **Risk:** LOW-MEDIUM (test-only, but needs the fork binary for the live path).

---

## Open questions for AJ (need a product decision — do not guess)

1. **Credentials gap — RESOLVED (2026-07-08).** The mechanism does NOT block on
   credentials: `resolveAuthedFallbackChain()` self-skips any tier whose provider
   isn't in `listAuthedProviders()`, so an un-credentialed tier is a no-op, never
   an error. Ship the self-skipping mechanism (the branch already did); scope the
   *tested* e2e fallback to authed tiers (Claude→Codex→Gemini). GLM-5.2 has no
   `glm` provider anywhere → keep inert, file follow-up. **Only genuine remaining
   product choice (narrow):** tier 6 "OpenRouter free" is NOT a hard gap —
   `openrouter` is a wired, authable aggregator and `openrouter/free` is a real
   model. Should the last-resort tier actually route through AJ's authed
   OpenRouter account on the free model, or stay inert like GLM?
   - **(a) Wire it** — change the tier-6 entry from the dead `providerID:
     'openrouter-free'` to `{providerID:'openrouter', modelID:'openrouter/free'}`
     (or the exact free model id). One-line data change; gives a real
     always-available last resort. Trade-off: routes AJ's traffic through
     OpenRouter's free pool (rate/quality variance) as the floor.
   - **(b) Leave inert** — matches the branch as-shipped; tier 6 never fires.
     Trade-off: chain effectively ends at Gemini; "OpenRouter free" in the issue
     is aspirational only.
   - Recommend **(a)** IF AJ has OpenRouter authed and wants a guaranteed floor;
     otherwise (b). This is the single bit that needs AJ's word.

2. **Add GLM-5.2 / OpenRouter-free as new providers?** Neither exists in
   `agent_model_resolver.ts` or the plugin config. Adding them = new provider
   loaders + auth + model IDs = its own issue, arguably a prerequisite to #930's
   full chain rather than part of it. Split out?

3. **"Per-profile allowed providers" — does a real allowlist exist that I
   missed, or is it just the global authed set?** Today there is no per-profile
   provider allow/deny column; gating is `listAuthedProviders()` globally. If you
   want a run on the `secretary` profile to be forbidden from ever falling back
   to (say) OpenRouter even when authed, that needs a new per-profile allowlist
   column (extra scope). If "authed globally" is good enough, Units skip it.

4. **Cross-provider continuity expectation.** Same-account token swap keeps
   identical context trivially. A *provider* switch mid-session (Claude→Codex)
   crosses different tool-schema/context conventions in the engine. Is "best
   effort, same prompt re-dispatched on the new provider" acceptable, or do you
   expect full transcript fidelity? This bounds how hard Unit 3 is.
