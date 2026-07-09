---
date: 2026-07-09
repo: Rhythm
branch: issue-930-model-fallback-chain
pr:
issues: ["#930"]
status: verified-live
tags: [run, Rhythm]
---

# Run — #930 model fallback chain live verification

## What #930 delivers

- Tier-6 OpenRouter "Free Models Router" wired
  (`openrouter/openrouter-free`) as the last-resort fallback tier.
- Shared `model_fallback.ts`: `classifyProviderError` classifier,
  `FALLBACK_CHAIN` constant, `parseFallbackChainEnv`,
  `getConfiguredFallbackChain`, `resolveAuthedFallbackChain`,
  `nextFallbackTier`, `resolveCrossProviderHandoff`.
- `AGENT_FALLBACK_CHAIN` env override for the configured chain.
- Mid-run cross-provider re-dispatch (`turn_redispatch.ts`): on account
  exhaustion, aborts the spinning turn, reverts it, and re-prompts on the
  next authed tier in the **same engine session** (at-most-once).

## Three real bugs found + fixed during live smoke

1. **Plugin API-base port bridge.** The vendored plugin POSTed spillover
   reports to `RHYTHM_API_BASE`, which defaulted to `:4001` while the dev
   server actually runs on `:4000` — every report was silently dropped.
   Fixed by bridging the actual server port onto
   `process.env.RHYTHM_API_BASE` before engine spawn
   (`opencode_client_service.ts`).
2. **ChatGPT-account-incompatible openai default model.**
   `DEFAULT_MODEL_BY_PROVIDER.openai` was `gpt-5.3-codex`, which the Codex
   ChatGPT-account backend rejects. Changed to `gpt-5.4`.
3. **Design correction — terminal trigger instead of `session.error`.** The
   fork's retry policy retries 429s with backoff and no attempt cap, so a
   sustained exhaustion spins the turn in `working` forever and
   `session.error` never fires — the original "re-dispatch on
   `session.error`" design hung indefinitely. Reworked so the spillover
   exhausted-report is the terminal trigger: the route drives
   abort -> revert -> re-prompt directly; `session.error` now only defers.
   A single-flight guard (`beginHandoff` no-clobber + one-shot
   `decideHandoff`) ignores duplicate reports the retry loop fires before
   the abort lands.

## Verification evidence

- Unit suites: `54 passed` (`turn_redispatch` 14 + `model_fallback` +
  `anthropic_session_routing`).
- Full `api_server` suite: `2498 passed | 5 skipped`.
- `tsc --noEmit` — clean.
- Live Phase A (`RHYTHM_LIVE_E2E=1`): `1 passed`.
- Live Phase A+B (`+RHYTHM_LIVE_E2E_FORCE_EXHAUSTED=1`): `2 passed`.
- Evidence lines from the smoke log:
  - `[Spillover] … cross-provider handoff to OpenRouter free
    (openrouter/openrouter/free)`
  - `[TurnRedispatch] session … re-dispatched interrupted turn on
    openrouter/openrouter/free (same engine session ses_…)`

## Caveat — constrained chain used for live smoke (see #952)

The live smoke ran on a **constrained chain**
(`AGENT_FALLBACK_CHAIN=team-claude,personal-claude,openrouter-free`) because
on this machine the `openai` (Codex ChatGPT-account) and `google` (Gemini
schema) fallback tiers are non-functional — filed as **issue #952**.

The #930 re-dispatch mechanism itself is provider-agnostic and proven, but
the *default* chain still lists `openai`/`google` before `openrouter`. If
those tiers are dead in production, a real spillover would re-dispatch onto
a hanging provider. #952 tracks this and suggests a fallback
completion-watchdog as a #930 follow-up.
