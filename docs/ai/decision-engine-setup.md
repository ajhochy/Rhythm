---
date: 2026-09-29
repo: rhythm
tags: [doc, rhythm, decision-engine]
---

# Local decision engine: operator setup

The decision engine scores prompts against candidates with a local reranker. It powers model routing, MCP tool ranking and memory ranking. Design: `docs/ai/plans/2026-09-29-local-decision-engine.md`. Everything is off by default, and any failure falls back to the unchanged baseline.

## Model

- **Qwen3-Reranker-4B** (Apache-2.0): the default. It is the strongest open-weight reranker we know of, and it fits in roughly 8-16 GB of RAM.
- **Qwen3-Reranker-0.6B**: the fast option for low-memory machines or tight latency budgets. Expect lower quality. Run the bench before trusting it.

Set `AGENT_DECISION_MODEL` to match what you serve. llama.cpp largely ignores the name, but other servers may not.

## Run it on macOS (llama.cpp)

```bash
brew install llama.cpp
llama-server -hf <gguf-repo>:Q4_K_M --reranking --port 8012 --host 127.0.0.1 -c 8192 -ub 8192
```

- `<gguf-repo>` must be a **GGUF conversion of Qwen3-Reranker** that your llama.cpp build supports for reranking. Not every community conversion works, so check that the model card mentions reranking or llama.cpp `--reranking`.
- `--reranking` exposes `POST /v1/rerank`, which is the endpoint the client uses.
- Bind to `127.0.0.1`. The client refuses non-loopback URLs.

### Smoke test

```bash
curl -s http://127.0.0.1:8012/v1/rerank -H 'content-type: application/json' -d '{
  "model": "qwen3-reranker-4b",
  "query": "What time does Sunday setup start?",
  "documents": ["Sunday service setup starts 7am in the Main Hall", "AJ is allergic to shellfish"]
}'
```

You should get `results` with an `index` and a `relevance_score` per document, and the first document should score clearly higher.

### Score scale (important for llama.cpp)

llama.cpp typically returns **raw logits**. Negative values mean logits. The client can misread logits that happen to fall in [0,1], so in `auto` mode a batch is interpreted differently depending on its contents. Set:

```bash
AGENT_DECISION_SCORE_SCALE=logit
```

unless your server already returns probabilities. Values are `auto` (default: keep a batch if all scores are in [0,1], otherwise sigmoid), `probability` (clamp to [0,1]) and `logit` (always sigmoid). If the smoke test shows any negative score, use `logit`. The bench accepts `--score-scale` for the same choice.

## Environment variables

Read live from `apps/api_server/src/config/env.ts`.

