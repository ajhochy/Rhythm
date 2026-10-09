---
date: 2026-10-08
tags: [plan, rhythm, decision-engine]
status: approved (AJ, 2026-10-08)
---

# Model router v2: classify with a model, route with a grid

AJ's spec (2026-10-08), adapted to Rhythm. Stacked on the PR #1611 branch (targets mega).

## Rule

The model only classifies. Model, effort, account and fallback are deterministic code driven by
`apps/api_server/src/services/decision/router_grid.default.json` (optional user override file
`router-grid.json` next to `decision-router.json`). Price never chooses the tier.

## Pipeline (v1)

1. **Classify** (first prompt of an Auto session): one OpenAI Decisions API request with four
   questions: `tier` (score, 4 ordered levels: tier 4 simplest ... tier 1 hardest), `category`
   (choice: coding / design / knowledge), `can_queue` and `security_sensitive` (predicates).
   Tier = expected level mapped through `classifier.tier_thresholds` (calibrated on AJ's real first
   prompts). `est_input_tokens` is computed in code. Failure -> rules default (keyword category,
   `rules_default_tier`).
2. **Select route** (pure function): walk `routing[category][tier]` in order; skip candidates by
   adjustment rules (long-prompt surcharges, security -> skip Anthropic, DeepSeek weekday peak
   last, model not available in the live engine catalog); `pick_account(provider, tier)` over the
   provider's connected accounts using the cached usage snapshot (min remaining fraction across
   windows), excluding accounts marked exhausted, applying the reserve rule (tier 1 exempt), max
   quota then earliest reset. Rule-only skips step up one tier (rules only). Everything closed
   exhausted -> `openrouter_fallback` (queue_or_degrade -> degraded model, flagged; v1 never queues).
   OpenRouter unusable -> keep the session's normal route.
3. **Apply** on the first prompt: model + effort (engine variant) + account for that provider;
   persisted on the session. Pinned models/accounts untouched.
4. **Exhaustion**: a usage-limit error / spillover report marks that account exhausted until its
   reset (or retry-after). On the session's next message, a routed session whose account is
   exhausted is re-selected with the saved classification (the failed message is not auto-retried
   in v1).
5. **Ledger**: one decision-log row per routing decision with the full walk (each candidate and
   why it was skipped), category, tier, model, effort, account, est tokens, est cost, degraded.

## Deferred (not v1)

Verification/escalation (stages 4-5 of the spec), queueing, task_type and the weekly/monthly
jobs, LLM classifier fallbacks (Haiku / MiMo). Chat has no automatic verifier.

## Acceptance (unit, deterministic)

Spec tests 1-11 (test 12 = escalation, deferred), plus: unknown usage counts as eligible but ranks
below known usage; unavailable models are skipped; pinned sessions never routed.

## Spec sections 5.1-5.4 (AJ, verbatim logic; v1 notes in brackets)

