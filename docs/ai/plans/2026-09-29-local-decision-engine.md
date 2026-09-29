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

## Addendum: Auto (router) model mode for sessions

The user asked for the model picker to offer **Auto (router)** as the default, so new sessions go through the router.

### Contract

- **Session field `modelMode: 'auto' | 'fixed'`.**
  - Storage: `agent_sessions.model_mode`, on SQLite and on Postgres (via `postgres_bootstrap`).
  - The column default is `'fixed'`, so existing rows keep their behaviour.
  - New sessions are inserted with `'auto'` unless the create body sends `modelMode: 'fixed'`.
  - The field appears in every session payload.
- **Session create (POST) and PATCH** accept `modelMode`.
  - PATCH `{modelMode: 'fixed', providerId, modelId}` pins a model.
  - PATCH `{modelMode: 'auto'}` returns the session to the router. The stored `providerId`/`modelId` are kept as the fallback.
- **The WS `session.input` frame** may carry `modelMode` (`'auto'` or `'fixed'`).
  - When the session is auto, a `modelOverride` that equals the session's stored model or the profile default is an echo. It is soft and does not pin anything.
  - A different model is an explicit choice. It applies to that turn only, unless the client PATCHes `fixed`.
  - Frames sent without a `modelOverride` resolve normally: stored session model, else profile, else agent default.
- **Resolver.** Auto sessions return `requestedSource: 'auto'`. The baseline route is the session model, else the profile model, else the agent default.
- **What auto enables.** Auto sessions turn on `model_routing` and `capacity_routing`, whatever the unset environment says.
  - If an env var is explicitly set to `off` or `shadow`, that still wins, so it works as a kill switch.
  - `fixed` sessions keep the current behaviour.
- **Router fallback.** If the router fails or its confidence is low, the baseline route is used. A reranker server that isn't running gets a connection-refused on loopback, which costs about 1 ms.
- **First-input check.** The "Pick a model before sending the first message" guard is satisfied by auto mode.
- **Clients (the Electron/web Composer and the Flutter picker):**
  - The model picker shows **"Auto (router)"** first, selected by default on new sessions.
  - While the session is auto, a turn sends no `modelOverride` unless the user staged a turn-only model.
  - Picking a specific model and choosing "session" scope PATCHes `fixed`.
  - The UI shows which model the router picked, when the session payload or provenance exposes it.

## Addendum: Router backend settings (local / Jev / custom)

The user asked for Providers settings in both Electron and mobile, where they choose the router model:

- a **local** reranker;
- **Jev** through its API;
- a **custom** server, for example a model on another computer on the network.

### Storage

- A JSON file sits beside the other Rhythm app-support stores, with mode 0600.
- API keys are write-only: GET returns `hasApiKey`, never the key.
- Precedence: an explicitly set env var, then the saved settings, then the defaults.

### API (local-only, inside the agent-execution gate, like `/agent-decisions`)

**`GET /agent-decisions/config` returns:**

```
{
  backend: 'local'|'jev'|'custom',
  local:  { baseUrl, model, scoreScale },                    // loopback only
  jev:    { baseUrl: 'https://api.typesafe.ai', model: 'jev-latest', hasApiKey },
  custom: { baseUrl, model, scoreScale, hasApiKey },         // loopback, RFC1918/LAN http, or public https
  timeoutMs,
  remoteDataConsent: boolean,                                // required before jev/custom-remote are used
  features: { model_routing, tool_ranking, memory_ranking, capacity_routing: 'default'|'off'|'shadow'|'on' },
  lockedByEnv: string[],                                     // setting keys pinned by env vars (UI shows them read-only)
  effective: { backend, baseUrl, model, features: {…effective mode for fixed sessions…} }
}
```

**`PUT /agent-decisions/config`**

- Takes a partial body of the same shape, plus a write-only `jev.apiKey` / `custom.apiKey`. An empty string clears the key.
- 400 `{error, message}` codes: `invalid_url`, `consent_required`, `invalid_mode`, and so on.
- Returns the GET shape.

**`POST /agent-decisions/config/test`**

- Takes an optional unsaved draft, merged over the saved settings.
- Runs a three-document sample rerank.
- Returns `{ok, backend, model, latencyMs, ranked:[{text, score}], message?}`.

**Mobile** reaches the same three operations under `/mobile-gateway/tools/agent-decisions/...`. They are listed in `MOBILE_TOOL_OPERATIONS` with the `mac-global-admin` policy.

### Jev adapter

- `POST {baseUrl}/v1/systemone` with a Bearer key.
- The request is `{model, state: <query>, questions}`. Each candidate becomes one Choice question: `{type:'choice', instructions:'Is this relevant to / does this describe the request? <candidate>', criteria:{yes:'relevant', no:'not relevant'}}`.
- The score is `answers[q].probabilities.yes`.
- Questions are batched in chunks (default 32).
