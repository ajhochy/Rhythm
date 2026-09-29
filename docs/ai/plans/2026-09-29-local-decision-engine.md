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
- **What auto enables.** Auto sessions run `model_routing` and `capacity_routing` in `shadow` (log only) when the environment and saved setting are unset. They stay in shadow until validated; set the feature to On in Router settings (or the env var to `on`) to apply decisions.
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

## Addendum: Routing scope and mobile routing through the proxy

### Routing scope (per feature setting `routing.scope`)

- `first_prompt` (default): the router runs on the first prompt of an auto session and persists
  its pick. Later prompts reuse it. This keeps one model per conversation, keeps prompt caches
  warm, and costs one reranker call per session.
- `escalate_only`: the router runs on every prompt but only moves UP a tier, and only at
  confidence ≥ `routing.escalateMinConfidence` (default 0.75). Downgrades never happen
  mid-session.
- `every_prompt`: today's behaviour.
- The capacity layer keeps running on each prompt in all scopes (it reads only the cache).
- Storage: `agent_sessions.router_decided_at TEXT NULL` on SQLite and Postgres. The value is set
  when the router applies a pick (shadow also records a would-have pick in the decision log). The
  pick lands in `providerId`/`modelId` while `modelMode` stays `auto`. Choosing Auto again in the
  picker clears `router_decided_at`, so the next prompt is routed again.
- Exposed in `GET/PUT /agent-decisions/config` as `routing: { scope, escalateMinConfidence }`,
  with the same env precedence (`AGENT_DECISION_ROUTING_SCOPE`, `AGENT_DECISION_ESCALATE_MIN_CONFIDENCE`).

### Mobile: route in the proxy, not the engine

Mobile prompts already pass through the api_server: `/mobile-gateway/opencode/session/{id}/prompt_async`
→ `MobileOpenCodeProxy.forward` → the engine. Routing there needs no engine (fork) change.

- Before forwarding `session.prompt_async`, the proxy resolves the Rhythm session row for the
  SDK session (`reconcileMobileSession` already maps it). If `modelMode === 'auto'`, it applies the
  same scope rules as ws_gateway and rewrites the body's `model: {providerID, modelID}`.
- Body `model` handling: absent → the routed pick, else the stored/profile model, else the engine
  default; equal to the stored/profile model → an echo, replaced by the routed pick; a different
  model → an explicit turn choice, forwarded unchanged.
- Sessions created from mobile default to `auto`, like the desktop.
- Mobile shows the pick via the existing SDK session/message payload (`modelID` on the assistant
  message), so no new endpoint is needed.
- The relay path (`relay_uplink_runtime`) reaches the same proxy, so it inherits this behaviour.

## Addendum: Route among the LIVE model catalog, not a hardcoded table

`ROUTE_FALLBACKS_BY_AGENT` and `classifyRouteTier`'s name substrings are generations stale. The
router and the capacity layer must choose among the models that are actually available now.

### Source of truth

- `opencodeClient.providerSnapshot()` (engine catalog), extended to pass through per model:
  `cost` ({input, output, cacheRead?, cacheWrite?} in USD per 1M tokens), `releaseDate`,
  `family`, `reasoning`, in addition to the existing id/name/status/contextLimit/capabilities.
- **Routable set** = connected providers ∩ `eligibleModel` (not deprecated, text in/out, tool calls)
  ∩ `visibleDirectModelIds` policy ∩ usage-budget `entitledModels` when known ∩ not excluded in
  Router settings. Keyless local providers (ollama, omlx, opencode) are included at zero cost.

### Tiering (derived, not hardcoded)

- By output price (USD / 1M output tokens): `cheap` ≤ `tiers.cheapMaxOutputUsd` (default 6),
  `frontier` ≥ `tiers.frontierMinOutputUsd` (default 25), otherwise `standard`.
- Missing cost → fall back to the name heuristic (`classifyRouteTier`); zero-cost local → cheap.
- Per-model overrides in Router settings win: `tierOverrides: { "provider/model": tier }`.
- Within a tier and provider prefer the newest `releaseDate`; `-1m` / long-context variants are
  used only when the base route already was one.

### Selection

- Router: tier → candidates from the routable set. Prefer the base route's provider (keeps the
  session's account and prompt cache), else the provider with the most usage headroom, else any.
- Capacity: candidates are the routable set, so cross-provider equivalence is by tier band
  (price), not by name. `ROUTE_FALLBACKS_BY_AGENT` is used only when the snapshot is empty
  or the engine is unreachable, and the decision detail records `catalog: 'static'` in that case.
- `GET /agent-decisions/config` returns `catalog: { fetchedAt, models: [{ providerID, modelID,
  name, family, tier, tierSource: 'cost'|'heuristic'|'override', costOutputUsd, costInputUsd,
  releaseDate, contextLimit, excluded }] , tiers: {cheapMaxOutputUsd, frontierMinOutputUsd} }`.
  `PUT` accepts `tiers`, `tierOverrides`, `excludedModels`.
- The calibration script and the bench print expected models from the live catalog when the
  engine is reachable (`--static-catalog` to force the table) and print which catalog was used.

### UI

Router settings (Electron + mobile) show "Models the router chooses among": provider, model,
tier (editable), $/M out, release date, exclude toggle; plus the two tier thresholds.
