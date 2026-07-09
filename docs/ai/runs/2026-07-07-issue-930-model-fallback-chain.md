---
date: 2026-07-07
repo: Rhythm
branch: issue-930-model-fallback-chain
pr: null
issues: [930]
status: partial-by-design
tags: [run, rhythm, "930"]
---

# Run — #930: automatic model fallback chain on rate limits

## Files

- `apps/api_server/src/services/model_fallback.ts` (new) — `classifyProviderError`,
  `FALLBACK_CHAIN` (6 tiers), `AGENT_FALLBACK_CHAIN` env override parsing,
  `resolveAuthedFallbackChain`, `nextFallbackTier`, `resolveCrossProviderHandoff`.
- `apps/api_server/src/services/__tests__/model_fallback.test.ts` (new) — 29 tests.
- `apps/api_server/src/routes/opencode_spillover_routes.ts` — `/opencode/spillover`
  now also accepts `{exhausted: true}` and performs a cross-provider handoff
  (decide + persist providerId/modelId + broadcast `session.spillover`).
- `apps/api_server/src/__tests__/anthropic_session_routing.test.ts` — 3 new cases
  (handoff success, no-authed-fallback, malformed request).
- `apps/api_server/opencode_plugins/rhythm-anthropic-accounts/dist/{accounts.js,index.js}`
  — VENDORED DIFF (tagged): `markAccountsExhausted()`, called when a 429/529 hits
  with no other Anthropic account left.

## Checks

- `npx tsc --noEmit` — clean.
- `npx vitest run` (full api_server suite) — 288 files, 2478 passed, 1 skipped
  (pre-existing), 0 failed.
- `npx vitest run src/services/__tests__/model_fallback.test.ts src/__tests__/anthropic_session_routing.test.ts` — 38 passed.
- `npx vitest run src/__tests__/anthropic_plugin_routing.test.ts` (real vendored
  dist, unchanged pre-existing suite) — 10 passed.

## Units completed

- **Unit 1** — `classifyProviderError` + `FALLBACK_CHAIN` constant. Done, tested.
- **Unit 2** — `AGENT_FALLBACK_CHAIN` env override + authed-provider filter,
  fail-safe to default on empty/malformed input. Done, tested.
- **Unit 3 (scoped, per risk framing)** — api_server-side decision + persistence
  for cross-provider handoff on Anthropic account exhaustion, PLUS the smallest
  possible tagged vendored-plugin diff to signal the exhaustion. Done, tested
  with mocks — did NOT attempt live-engine re-dispatch of the in-flight prompt
  (see "Not attempted" below).
- **Unit 4** — status event. Already satisfied by Unit 3's extension of the
  existing `session.spillover` broadcast: one structured event
  (`reason: 'rate_limit_cross_provider'`, `toProvider`/`toModel`/`toTier`) +
  one `[Spillover]` log line per fallback, metadata only, no prompt text.
  No additional code needed.
- **Unit 5** — tests. Claude team→personal deterministic case was already
  covered by the pre-existing `RHYTHM_FORCE_SPILLOVER` test (unchanged, still
  passing). Generic cross-provider fallback is newly covered (4 pure-decision
  tests + 3 route-level tests). No fallback to unauthed/disallowed providers is
  asserted in both.

## Deviations from the plan

- `resolveCrossProviderHandoff` takes an explicit `exhaustedProviderID`
  parameter rather than a bare "current tier id + pick next" call. The first
  draft used `nextFallbackTier(undefined, authed)`, which picks the FIRST
  authed tier overall — for an anthropic-exhausted session with anthropic still
  in the authed set (which it always will be, since auth ≠ account-exhausted),
  that resolved back onto `team-claude`, defeating the entire cross-provider
  point. My own test (case 7) caught this before commit. The fix: skip every
  tier sharing the exhausted provider id, so both `team-claude` and
  `personal-claude` are skipped together when Anthropic reports exhaustion.
- GLM-5.2 / OpenRouter-free are implemented purely as inert chain data (per
  product decision) — `DEFAULT_MODEL_BY_PROVIDER` has no entry for either, so
  `resolveCrossProviderHandoff` declines (returns undefined) rather than
  guessing a model id, even in the hypothetical case a caller claims they're
  authed. This is intentional, not an oversight.

## Residual risk / not attempted (Unit 3)

Per the plan's explicit risk framing, I did NOT implement or attempt to verify:

- Actually **re-dispatching the in-flight turn's prompt** onto the new provider
  after a cross-provider handoff (re-sending the same prompt via
  `ws_gateway`/`opencode_stream_bridge` against the new provider/model). The
  route only decides the next tier and persists `providerId`/`modelId` on the
  session row — the NEXT turn a user or scheduler sends will pick up the new
  route via `resolveModelForSessionTurn` (session pin precedence), but there is
  no code here that automatically re-fires the CURRENT failed prompt on the new
  provider mid-flight.
- Any live-opencode-engine verification of the vendored plugin diff
  (`markAccountsExhausted`). The diff is syntactically valid (module loads
  under Node) and structurally mirrors the existing `markSpillover` fire-and-
  forget pattern exactly, but was not run against a live engine process — I
  cannot safely reproduce that in this session (same category of blocker noted
  for #927). The pre-existing `anthropic_plugin_routing.test.ts` suite, which
  DOES exercise the real vendored dist against stub HTTP servers, was re-run
  and still passes unchanged (10/10) — it does not yet cover the new
  `markAccountsExhausted` path since that would require simulating "both
  accounts rate-limited," which is a larger test-harness change than the scope
  here calls for.

Stopping here per the plan's explicit instruction to not fake untestable
live-engine coverage. The api_server-side contract (decide + persist + notify)
is real, tested, and mocked-independent of the live engine; the "resume the
same conversation on the new provider automatically" behavior is the piece
that needs a live-engine repro session to build and verify safely.

## Next step

- Manual/live-engine smoke of the vendored plugin diff + full re-dispatch
  wiring, if/when the team decides to close the remaining Unit 3 gap.
- Follow-up issue (not filed automatically): GLM-5.2 / OpenRouter-free
  credential loaders, if/when those providers are actually adopted.
