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
| `AGENT_DECISION_TOOL_EAGER_SERVERS` | `4` |
| `AGENT_DECISION_TOOL_MIN_SCORE` | `0.3` |
| `AGENT_DECISION_MEMORY_MIN_SCORE` | `0.5` |

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

1. **off** (default): nothing runs.
2. **shadow**: start the server and set each feature to `shadow`. Decisions are computed and logged and change nothing. Run for about a week.
3. Check `GET /agent-decisions` (local-only). Look at the per-feature summary: failure and timeout rates, latency, and how often the decision would have differed from the baseline.
4. Switch to **on** one feature at a time, starting with the lowest-risk one, and keep watching the summary. Setting a feature back to `off` restores baseline behavior immediately.

## Alternative servers

Any server exposing `POST /v1/rerank` (Jina/Cohere-style `results[].relevance_score`, `data[]`, or a TEI top-level array) works with only a URL change:

- Hugging Face **TEI** (text-embeddings-inference)
- **vLLM** (rerank/score endpoint, when serving a supported reranker)
- **Infinity**
- **LocalAI**

Check the score scale with the smoke test for each, since servers differ in whether they return probabilities or logits.

## Hosted backend later (for example Jev)

A hosted backend would be a new `RerankClient` implementation in `decision_client.ts`, returning the same `RerankResult` union. Nothing else in the engine changes. Today the client refuses any non-loopback base URL so that prompts and memories never leave the machine. A hosted backend would need an **explicit, separate opt-in** (its own env flag and a clear privacy decision), not a relaxation of the loopback guard.

## Capacity routing

`AGENT_DECISION_CAPACITY_ROUTING` = `off` (default) | `shadow` | `on`.
`AGENT_DECISION_CAPACITY_LOW_FRACTION` (default `0.15`, range (0,1)) is the remaining-usage
fraction at or below which an account counts as low.

Behaviour (`services/decision/capacity_router.ts`, no reranker needed):

- Reads ONLY the cached usage-budget snapshot (`getUsageBudget({cachedOnly:true})`). It never
  triggers a provider probe on the turn path; an empty cache means no change.
- Headroom per account = min `remainingFraction` across its windows. Unavailable entries are
  ignored. Unknown headroom is not "low" but ranks below any known non-low account.
- Base provider has a non-low account: keep the model, use the account with the most headroom.
- Base provider is low: switch to another authed provider with a route in the same capability
  tier (else the cheapest higher tier) that has capacity, on its most-headroom account.
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
