---
date: 2026-09-21
repo: Rhythm
branch: fix/fallback-cascade-auth-hop
pr: (draft — see below)
issues: []
status: draft-pr-open
tags: [run, Rhythm]
---

# Workstream C — cross-provider fallback cascade: auth failures never hopped, and Electron never showed the hop

## The report

> "if the engine doesnt get a response from a model, it is supposed to fall back to a different
> account... personal, not authed, switch to team. Team doesnt work, switch to personal, both
> anthropic dont work, switch to codex... That fallback works on flutter. why not on electron?"

Two distinct questions, two distinct root causes. Neither is what the report assumes.

## Q1 — does an AUTH failure trigger the cascade?

**No. It did not, on either client.** The doc comment in `model_fallback.ts` ("Only 'rate_limit'
triggers a fallback chain hop; 'auth' and 'other' are surfaced as normal errors") accurately
described the shipped wiring. `turn_redispatch.onSessionError` gated the cascade on
`classifyProviderError(errorInfo) === 'rate_limit'`; everything else hit `handoffs.delete()` and
finalized the turn.

The same gate exists one layer lower. The vendored `rhythm-anthropic-accounts` plugin only spills
between accounts on `429/529` (`dist/index.js:336,367`); `markAccountsExhausted` is reached from
those branches only. A `401` gets one in-plugin credential re-read and retry, then surfaces.

**Important correction to the report's premise:** the *first* hop the user describes — "personal,
not authed, switch to team" — already works, but not through the cascade. `dist/accounts.js`
`resolveForSession` filters the account store to `status === 'ok'` before picking, so with
`personal = needs_relogin` and `defaultAccountId = personal` (exactly the live state today) it
silently selects `team`. That is credential-selection, not error-driven failover.

Where it genuinely broke: once *every* Anthropic account is unusable, `resolveForSession` returns
no account and the plugin **throws** `"Rhythm account store has no usable Anthropic account"`.
That reaches `session.error` with no HTTP status, classified `'other'`, and finalized. No hop to
Codex/Gemini/OpenRouter ever happened.

### Fix

- `model_fallback.classifyProviderError` — text-pattern arm added for credential failures that
  arrive as a bare thrown Error with no status (`no usable ... account`, `credentials are
  unavailable or expired`, `unauthoriz`, `authentication_error`, `invalid_api_key`,
  `invalid bearer`, `oauth token expired`, `permission_denied`, `needs_relogin`) → `'auth'`.
  Status-code classification (`401/403 → auth`) was already correct and is unchanged.
- `turn_redispatch.onSessionError` — `'auth'` now cascades alongside `'rate_limit'`.

No retry-storm risk: the cascade was already bounded by `visitedTierIds` (each tier at most once
per retained turn). Worst case it walks the authed chain once and finalizes with
`formatFallbackExhaustedMessage`. A test asserts exactly that bound.

- The handoff now carries its `ProviderErrorClass` through `beginHandoff` → `HandoffState` →
  `ProviderExhaustionSignal` → the `session.spillover` broadcast, whose `reason` is now
  `auth_cross_provider` vs `rate_limit_cross_provider`, so the UI can say *why* it moved.

## Q2 — why would Electron differ from Flutter?

**It doesn't — the cascade is server-side and client-agnostic. What differs is visibility.**

Traced end to end and ruled out every structural candidate:

| Candidate | Finding |
|---|---|
| `retainTurn` gated on `if (opencodeId)` (ws_gateway.ts:1027) | Not the divergence. Every path above it either assigns `opencodeId` or returns early. |
| Frame shape | Identical. Electron `store.tsx:817` and Flutter `agents_controller.dart:2648` both send `{v:1,type:'session.input',id,data|parts,agent?,modelOverride?}`. |
| Transport | Identical. `apps/web/src/gateway/sessions.ts:574` opens the same `ws://localhost:4001/ws/agents`; the socket is an unfiltered passthrough. |
| Model resolution | Reads the DB session row + `agent_model_resolver`, not the frame. |
| Empty `/agents/models` + `/opencode/models` | A red herring for the cascade. `resolveAuthedFallbackChain` filters against `listAuthedProviders()`, not the model catalog. With `[openrouter, anthropic, openai, google, ...]` authed, the chain still resolves team-claude → personal-claude → codex → gemini → openrouter-free correctly. (The empty catalogs are a real but separate defect.) |

**The actual Electron gap:** `grep -rn "spillover" apps/web/src/` returned **zero matches**. Flutter
has rendered `session.spillover` since the dual-account work (`agent_ws_message.dart:59`,
`agents_controller.dart:3490`). The Electron renderer dropped the frame on the floor. A cascade
that *did* run produced no user-visible signal whatsoever — which reads exactly as "the fallback
doesn't work on Electron".

That also explains the report's "it works on Flutter": on Flutter a *rate-limit* hop shows a
spillover toast, so it is observable. On Electron the identical hop is silent.

### Fix

- `apps/web/src/store.tsx` — handle `session.spillover` in the live event reducer; emit a toast
  naming the destination tier and distinguishing auth from rate-limit. The new provider/model
  itself already arrives on the `session.updated` that `notifyDecision` broadcasts immediately
  after, so this branch only makes the hop visible.
- `apps/web/src/gateway/sessions.ts` — `SessionWireEvent` extended with the spillover fields
  (`fromAccountId`, `toAccountId`, `toProvider`, `toModel`, `toTier`).

## Files

- `apps/api_server/src/services/model_fallback.ts`
- `apps/api_server/src/services/turn_redispatch.ts`
- `apps/api_server/src/services/__tests__/turn_redispatch_auth_cascade.test.ts` (new, 6 tests)
- `apps/web/src/store.tsx`
- `apps/web/src/gateway/sessions.ts`
- `apps/web/tests/electron-e21-harness.tsx` (expose `toast` on the probe)
- `apps/web/tests/electron-e21-reconciliation.spec.ts` (+3 tests)

Untouched, by coordination: `agent_runner.ts` inactivity logic and schedules (Workstream A);
`AgentSettingsTool.tsx`, `opencode_auth_routes.ts`, `anthropic_accounts_service.ts` (Workstream B).

## Checks

- `npx tsc --noEmit` (api_server) — exit 0
- `npx vitest run src/services src/contract` — 1696 passed / 0 failed
- RED→GREEN: the 6 new auth-cascade tests failed 5/6 before the fix (the control "still finalizes"
  test passed), all 6 pass after
- `npm run typecheck` + `npm run build` (apps/web) — exit 0
- `npx playwright test --config tests/electron-e21-playwright.config.ts` — 10 passed
- Mutation check: disabling the `session.spillover` branch in store.tsx → the 3 new web tests fail;
  restored → pass. They are real evidence, not coverage.

## Notes

- **Flake found, not fixed here.** The first full-suite run failed 3 timing assertions in
  `src/contract/pr_1489_harness_race_repair.test.ts` (`expected 1 to be >= 6` at :78). Passed 3/3
  isolated on the pristine baseline and 1696/1696 on rerun — load-dependent wall-clock flake,
  unrelated to these files. Spun off as a separate task.
- **Branch spans two apps deliberately.** The server fix belongs on `main`'s line; the Electron fix
  exists only on the mega branch. Based on `mega/2026-09-18-mobile-electron-hermes` (HEAD
  3641f303 / 648f8d58) because that is what the user's running "Rhythm Mega Desktop Candidate.app"
  is built from. The `apps/api_server` half should be cherry-picked to a `main` branch separately
  so Flutter users get the auth hop too — it is not Electron-specific.
- **Still open (not in scope here):** `GET /agents/models` and `GET /opencode/models` both return
  `[]` on the live server. Harmless for tier resolution, but it means the model picker is empty and
  `resolveModelFromAgentConfigs`'s keyless-`opencode` healing path cannot work. Worth its own issue.
- **Not changed:** the vendored plugin still only rotates *between Anthropic accounts* on 429/529.
  Making it also rotate on a 401 would be a vendored-plugin change; the api_server cascade now
  covers that case by moving off Anthropic entirely instead, which is the safer fix.