| Var | Default |
|---|---|
| `AGENT_DECISION_BASE_URL` | `http://127.0.0.1:8012` (loopback only; non-loopback is refused) |
| `AGENT_DECISION_MODEL` | `qwen3-reranker-4b` |
| `AGENT_DECISION_TIMEOUT_MS` | `400` |
| `AGENT_DECISION_SCORE_SCALE` | `auto` (`auto` \| `probability` \| `logit`) |
| `AGENT_DECISION_MODEL_ROUTING` | `off` (`off` \| `shadow` \| `on`) |
| `AGENT_DECISION_TOOL_RANKING` | `off` (`off` \| `shadow` \| `on`) |
| `AGENT_DECISION_MEMORY_RANKING` | `off` (`off` \| `shadow` \| `on`) |
| `AGENT_DECISION_ROUTING_MIN_CONFIDENCE` | `0.55` |
| `AGENT_DECISION_ROUTING_SCOPE` | `first_prompt` (`first_prompt` \| `escalate_only` \| `every_prompt`) |
| `AGENT_DECISION_ESCALATE_MIN_CONFIDENCE` | `0.75` (used by `escalate_only`) |
| `AGENT_DECISION_TOOL_EAGER_SERVERS` | `4` |
| `AGENT_DECISION_TOOL_MIN_SCORE` | `0.3` |
| `AGENT_DECISION_MEMORY_MIN_SCORE` | `0.5` |
| `AGENT_DECISION_MEMORY_TIMEOUT_MS` | `max(AGENT_DECISION_TIMEOUT_MS, 800)` (memory pools are larger than tool/route batches) |
| `AGENT_DECISION_CAPACITY_CROSS_AGENT` | `true` (set `false` to keep capacity routing inside the current agent's model table) |
| `AGENT_DECISION_LOG_MAX_ROWS` | `20000` (oldest `agent_decision_log` rows are trimmed after every 500th insert) |

Memory ranking reranks at most 16 candidates of 700 characters each. If the p95 latency for `memory_ranking` in the decision log (`GET /agent-decisions`) exceeds the memory budget, switch to the 0.6B reranker for memory ranking.

The default 400 ms timeout is tight for a 4B model on a cold start. Check latency with the bench before enabling anything beyond shadow.

## Evaluate

From `apps/api_server`:

```bash
npx tsx scripts/decision_bench.ts --base-url http://127.0.0.1:8012 --model qwen3-reranker-4b \
  --score-scale logit --feature all --json /tmp/decision-bench.json
```

It runs labelled fixtures for routing (45 prompts), tool ranking (25 prompts over 10 servers) and memory ranking (15 queries over 8 memories each). For each feature it reports accuracy, ranking metrics, latency p50/p95/max, Expected Calibration Error (5 bins, top score as confidence) and a reliability table. If the server is unreachable it exits non-zero.

- `--fake` runs an in-process token-overlap scorer. It only proves the pipeline works, and its numbers say nothing about model quality.
- Tune `AGENT_DECISION_ROUTING_MIN_CONFIDENCE`, `..._TOOL_MIN_SCORE` and `..._MEMORY_MIN_SCORE` using the reliability table and the precision/recall-at-threshold output.
- The fixtures are small and hand-written, so treat the results as a sanity check. Add your own real prompts to `scripts/decision_bench/fixtures.ts`.

## Rollout

1. **off** (default): nothing runs, except that Auto (router) sessions run `model_routing` and `capacity_routing` in **shadow** when the env var and saved setting are unset. They log decisions and change nothing.
2. **shadow**: start the server and set each feature to `shadow`. Decisions are computed and logged and change nothing. Run for about a week.
3. Check `GET /agent-decisions` (local-only). Look at the per-feature summary: failure and timeout rates, latency, and how often the decision would have differed from the baseline.
4. Once the calibration script or bench shows acceptable accuracy, set the feature to **On** in Router settings. Auto sessions do not turn on by themselves. Switch to **on** one feature at a time, starting with the lowest-risk one, and keep watching the summary. Setting a feature back to `off` restores baseline behavior immediately.

## Alternative servers

Any server exposing `POST /v1/rerank` (Jina/Cohere-style `results[].relevance_score`, `data[]`, or a TEI top-level array) works with only a URL change:

- Hugging Face **TEI** (text-embeddings-inference)
- **vLLM** (rerank/score endpoint, when serving a supported reranker)
- **Infinity**
- **LocalAI**

Check the score scale with the smoke test for each, since servers differ in whether they return probabilities or logits.

## Hosted backend later (for example Jev)

A hosted backend would be a new `RerankClient` implementation in `decision_client.ts`, returning the same `RerankResult` union. Nothing else in the engine changes. Today the client refuses any non-loopback base URL so that prompts and memories never leave the machine. A hosted backend would need an **explicit, separate opt-in** (its own env flag and a clear privacy decision), not a relaxation of the loopback guard.

## Which models the router chooses among

The router and the capacity layer choose among the models that are actually available now, not a
hardcoded table (`services/decision/model_catalog.ts`).

- **Live catalog.** `opencodeClient.providerSnapshot()` (the engine catalog) supplies per model:
  price (`cost` in USD per 1M tokens), `releaseDate`, `family`, `reasoning`, context limit. The
  router only picks models that are **enabled in Rhythm's Models curation**
  (`agent_model_visibility`, an explicit `visible = 1` row; no row or `visible = 0` means not
  enabled), and then applies its own exclusions. The routable set is: enabled models, minus
  unconnected providers, minus ineligible models (deprecated, no text in/out, no tool calls), minus
  models the cached usage snapshot says the account is not entitled to (only an explicit `false`
  drops a model), minus models excluded in Router settings. The static approved-family lists are
  not consulted, so a model outside them is routable once enabled, and a listed model with no row
  is not. Derived tier cutoffs are computed over the enabled set only. If nothing is enabled the
  live set is empty (`reason: no_curated_models`): the router and capacity layer keep the baseline
  route and log the reason; the static table is used only when the engine is unreachable. Settings
  shows every connected model, with `enabled: false` on the ones the router cannot use, and
  `catalog.curatedCount`. Keyless local providers (ollama, omlx,
  opencode) are included at zero cost and are always `cheap`. `-1m` / `:extended` / long-context
  variants are used only when the current route already is one. The set is cached for 60 seconds
  and dropped when Router settings or the Models curation change.
- **Tiers come from output price (USD per 1M output tokens).** `cheap` at or below the cheap
  cutoff, `frontier` at or above the frontier cutoff, otherwise `standard`. A model with no price
  falls back to the name heuristic (`classifyRouteTier`); the settings table marks it
  `tierSource: heuristic`.
- **Cutoffs are derived (`tiers.mode: auto`, default).** Take the newest priced model per
  provider+family, trim ultra-priced outliers (more than 5x the median), split the sorted distinct
  prices in half and put each cutoff at the geometric midpoint of the largest log-price gap in its
  half. With today's catalog that lands around $7.7 and $19.4 (gaps 5 to 12 and 15 to 25). Fewer
  than three distinct prices falls back to the manual values (seed 6 / 25); cutoffs are clamped to
  [$1, $100]. `tiers.mode: manual` uses `cheapMaxOutputUsd` / `frontierMinOutputUsd` as saved
  (cheap must be lower than frontier, both above 0).
- **Overrides and exclusions.** `tierOverrides` (`"provider/model": tier`) beats price and
  heuristic (`tierSource: override`). `excludedModels` (`"provider/model"`) removes a model from
  routing; it still shows in the settings table, flagged `excluded`.
- **Selection.** Within a tier: the base route's provider first (keeps the session's account and
  prompt cache), then the provider with the most usage headroom, then any; inside a provider the
  lowest output price, then the newest release. Models priced at or above 5x the frontier cutoff
  stay frontier but sort last (and their provider ranks last), so a $180 "pro" model never beats a
  $25 to $30 one. With no live model at the tier the static resolver is used.
