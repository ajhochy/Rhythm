---
date: 2026-09-29
repo: rhythm
branch: feat/local-decision-engine
status: in-progress
tags: [plan, rhythm, decision-engine]
---

# Local decision engine (Jev-style) — model routing, tool ranking, memory ranking

Goal: a single local "decision model" (typed decisions + 0..1 scores) that powers
three prompt-path decisions. It starts on the best open local reranker and is built so a
hosted backend (TypeSafe Jev) can be swapped in later.

## Model choice

**Qwen3-Reranker-4B** (Apache-2.0) is the default. It is the top open-weight reranker
(~77 nDCG@10 BEIR average), has 32k context, and fits in 8–16 GB RAM.
`Qwen3-Reranker-0.6B` (Q4_K_M ≈ 0.4 GB) is the fast fallback. It is served by
**llama.cpp `llama-server --reranking`** on loopback. The client speaks the common
`POST /v1/rerank {model, query, documents, top_n}` shape, so TEI, vLLM, Infinity and
LocalAI also work with only a URL change.

Scores are normalised to [0,1]. If every score is already in [0,1] it is used as-is;
otherwise a logistic sigmoid is applied.

## Rollout modes (per feature)

`off` (default) → `shadow` (compute and log, change nothing) → `on` (apply). Every
failure, timeout or disabled state returns the unchanged baseline. The engine never throws
on the prompt path.

## Env (read live via functions in config/env.ts)

| Var | Default |
|---|---|
| `AGENT_DECISION_BASE_URL` | `http://127.0.0.1:8012` (loopback only; non-loopback is refused) |
| `AGENT_DECISION_MODEL` | `qwen3-reranker-4b` |
| `AGENT_DECISION_TIMEOUT_MS` | `400` |
| `AGENT_DECISION_MODEL_ROUTING` | `off` \| `shadow` \| `on` |
| `AGENT_DECISION_TOOL_RANKING` | `off` \| `shadow` \| `on` |
| `AGENT_DECISION_MEMORY_RANKING` | `off` \| `shadow` \| `on` |
| `AGENT_DECISION_ROUTING_MIN_CONFIDENCE` | `0.55` |
| `AGENT_DECISION_TOOL_EAGER_SERVERS` | `4` |
| `AGENT_DECISION_TOOL_MIN_SCORE` | `0.3` |
| `AGENT_DECISION_MEMORY_MIN_SCORE` | `0.5` |

## Modules (apps/api_server/src/services/decision/)

- `decision_client.ts`: `RerankClient.rerank(query, docs, {timeoutMs}) → RerankResult`
  (a status union: `ok` \| `disabled` \| `timeout` \| `error`). It accepts the llama.cpp,
  Jina/Cohere, and TEI response shapes.
- `decision_engine.ts`: `rank(query, candidates)` and `classify(query, labels)`. `classify`
  returns `{label, confidence, margin, scores}`.
- `decision_log.ts`: a local-only SQLite table `agent_decision_log` (no-op on Postgres).
  It also provides `summarizeDecisions()`.
- Route: `GET /agent-decisions` (recent entries + per-feature stats). Local-only, like
  `/agent-memory`.

## Features

1. **Memory ranking** (`memory_retrieval.ts`)
   - Widen the candidate pool: FTS topN×4 plus the Engraph rank-only hits that are
     dropped today. The owner and active gates stay as they are.
   - The reranker score (≥ `MEMORY_MIN_SCORE`) replaces the lexical-overlap gate. The
     2-item / 1200-char / ~300-token caps stay.
   - Shadow mode logs would-inject vs injected.
2. **Tool ranking** (ws_gateway / agent_runner allowlist pipeline)
   - Rank the authorised MCP servers (text = server name + known tool ids) against the
     prompt.
   - `on`: reorder `servers[]`/`tools[]` by relevance (so the Gemini cap keeps the
     relevant ones), and move low-scoring servers beyond the top K into `deferredServers`.
     Deferred servers stay granted via `mcp_dispatch`, so nothing is ever revoked.
3. **Model routing** (ws_gateway:548 seam; agent_runner when there is no taskKind/override)
   - Classify the prompt into `cheap` \| `standard` \| `frontier` using tier descriptions.
   - Apply only when `requestedSource` is `agent_default`/`agent_config` (pins and
     overrides always win) and confidence ≥ the minimum.
   - Map the tier via `resolveTieredModel({agentId, explicitTierHint})`.

## Evaluation

`apps/api_server/scripts/decision_bench.ts` runs a labelled fixture set for each feature
against the live local server. It reports accuracy, ECE (calibration), and p50/p95
latency. Run it on the Mac once llama-server is up.
