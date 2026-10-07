---
date: 2026-10-06
repo: rhythm
branch: rhythm-router-parser-repair-20261006
pr: none (no commit/push/PR requested)
issues: none
status: source patch complete, uncommitted; awaiting independent Sol review
tags: [run, rhythm]
---

# Router parser/fallback repair (initial four-file slice)

Base: reviewed a34fefc30d7208b36d9611211fabe3fe512a9dbf. Plan: `../kev-routing-repair-sol-plan.md`; Astra review: `../kev-routing-repair-astra-review.md`.

## Files

All under `apps/api_server/src/services/decision/`:

- `systemone_client.ts` — removed the missing/null-probability one-hot (confidence 1) fallback; probabilities must be a complete object of finite, nonnegative numbers; nonfinite/zero sum (including MAX_VALUE overflow) rejected; each normalized value must be finite in [0,1] and the total ≈ 1. All failures are `error/malformed_response`. The answer `choice` label is no longer read.
- `model_router.ts` — `classifyWithChoice` rejects missing/nonfinite/out-of-range tier probabilities from any ChoiceClient; `routeTurnTier` rejects a nominal ok result whose confidence is not finite in [0,1] or whose tier is unknown, before the threshold and the low-confidence fallback (baseline kept, error row, no chosen/confidence); logged latency is the measured finite nonnegative value, otherwise null.
- `systemone_client.test.ts` — P1, P2, P3 (real parser, raw JSON incl. `1e309`); one existing loopback test given valid probabilities.
- `model_router.test.ts` — R1–R7 (real SystemOneClient with fake fetch for R2/R6, injected clients for R1/R7). Top-level hooks now point `RHYTHM_DECISION_ROUTER_FILE` at a nonexistent temp path so older tests no longer read the host's saved Router settings.

Unchanged: pins/explicit sources, mode/scope/Shadow, consent/redirect/body cap/timeout, normalization of finite positive maps, option-order tie, Astra opt-in, catalog/provider policy.

## Checks (cwd `apps/api_server`, existing node_modules, no install)

- `./node_modules/.bin/vitest run` on systemone_client, model_router, turn_routing, routing_scope, model_catalog_routing tests: 5 files / 59 tests passed, exit 0.
- Same command before the hermetic-settings fix: 56 passed, 3 failed (`off makes no client call`, `on: returns tier when confident, null when not`, `unset env: a non-auto session never calls the client`). Cause: the host `~/Library/Application Support/Rhythm/decision-router.json` (Shadow, saved low-confidence policy) leaked into tests that never isolated it; not caused by the parser/router change.
- `./node_modules/.bin/tsc --noEmit`: exit 0, no output.
- `git diff --check`: exit 0, no output. `git diff --shortstat`: 4 files, +205/-22.
- Not run: broad suite, build, server, any model/live call. Patch SHA-256 hashes not captured (sha256 command not permitted in this session).

## Correction 1: ChoiceClient boundary (Sol HOLD on packet 9a077000)

Sol found custom/injected ChoiceClient results admitted invalid totals, choice/confidence disagreement and extra-key contamination of margin/scores. Normal HTTP parser bypass was not reproduced.

- `model_router.ts` (`classifyWithChoice` only): probabilities must be a non-array object with all three known tiers finite in [0,1], total positive/finite and within 1e-6 of 1; winner computed in tier-option order from those three values; declared `choice` must equal the winner and `confidence` must be finite in [0,1] and within 1e-6 of the winning probability. Otherwise `error/malformed_response` before threshold, fallback, scope gate or catalog. Scores/margin are built only from the three canonical values (extra keys ignored). HTTP parser, tie policy, pins, Shadow, latency handling unchanged.
- Added `sol-choice-boundary.test.ts` via `git apply ../routing-repair-sol-negatives.patch` unchanged (`git apply --check` exit 0 first). No edits to other tests in this correction.
- Before the fix: that file ran 12 failed / 2 passed (the 2 valid controls); the failures were the five admission cases in Shadow and On, plus extra-key margin 8.2 (expected 0.65) and extra NaN retained as `unknown: null` in scores.
- After the fix: `vitest run` on sol-choice-boundary, model_router and systemone_client tests: 3 files / 48 tests passed, exit 0 (14 + 24 + 10). Prior R1–R7 and parser P1–P3 still pass.
- `./node_modules/.bin/tsc --noEmit` (from `apps/api_server`): exit 0, no output. `git diff --check`: exit 0, no output.
- Not run: turn_routing/routing_scope/catalog files, broad suite, build, server, model calls. New patch hashes not captured (sha256 command not permitted earlier). No commit/push/install. Gemini candidate work not started.

## Notes

- GitNexus unavailable: impact status UNKNOWN. Manual trace: `routeTurnTier` and `classifyWithChoice` are module-local to model_router.ts; `parseAnswer` is module-private to systemone_client.ts. Caller review beyond the five test files was not done.
- Disabling P1 validation was not mutation-tested; by inspection the old code returns ok/confidence 1 for R2's first two bodies, so R2 would fail.
- Limits: real API/engine Shadow qualification, Kev latency/cold behaviour and Qwen comparison remain unrun; no model-quality or deployment claim.