- **Static fallback.** When the engine catalog is empty or unreachable the set is built from
  `ROUTE_FALLBACKS_BY_AGENT` (every agent, authed providers only, heuristic tiers) and decisions
  record `catalog: 'static'` (live is `catalog: 'live'`) in `agent_decision_log` detail for both
  `model_routing` and `capacity_routing`.

API: `GET /agent-decisions/config` returns `tiers: {mode, cheapMaxOutputUsd, frontierMinOutputUsd,
derivedFromModels}`, `tierOverrides`, `excludedModels`, and `catalog: {fetchedAt, source, tiers,
models: [{providerID, modelID, name, family, tier, tierSource, costOutputUsd, costInputUsd,
releaseDate, contextLimit, excluded}]}` sorted by tier, provider, newest. `PUT` accepts `tiers`
(`{mode:'auto'}` or `{mode:'manual', cheapMaxOutputUsd, frontierMinOutputUsd}`), `tierOverrides`
(replaces the map) and `excludedModels` (replaces the list); errors are 400 `invalid_tier`,
`invalid_threshold` or `invalid_body`.

## Capacity routing

`AGENT_DECISION_CAPACITY_ROUTING` = `off` (default) | `shadow` | `on`.
`AGENT_DECISION_CAPACITY_LOW_FRACTION` (default `0.15`, range (0,1)) is the remaining-usage
fraction at or below which an account counts as low.

Behaviour (`services/decision/capacity_router.ts`, no reranker needed):

- Reads ONLY the cached usage-budget snapshot (`getUsageBudget({cachedOnly:true})`) on the turn
  path; an empty cache means no change for that turn. When the cache is missing or older than
  5 minutes, a fire-and-forget `getUsageBudget()` refresh is started (never awaited, one in flight,
  errors swallowed). The Anthropic usage probe consumes one request per refresh, so 5 minutes is
  the floor between capacity-triggered refreshes.
