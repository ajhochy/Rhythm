---
date: 2026-07-16
repo: Rhythm
branch: fix/codex-fallback-5.6-sol
pr: (draft — see below)
issues: []
status: verified-pending-smoke
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Codex frontier route → gpt-5.6-sol

Two independent codex surfaces both moved to `gpt-5.6-sol`:

**Path A — explicit codex agent** (`ROUTE_FALLBACKS_BY_AGENT` in `agent_model_resolver.ts`)
- `ROUTE_FALLBACKS_BY_AGENT.codex`: `gpt-5.6-sol` is now the first (preferred) route; `gpt-5.3-codex` kept as secondary.
- `classifyRouteTier`: `gpt-5.6-sol` now classifies as `frontier` (was falling through to `standard`; only `gpt-5.3-codex` was frontier before).

**Path B — Anthropic-exhaustion cross-provider cascade** (#930; `model_fallback.ts` + `turn_redispatch.ts`)
- `DEFAULT_MODEL_BY_PROVIDER.openai`: `gpt-5.4` → `gpt-5.6-sol`. This is the model the mid-turn cascade (team-claude → personal-claude → **codex** → gemini) uses when Anthropic hits 429/529. Overrides the deliberate 2026-07-08 `gpt-5.4` choice; `sol` is a GENERAL 5.6 variant (not a `-codex` specialized model), so it stays clear of the "not supported with a ChatGPT account" restriction that ruled out `-codex` ids. **Smoke tool use on the ChatGPT-plan token at release.**

Files:
- `apps/api_server/src/services/agent_model_resolver.ts`
- `apps/api_server/src/services/model_fallback.ts`
- `apps/api_server/src/services/agent_model_resolver.test.ts` — assert `gpt-5.6-sol` → frontier.
- `apps/api_server/src/services/model_routing.test.ts` — assert codex agent @ frontier resolves to `gpt-5.6-sol`.
- `apps/api_server/src/services/__tests__/turn_redispatch.test.ts` — cascade expected model `gpt-5.4` → `gpt-5.6-sol`.

## Checks run
- `tsc --noEmit` ✓ exit 0
- `vitest run model_routing + agent_model_resolver + issue_844_contract + model_fallback + turn_redispatch + issue_930_fallback_cascade` ✓ 41/41
- `npm run build` (api_server) ✓
- Pre-existing baseline failure (NOT from this change): `agents_models_catalog.test.ts` → `TypeError: closeServer is not a function` in `afterEach`; reproduces identically with changes stashed. Likely a test-harness/env issue, out of scope.

## Notes
- **Root cause (path A):** the codex route table pinned `gpt-5.3-codex` as the only frontier codex model, so any frontier-tier codex run resolved to 5.3 even though `gpt-5.6-sol` is present + authed in the live openai catalog.
- **Exhaustion fallback (path B) is real and wired** — corrected an earlier misread. The #930 cross-provider cascade (`FALLBACK_CHAIN` + `turn_redispatch.ts`, driven by the vendored anthropic plugin → `/opencode/spillover` + `onSessionError` in the stream bridge) DOES fall Anthropic → codex on 429/529 exhaustion. It's a separate system from the tiered resolver's soft budget-*downgrade* (which stays within Claude tiers). Per user request, its codex model is now `gpt-5.6-sol` (was `gpt-5.4`).
- **Diagnostic context (the reported symptom):** the "no rate-limit headers" Team badge was a transient expired-token artifact (401 carries no unified headers); cleared after re-auth (live `/agents/capabilities` now `claude-code: true`, Team gauges healthy). The badge is decoupled from the soft budget-downgrade path; the hard-exhaustion cascade (path B) is what actually routes to codex.
- **Takes effect on release only** — this is bundled-server code; live app needs a release build. Interim live lever: pin `gpt-5.6-sol` via the model picker (explicit override always wins).
- Done in an isolated worktree (`/Users/ajhochhalter/Documents/Rhythm-codex-fix`) because a concurrent run holds the main checkout. `project-state.md` intentionally left untouched to avoid stomping that run.