### 5.1 Account state
Each account: `id`, `provider` (anthropic|openai), `quota_remaining_pct` (0-100, from provider usage
data; [v1: Rhythm's cached usage snapshot, min remaining across windows x 100; null = unknown]),
`resets_at` (next reset), `exhausted_until` (set when a usage-limit error is received, else null).
Exhaustion: on HTTP 429 / usage-limit, set `exhausted_until = resets_at` (or retry-after if given);
do not use that account until then.

### 5.2 Account picker
```
pick_account(provider, tier):
    eligible = accounts where provider matches
               AND exhausted_until is null or in the past
               AND (quota_remaining_pct > reserve_pct OR tier == 1)
    if none: return null
    return max by quota_remaining_pct, tie-break by earliest resets_at
```
[v1: unknown quota_remaining_pct is eligible but ranks below every known value.]

### 5.3 Route selector
```
select_route(c):   # c = classification
    for cand in routing[c.category][c.tier]:        # ordered cheapest-first
        if cand fails an adjustment rule (5.4): continue
        acct = pick_account(cand.provider, c.tier)
        if acct: return {cand, acct}
    # if candidates were skipped only by adjustment rules (not exhaustion),
    # try the next tier up (tier - 1) before leaving the closed accounts
    if any candidate was skipped by a rule and c.tier > 1:
        return select_route(c with tier = c.tier - 1, rules_only = true)
    # all closed candidates exhausted -> OpenRouter
    fb = openrouter_fallback[c.category][c.tier]
    if fb.action == "queue_or_degrade":
        if c.can_queue: return QUEUE(until = earliest resets_at across accounts)
        return {fb.degraded_model, flag "degraded"}
    return {fb.models[0], account "openrouter"}
```
Resolved semantics (orchestrator, v1): the step-up call is a normal walk of tier-1 (adjustment rules
AND account checks both apply; `pick_account` uses the STEPPED tier, so the reserve exemption applies
when it reaches tier 1). It may recurse again under the same condition until tier 1. If the stepped
walk finds nothing, fall through to the OpenRouter fallback of the ORIGINAL classified tier. v1 never
returns QUEUE: queue_or_degrade always returns the degraded model (record can_queue in the trace).
An OpenRouter model counts only if `openrouterUsable` and the model is available; otherwise return
`none` (caller keeps the session's normal route).

### 5.4 Adjustment rules (applied while walking candidates)
| Rule | Condition | Action |
|---|---|---|
| OpenAI long-prompt surcharge | est_input_tokens > 272000 and candidate is OpenAI | Skip |
| Haiku long-prompt surcharge | est_input_tokens > 100000 and candidate is Haiku 5.5 | Skip |
| Security tasks | security_sensitive and candidate is Anthropic | Skip |
| DeepSeek peak pricing | DeepSeek model during weekday peak hours | Move to end of the fallback list |
[v1 adds: candidate model not available in the live engine catalog -> skip, counted as a rule skip.]

## Acceptance tests (spec section 9; v1 expectations)
| # | Scenario | Expected route |
|---|---|---|
| 1 | Tier 4 extraction, all accounts healthy | Haiku 5.5 @ low on the Anthropic account with more quota |
| 2 | Same, both Anthropic accounts exhausted | GPT-6 Luna @ max on the OpenAI account with more quota |
| 3 | Tier 2 coding, OpenAI accounts at 10% and 12% | Skips OpenAI (under 15% reserve) -> Sonnet 5.5 @ high |
| 4 | Tier 1 coding, Anthropic accounts at 10% and 12% | Sonnet 5.5 @ xhigh on the 12% account (reserve does not apply to tier 1) |
| 5 | Tier 3, prompt 400K tokens, all healthy | Skip Haiku (>100K), skip GPT-6 Sol (>272K) -> step up -> skip GPT-6.1 Sol -> Sonnet 5.5 @ high |
| 6 | Tier 1 knowledge, all accounts exhausted, can_queue=true | [v1: no queue] MiMo-V2.6-Pro degraded, can_queue recorded |
| 7 | Same, can_queue=false | MiMo-V2.6-Pro, degraded |
| 8 | Tier 1 design, all accounts exhausted | Kimi K3 on OpenRouter |
| 9 | Security research task, tier 2 | Skips Sonnet -> GPT-6.1 Sol @ max |
| 10 | Both OpenAI accounts exhausted | [v1: classifier uses the API key, not the accounts] classifier failure -> rules default |
| 11 | Two Anthropic accounts tied on quota | Picks the one that resets sooner |
| 12 | Escalation | Deferred (no verifier in v1) |

## Classifier wording (calibrated 2026-10-08 on 50 real first prompts; use exactly)
tier score question instructions: "The input is a request a person sent to their AI assistant, which
can use tools (files, email, calendar, web, code, other agents). Pick the LOWEST tier whose model will
reliably do this request well. Judge the work it requires, not the length of the message or its
subject area. When unsure between two tiers, pick the higher (harder) one." Levels index 0..3 =
tier4..tier1 with the descriptions in the G1 brief. Thresholds `tier_thresholds = [0.1, 0.35, 2.25]`.