- Headroom per account = min `remainingFraction` across its windows. Unavailable entries are
  ignored. Unknown headroom is not "low" but ranks below any known non-low account.
- Base provider has a non-low account: keep the model, use the account with the most headroom.
- Base provider is low: switch to another provider with a live catalog model in the same tier band
  (else the cheapest higher tier) that has capacity, on its most-headroom account. Equivalence is
  by price band, not by name.
- Cross-provider (`AGENT_DECISION_CAPACITY_CROSS_AGENT`, default on): candidates are the routable
  live catalog (see "Which models the router chooses among"), so a low Anthropic base can move to
  an equivalent-band OpenAI model. Off keeps candidates on the agent's own providers (plus
  aggregators). The decision detail records `crossAgent: true` when used and `catalog`. Only when
  the engine catalog is empty or unreachable are the `ROUTE_FALLBACKS_BY_AGENT` tables used.
- Everything low: pick the lowest capability tier that still satisfies the job (never a cheaper
  one), then the provider/account with the MOST headroom. Models in one tier are treated as
  equivalent, so price never breaks ties.
- Session create (`on` only): with no requested and no profile-default account, the account
  with the most headroom replaces the store default. These sessions are remembered in memory.

Guardrails: pinned sources (`turn_override`, `session`, `agent_config`) never change model.
Turn-time account switching applies only to sessions whose account was auto-picked (in-memory
set, lost on restart = no switching). A healthy current account is kept unless another leads
by 10+ points. `shadow` logs to `agent_decision_log` (feature `capacity_routing`) and changes
nothing. Every failure keeps the existing behaviour.

## Router backend settings

Pick the router model in Providers settings (Electron and mobile) or through
`GET/PUT /agent-decisions/config` (mobile: `/mobile-gateway/tools/agent-decisions/config`,
`mac-global-admin` only). Settings are stored in
`~/Library/Application Support/Rhythm/decision-router.json` (mode 0600; override with
`RHYTHM_DECISION_ROUTER_FILE`). Precedence: an explicitly set env var, then the saved setting,
then the default. Pinned keys come back in `lockedByEnv` and show read-only.

- **local** (default): a reranker on this machine, loopback only (`http://127.0.0.1:8012`).
- **Jev**: hosted, `https://api.typesafe.ai`, model `jev-latest`. Needs an API key and consent.
  One Choice question per candidate; score is `probabilities.yes`. Default timeout 1500 ms.
- **custom**: any `/v1/rerank` server. Loopback, LAN (RFC1918/IPv6-local) `http`, or public
  `https` (must resolve to public addresses; link-local/metadata are blocked). Optional
  Bearer key. LAN example: `http://192.168.1.20:8012` on another computer.

Privacy: Jev and any custom server that is not on loopback (LAN counts) receive prompt and
memory text, so they stay disabled (`consent_required`) until you turn on `remoteDataConsent`.
API keys are write-only: GET returns `hasApiKey`, never the key, and an empty string clears it.
Use `POST /agent-decisions/config/test` (optionally with an unsaved draft) to run a three
document sample before saving. The default timeout is 400 ms for local and 1500 ms for
Jev/custom unless you set one.

## Routing scope

`routing.scope` (settings, or `AGENT_DECISION_ROUTING_SCOPE`) decides when the router may run for an
Auto (router) session. It applies to desktop and mobile alike.

| Scope | Behaviour |
|---|---|
| `first_prompt` (default, recommended) | Routes the first prompt only and stores the pick on the session (`providerId`/`modelId` plus `router_decided_at`; `modelMode` stays `auto`). Later prompts skip the reranker entirely and reuse the stored model: one model per conversation, warm prompt caches, one reranker call per session. If the first attempt is not applied (low confidence, reranker down), nothing is stored and the next prompt tries again. |
| `escalate_only` | Runs on every prompt but only moves UP a tier, and only at confidence >= `routing.escalateMinConfidence` (default 0.75). Downgrades never happen mid-session. An applied escalation is stored like a first-prompt pick. |
| `every_prompt` | Routes every prompt and stores nothing (the original behaviour). |

