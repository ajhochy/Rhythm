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

## Free Mode addendum (AJ, 2026-10-08) — new required work, not implicitly waived

Free Mode is a separate downstream path when all four subscription accounts are exhausted and paid
OpenRouter is unusable/budget-limited (or skip_paid_openrouter). Reset times do not prove capacity:
passing a reset makes the account eligible for a usage refresh; a fresh positive capacity signal exits
Free Mode. use_free_for_tier4 defaults false. All model ids, ordered grids, supported efforts, text-only
lists, probation, Ling flag, budgets and limits belong under free_mode in the router grid config.

Implementation boundaries:
- Deterministic policy + token-bucket/daily budget/circuit-breaker are a separate module; pure policy can
  be tested while existing paid runtime wiring is in progress. Integration has ONE owner: manager.
- Privacy is checked BEFORE calling a free classifier. contains_private_data from a later classifier is
  insufficient: that would already disclose data. Any known-private or unknown/uninspected attachment
  queues for paid capacity; it never reaches free classification, images helper or shadow/probation.
  The classifier adds contains_private_data but cannot waive a preflight hold.
- Tier1 may queue; if cannot queue it is degraded and requires an observable verification PASS before
  its result is released. EVERY free output needs verification. v1 currently has no generic task verifier,
  so free execution cannot be enabled merely because pure selection tests pass. Queue/hold without a
  configured verifier is safer than displaying unverified output. Do not claim an LLM judge = proof of
  arbitrary tool-side effects.
- No real-user request goes to space-bunny-free, including copied/shadow requests. Probation never gets
  real work; synthetic evaluation only until explicit human promotion and privacy permissions.
- The shared free budget counts classifier, image helper, answering, verification (when free), retries,
  and probation calls. A helper+answer+verification must reserve the full call budget before starting.
- Queue is durable; Tier1 first then age, reuse classification, cancellation/owner/consent rechecked on
  dequeue. No automatic replay of destructive tools or jobs that have already partially executed.
- Retry circuits distinguish provider failure from a cancelled task. Three failures in ten minutes open
  for fifteen. Exhausted lists get at most one delayed retry (60s), random /free last and degraded, then
  queue. Every failure/retry records the actual selected model, not just the /free alias.
- Free mode settings remain disabled while assembling the build. Live app routing stays off.

Free-mode acceptance scenarios (required): paid OpenRouter capacity prevents free entry; paid unusable
enters; T2 coding Small Inkling then Inkling if circuit open; any private/unknown-private task queues
before ANY free call; T1 queue vs degraded+verification; screenshot helper then text model only for
non-private inspected images; empty200 advances candidate; daily20%-remaining queues T4; account recovery
exits and drains T1-first; Ling false excluded; only space-bunny responsive still queues. Config
defaults rpm20/day50/reserve25%, use_free_for_tier4=false, ling_verified_free=false, shadow_test=false.

## Free Mode runtime status (2026-10-09 r10): F1 + F2 implemented and live-proven on the synthetic sandbox;
F3 verifier interface present with an empty registry, so Free execution remains impossible. See ledger "final-r10".

F3 observable-proof design (required before any verifier is registered): a verifier is per task class and checks
side effects, never text quality: e.g. coding = repo test command exit 0 on a clean checkout plus diff limited to
requested paths; file/format extraction = schema validation of the produced file; calendar/email drafts = created
object exists via its API and matches requested fields. Each needs a synthetic fixture where a wrong output FAILS.
No LLM judge, no canned PASS, hold-only tests never count as Free execution. Privacy must be provably `false` first,
which needs a local detector that does not exist yet.

## Free Mode runtime: staged integration plan (manager, 2026-10-09; superseded by status above)

Existing: pure policy (`router_free_policy.ts`), state/budget/circuit store (`router_free_state.ts`), config
(`router_free_config.ts`, `free_mode` in grid config) - units only. No runtime caller exists.
Hook: `routeGridTurn` (router_grid_turn.ts) when `selectRoute` returns `kind:'none'`. Manual callers:
ws_gateway.ts:633 (via turn_routing.routeTurnForSession), agent_runner.ts:1240, mobile_prompt_routing.ts:74.
GitNexus: UNKNOWN (not indexed). Manual risk: HIGH (every prompt dispatch path). Disabled by default.

- F1 hold/queue (no free model call at all; v1 has no verifier, so this is the only legal Free behavior):
  free_mode.enabled AND determineFreeMode(active) -> privacy preflight (any private/unknown attachment
  queues) -> durable body-free descriptor via RouterFreeStateStore (session, owner, tier from durable or
  rules classification - no remote/free classifier call, createdAt, consent generation) -> new result
  outcome `queued:'free_mode_no_verifier'`. All three callers must NOT dispatch; session status queued with
  a bounded message; scheduler run recorded `blocked`. Budget0: no paid OpenRouter fallback.
- F2 drain: on fresh positive capacity (usage refresh/exhaustion expiry), determineFreeMode inactive ->
  sortFreeQueue (T1 first, then age) -> recheck not cancelled/archived, owner and consent unchanged ->
  redispatch once on the normal paid path; never replay partially executed turns or destructive tools.
- F3 verifier: interface + config; free execution stays disabled until a configured verifier exists.
- Proof (synthetic, loopback only): grid sandbox override `free_mode.enabled`, all four synthetic accounts
  known-zero via grid fake-provider control, OpenRouter unauthed; WS + scheduled prompt -> zero provider
  requests, session queued, descriptor persisted body-free; two queued sessions (T3 then T1); restore
  positive usage -> T1 drains first, each exactly one paid dispatch; cancelled session never dispatched.
  Plus units for each caller's no-dispatch contract. Requires owner review before merge.

## Manager checkpoint / new constraints (AJ watcher, 2026-10-08)

No file deletion, worktree removal, branch cleanup or temp cleanup. Preserve evidence. No live-host
restart/kill, unrelated-process management, unauthorized online access or main merge. Existing two
coding writers remain sole owners of paid wiring and new free-policy modules; do not duplicate them.
A disjoint sandbox-tools agent adds opt-in preserve-files teardown before the manager stops sandbox.

Static review on 03aad82d found REQUIRED repairs before runtime gate:
1. Account-default provenance: create must mark auto when neither requested nor profile account was
   supplied, regardless of whether legacy capacity mode made a choice. Store default is not a pin.
2. Explicit account PATCH must revoke auto eligibility per provider, even when choosing same id;
   preserve the other provider's state and ensure grid reselection cannot overwrite the new pin.
3. markExhausted must ignore past deadlines and preserve max(existing,new) active cooldown. Clearing
   requires a separate positively confirmed recovery operation, not a stale exhaustion event.

Manager attempted to send steering to the EXISTING writers through local session control; request
was refused 401. No credentials bypassed and no replacement/duplicate writers were started. These
repairs are held at the single integration boundary after the existing wiring writer finishes.

Current acceptance status: core synthetic tests PASS (391 before free addendum); shared multi-question
Decisions transport was checked against real API with explicit prior authorization; paid runtime
model+effort+account grid NOT RUN; Free Mode runtime/verifier/queue NOT RUN; installed candidate NOT
BUILT. No global enablement from synthetic tests.