Shadow mode computes and logs the decision (the decision log detail carries `scope` and `wouldApply`)
but persists nothing. The capacity layer still runs on every prompt in all scopes. Choosing Auto again
in the model picker (`PATCH {modelMode:'auto'}`) clears `router_decided_at`, so the next prompt is routed
again. Sessions expose `routerDecidedAt`. Both fields are in `GET/PUT /agent-decisions/config` as
`routing: { scope, escalateMinConfidence }` (400 `invalid_routing_scope` / `invalid_confidence`) and are
listed in `lockedByEnv` when the env var is set.

### Mobile

Mobile prompts already pass through the api_server (`/mobile-gateway/opencode/session/{id}/prompt_async`
-> `MobileOpenCodeProxy.forward`), so routing happens there and needs no engine change. Before forwarding
`session.prompt_async` for an Auto session, the proxy applies the same scope, router and capacity logic and
rewrites the body's `model: {providerID, modelID}`:

- no `model` in the body: the routed pick, else the session's stored model;
- `model` equal to the stored/profile model (an echo): replaced when routing applies;
- a different `model`: an explicit turn choice, forwarded unchanged and not routed.

Sessions created from mobile default to `auto`. `PATCH /mobile-gateway/sessions/:id/state` accepts
`modelMode` (`auto` clears `router_decided_at`; `fixed` pins the sent provider/model) and returns
`modelMode`/`routerDecidedAt`. Any routing failure forwards the original body. The relay path reaches
the same proxy and inherits this.

## Calibrating the router

`apps/api_server/scripts/decision_calibrate.ts` sends 20 labelled prompts (7 cheap, 7 standard,
6 frontier, including short-but-hard and long-but-easy cases) through the real routing path,
`classify(prompt, TIER_LABELS)`, and compares the picked tier/model with the expected one.

```bash
cd apps/api_server
npx tsx scripts/decision_calibrate.ts                       # router's current backend (settings + env)
npx tsx scripts/decision_calibrate.ts --agent codex --json out.json
npx tsx scripts/decision_calibrate.ts --base-url http://127.0.0.1:8012 --model qwen3-reranker-4b --score-scale logit
npx tsx scripts/decision_calibrate.ts --fake                # pipeline smoke test, numbers are meaningless
npx tsx scripts/decision_calibrate.ts --fixtures my.json    # [{prompt, expectedTier, why}]
```

Expected models come from the live catalog (`getRoutableModels`) when the engine is reachable, via
the same `pickModelForTier` the router uses; `--static-catalog` forces `ROUTE_FALLBACKS_BY_AGENT[agent]`
(first route at the tier, all providers treated as authed). The script prints which one was used
(`catalog: live (N models)` or `catalog: static`) and falls back to static with a warning when the
engine is down (`scripts/decision_bench.ts` accepts the same flag and prints the same line).
Exit code is 0 unless the backend is unreachable (1).

How to read it:

- **Per-prompt table**: ✓/✗ against the expected tier; `abstain` means confidence is below
  `AGENT_DECISION_ROUTING_MIN_CONFIDENCE`, so the router would keep the resolver's model.
- **Confusion matrix / per-tier accuracy**: which tier is being confused with which.
- **Threshold sweep**: coverage vs accuracy-among-applied. The recommended value is the lowest
  threshold with at least 90% applied-accuracy (min 3 applied prompts), printed as an env line.
  If none qualifies, fix descriptions or score scale first.
- **Margin analysis**: same sweep on top-minus-runner-up; says whether margin separates better.
- **Score-scale diagnostic**: a narrow score band, or scores outside [0,1], means try
  `AGENT_DECISION_SCORE_SCALE=logit` (or `probability`).
- **Description diagnostics**: misrouted prompts, which tier won and by how much, overlapping
  words, and a concrete edit suggestion for `TIER_LABELS` in `src/services/decision/model_router.ts`.
- **Cost / quality**: over-routed (picked higher, costs more) vs under-routed (picked lower,
  quality risk). If under-routing dominates, prefer a higher confidence gate for downward picks.

The loop: run, adjust the threshold and/or tier descriptions, rerun, and once applied-accuracy holds
(and coverage is acceptable) set the model-routing feature to On.
