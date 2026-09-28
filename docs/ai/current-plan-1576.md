---
date: 2026-09-24
repo: rhythm
branch: mega/2026-09-18-mobile-electron-hermes
base: e93eac6e
issues: [1576]
related: [1578 (prompt endpoint, blocked — not a dependency), 1108, 1322, 930, 632]
status: planning (design gate — awaiting Astra review before GPT-6 Sol coding)
tags: [plan, rhythm, provenance, model-routing, opencode-fork]
---

# Plan — #1576 Routed model aliases lose provenance

## Goal

Record, for every assistant step, the model that actually served it and the
upstream response/generation id. Capture both at the engine boundary. Keep
alongside them what Rhythm requested and how that request was resolved (per-turn
override, tier downgrade, fallback hop, unavailable route). Then show the result
to reviewers in the API, the MCP delegation status and the Electron Inspector.

## Constraints

- This is planning only. No product code in this pass. Astra reviews next, then GPT-6 Sol codes.
- Plan against mega `e93eac6e`. Do not depend on #1578. Neither
  `POST /agent-sessions/:id/prompt` nor `agent_prompt_injections` exists on mega
  (checked with grep). The design has to accept #1578 later without rework.
- Provenance belongs to the engine and api_server. The renderer, a mobile client or
  the model must never be able to say "what ran" (#1322 lesson).
- Changes are additive only: no dropped or rewritten columns and no row rewrites. Existing
  API fields keep their current meaning (`agent_sessions.provider_id/model_id`
  stays "current selection").
- No drift between SQLite and Postgres. `agent_sessions` has column parity locked by
  `live_postgres_bootstrap.test.ts:118` and `skill_schema_parity.test.ts:35`, so
  this plan adds **no** columns to it.
- The engine patch stays minimal. Use the `// Rhythm carried patch (#1576): …` marker and keep
  it rebase-friendly for `git subtree pull`.

## Current state trace (mega `e93eac6e`)

| Stage | Where | What happens today |
|---|---|---|
| Interactive turn resolve | `api_server/src/services/ws_gateway.ts:380,536-546,793` → `agent_model_resolver.ts:361-398 resolveModelForSessionTurn` | Precedence: WS `modelOverride` > session row > agent_configs > agent default. Returns only `ModelRoute {providerID, modelID, variantLabel?}`, so the source and reason are lost. `modelOverride` comes from the renderer unvalidated. #1108 writes it onto the session row (L373-390). The comment at ws_gateway L379 saying "never persisted" is stale. |
| Scheduled/tier resolve | `agent_runner.ts:938-951` → `resolveTieredModel` (`agent_model_resolver.ts:608-677`) | `TieredModelDecision {route, tier(final), downgradedForBudget, overrideApplied, reason}` is only logged. The requested tier appears only inside the `reason` text. `pickRouteAtTier` (L572-580) silently falls back to an **unauthed** route. |
| Dispatch choke point | `opencode_client_service.ts:1663 prompt`, `:1720 promptAsync` (SDK call at `:1692`, `:1758`) | Every dispatch passes through here. Callers: ws_gateway `:874/1062` (bound `promptFn`), `turn_redispatch.ts:559`, `agent_runner.ts:1543`, `agent_delegation_service.ts:363`, `async_delegation_completion_service.ts:214`, `agent_approval_continuation_service.ts:111`. No record of the dispatch is kept. |
| Fallback hop | `turn_redispatch.ts:310-314 persistDecision`, `:318-331 notifyDecision`, `:549-565 redispatchTurn` | The session row is **overwritten** with the hop target. From/to/reason exist only in a transient WS `session.spillover` frame. Hop state lives in in-memory `handoffs`/`retained` maps, which a restart wipes. `revert` discards the failed attempt's messages. |
| Engine request | `opencode_fork/.../session/prompt.ts:2092-2093` | The assistant `modelID = model.id` is always the **requested catalog key**. The wire id is `model.api.id`. |
| Engine stream | `.../session/processor.ts:577-608` (`finish-step`) | Reads `usage`, `providerMetadata` (cache tokens only) and `finishReason`. **Drops `value.response {id, modelId, timestamp}`**. `StepFinishPart` (`message-v2.ts:232-248`) has no field for it. Engine retries (`processor.ts:834-864`) reuse the same assistant message. |
| Where the actual value becomes known | AI SDK `ai@6.0.168` `dist/index.mjs:7251` (default `stepResponse = {id: generateId() /*"aitxt-…"*/, modelId: requested}`), `:7337` (`modelId = chunk.modelId ?? prior`), `:7459` (`finish-step.response`) | `@openrouter/ai-sdk-provider@2.8.1` `dist/index.mjs:3865-3878` emits `response-metadata {id: gen-…}` and `{modelId: chunk.model}` on each chunk. `:4245` puts `providerMetadata.openrouter.provider` on finish. **The actual model and generation id reach `finish-step` and are then discarded.** |
| Persistence | `opencode_stream_bridge.ts:1391-1480` (`upsertPart` verbatim into `parts_json`), `:1576-1587` (`info_json` verbatim), `:1591` `noteUserMessage`, `:1597-1607` `backfillModel` | Any new part field reaches `agent_session_messages.parts_json` automatically. `backfillModel` (`agent_sessions_repository.ts:1034-1041`) fills only when the session row is empty, and it fills with the *requested* key. `message.removed` deletes rows, so a hop revert erases the attempt. |
| UI | web `gateway/sessions.ts:368`, `components/Inspector.tsx:48`, `store.tsx:452-463` (spillover toast ignores `toModel`); Flutter `models/agent_session.dart:115-116`; mobile `lib/opencode/usage.ts:59-63` | Every client shows the session row's selection. Mobile's per-model usage uses the engine's requested key. |
| Forgery surface | `mobile_opencode_operations.generated.ts:57` (`part.update` PATCH allowed through the mobile proxy); engine `handlers/session.ts:623-637 updatePart` | A client can PATCH any part, so it could forge a `step-finish` with fake served data unless the engine refuses to accept that field from clients. |

## Design

### Approaches

| | A. Engine stamps served + api_server ledgers (**recommended**) | B. api_server only | C. Engine owns end to end |
|---|---|---|---|
| Served model / gen id | Fork patch copies `finish-step.response` and the OpenRouter upstream provider onto `StepFinishPart.served` | Not capturable. The gen id never leaves the engine. Can only flag "routed alias, unattributed" | Same as A |
| Requested / reason / hop chain | api_server ledger row per dispatch, written at the choke point | Same ledger | Passed into the engine as prompt metadata and stored on the user message (new fork schema, input and handler) |
| Fork diff | ~30 lines in 3 files | 0 | Roughly 3× A. Touches prompt input and user message schema, so upstream drift gets worse |
| Survives revert / restart / late events | Yes. Append-only api_server copy keyed by part id | Ledger yes, served n/a | Engine rows are deleted by revert |
| Verdict | Answers "what wrote this code" truthfully | Honest but leaves #1576 unfixed. Good as fallback if the fork patch is rejected | Resolution reasons are api_server knowledge. Pushing them into the engine adds surface for no gain |

Rejected: OpenTelemetry spans (`gen_ai.response.model`) plus a collector. Too much new infrastructure for one field. Fields are named to map 1:1 onto the OTel GenAI conventions so that route stays open later.

### Chosen architecture (A)

**1. Engine: served stamp (fork, trust anchor).** In `processor.ts` `finish-step`, add:

```ts
// Rhythm carried patch (#1576): served identity from provider response metadata.
served: {
  modelID: string            // value.response.modelId → gen_ai.response.model (SDK echoes wire id when provider reports none)
  requestModelID: string     // ctx.model.api.id — wire id actually sent → gen_ai.request.model
  responseID?: string        // value.response.id → gen_ai.response.id; OMITTED when it starts with "aitxt-" (SDK-generated, not provider)
  upstreamProvider?: string  // value.providerMetadata?.openrouter?.provider (ponytail: add other aggregators when used)
  at: number                 // value.response.timestamp epoch ms
}
```

The field is optional on `StepFinishPart`. All strings are truncated to 256 characters. In the
HTTP `updatePart` handler (and any other HTTP path that calls `session.updatePart` with a client
payload), a client-supplied `served` is **ignored** and the stored part's
`served` is kept (`session.getPart`). Only the processor can set it.

**2. api_server: two SQLite-only append-mostly tables** (local agent server is the
sole writer, the same convention as `agent_session_messages`, `migrations.ts:2480`):

```sql
CREATE TABLE IF NOT EXISTS agent_turn_dispatches (
  id TEXT PRIMARY KEY,                 -- caller-minted randomUUID, or minted by choke point
  local_session_id TEXT,               -- agent_sessions.id when known
  sdk_session_id TEXT NOT NULL,
  origin TEXT NOT NULL,                -- ws_input|fallback_redispatch|agent_runner|delegation|delegation_completion|approval_continuation|unspecified
  requested_source TEXT NOT NULL,      -- turn_override|session|agent_config|agent_default|tier|fallback_chain|caller
  requested_provider_id TEXT, requested_model_id TEXT, requested_tier TEXT,
  dispatched_provider_id TEXT, dispatched_model_id TEXT,   -- exactly the `model` arg sent; NULL = engine default
  reason TEXT,                         -- resolver/downgrade/hop explanation
  supersedes_dispatch_id TEXT,         -- set on a fallback hop
  status TEXT NOT NULL DEFAULT 'pending',  -- pending → sent | rejected
  sdk_user_message_id TEXT,            -- linked from the engine's user message.updated
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_atd_sdk_session ON agent_turn_dispatches(sdk_session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_atd_local_session ON agent_turn_dispatches(local_session_id);

CREATE TABLE IF NOT EXISTS agent_served_steps (
  part_id TEXT PRIMARY KEY,            -- engine step-finish part id → INSERT OR IGNORE = idempotent under late/duplicate events
  local_session_id TEXT NOT NULL,
  sdk_message_id TEXT NOT NULL,        -- assistant message
  sdk_parent_message_id TEXT,          -- assistant info.parentID (user msg) from the stored info_json; NULL if not yet known
  served_model_id TEXT NOT NULL, request_model_id TEXT, response_id TEXT, upstream_provider TEXT,
  served_at INTEGER, recorded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ass_session ON agent_served_steps(local_session_id);
```

Neither table has an FK or a cascade. Hard-deleting a session leaves these rows in place. They hold model ids only, with no content.
Every repository method returns early or empty under `env.dbClient === 'postgres'`.

**3. Write path (one choke point, three hooks):**
- `OpencodeClientService.prompt/promptAsync` get an optional trailing
  `provenance?: DispatchProvenance` parameter. After `beforeDispatch` succeeds and **before**
  the SDK call, insert a `pending` row with `dispatched_* =` the actual `model` argument.
  After the call, set it to `sent` or `rejected` (this covers the #632 silent no-op). Callers that
  pass nothing still get a row (`origin='unspecified'`, `requested_source='caller'`).
- The bridge `message.updated`, when `role==='user'` (next to `noteUserMessage` at `:1591`), links the
  **oldest** row for that sdk session that has `sdk_user_message_id IS NULL AND status!='rejected'`,
  was created within 60 s, and whose `dispatched_*` equals `info.model` (or `dispatched_*` is NULL).
  If the message id is already linked, skip it (idempotent).
- The bridge `message.part.updated`, when `part.type==='step-finish' && part.served`: validate that
  `served.modelID` matches `^[A-Za-z0-9._:/@+-]{1,200}$`. Anything else is stored as the literal `"<unrecognized>"`.
  Then `INSERT OR IGNORE` into `agent_served_steps`, taking the parent from the stored assistant `info_json.parentID`.

**4. Resolution plumbing (callers say *why*; the choke point records *what was sent*):**
- `resolveModelForSessionTurnWithSource(opts) → {route, source} | undefined` holds the
  existing precedence. `resolveModelForSessionTurn` becomes a one-line wrapper,
  so its signature and the #1108 test stay the same.
- `TieredModelDecision` gains `requestedTier: ModelTier` (pre-downgrade) and
  `routeAuthed: boolean`. The `reason` text also gets "no authed route at tier X".
- `ws_gateway` passes `{origin:'ws_input', requested:{source, providerId, modelId}}`, mints
  `dispatchId` and keeps it in `RetainedTurn`. `redispatchTurn` passes
  `{origin:'fallback_redispatch', requested:{source:'fallback_chain', tier: st.currentTierId}, reason:\`${errorClass}_cross_provider from ${from}\`, supersedesDispatchId: turn.dispatchId}`.
  After that it updates `turn.dispatchId`. `agent_runner` passes the tier decision. The delegation, completion
  and approval-continuation callers pass their `origin`. **Origin never comes from a WS frame.**
- #1578 fit: when it lands, its shim adds `origin:'prompt_api'` through a server-side
  parameter (never from the frame). No other change is needed.

**5. Read path (computed on read, nothing stored at session level):**
`GET /agent-sessions/:id/model-provenance` returns:

```ts
{
  sessionId: string
  selection: { providerId: string|null; modelId: string|null }   // agent_sessions row = current selection, not provenance
  servedModels: string[]                                           // distinct, first-seen order
  multiModel: boolean                                              // servedModels.length > 1
  steps: { attributed: number; unattributed: number }             // unattributed = step-finish parts in parts_json with no `served` (pre-#1576 history / unpatched engine)
  dispatches: Array<{
    id; origin; createdAt; status: 'pending'|'sent'|'rejected'
    requested: { source; providerId|null; modelId|null; tier|null }
    dispatched: { providerId; modelId } | null
    reason: string|null; supersedesId: string|null; sdkUserMessageId: string|null
    served: Array<{ modelId; upstreamProviders: string[]; steps: number; responseIds: string[] /* cap 200, ponytail */ }>
    routed: boolean                                                // any served.modelId !== served.requestModelId
  }>
  unlinkedServed: Array<{ modelId; steps }>                        // served steps with no dispatch link (mobile proxy, compaction edge, pre-ledger)
}
```

`getDelegationStatus` (`async_delegation_status_service.ts:70`) gets one additive field,
`servedModels: string[]`, on each `DelegationStatusView`. `rhythm_delegation_status`
passes it through verbatim. No mcp_server change and no tool-count change.

**6. Error handling.** Every ledger or served write is wrapped in try/catch and logged. A
provenance write can **never** block or fail a dispatch (the dispatch path is load-bearing
for 10–15 daily users). The one exception is the pre-dispatch insert: it is also non-fatal, but it is logged at `error`.

**Compatibility.** Existing fields and frames are unchanged. `backfillModel`'s comment ("actual model")
gets corrected to "requested catalog key". Its behavior stays the same. Older engines without `served`
show up as `steps.unattributed`. There is no backfill: history captured before #1576 cannot be
reconstructed (the gen ids were never kept). That includes the two sessions named in the issue.
The truthful display for them is "unattributed".

### User journeys

| Job | Entry point | Visible success | Slice |
|---|---|---|---|
| Reviewer asks what wrote a run | Electron → Agents → session → Inspector | "Served by" lists the concrete models (for example `meta-llama/…:free · Chutes · 36 steps`). A "Routed" chip appears when it differs from the requested model. "Spanned N models" appears when there is more than one | S5 |
| Reviewer sees why the model changed | Same Inspector, "Dispatch history" disclosure | Each dispatch shows origin, requested (source/tier), dispatched and reason, with fallback hops linked | S5 |
| Orchestrator agent attributes a child's quality | MCP `rhythm_delegation_status` | Each delegation carries `servedModels` | S4 |

The Flutter Inspector parity is **deferred** (Open question 1). No job is removed: the Electron path covers the reviewer job.

## File structure map

| File | Responsibility |
|---|---|
| `apps/opencode_fork/packages/opencode/src/session/message-v2.ts` | Optional `served` struct on `StepFinishPart` |
| `apps/opencode_fork/packages/opencode/src/session/processor.ts` | Stamp `served` in `finish-step` |
| `apps/opencode_fork/packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` | `updatePart`: ignore client `served`, keep the stored one |
| `apps/opencode_fork/packages/opencode/test/session/served-provenance.test.ts` (new) | Engine unit tests |
| `apps/api_server/src/models/model_provenance.ts` (new) | `DispatchProvenance`, origin/source unions, `ModelProvenanceView` |
| `apps/api_server/src/database/migrations.ts` | Both `CREATE TABLE IF NOT EXISTS` blocks, commented SQLite-only |
| `apps/api_server/src/repositories/model_provenance_repository.ts` (new) | insert/settle/link dispatch, insert served step, projection queries, Postgres no-op |
| `apps/api_server/src/services/opencode_client_service.ts` | Choke-point write in `prompt`/`promptAsync` |
| `apps/api_server/src/services/opencode_stream_bridge.ts` | User-message link and served-step insert |
| `apps/api_server/src/services/agent_model_resolver.ts` | `resolveModelForSessionTurnWithSource`; `requestedTier`/`routeAuthed` |
| `apps/api_server/src/services/ws_gateway.ts` | Pass provenance, mint and retain `dispatchId`, fix stale comment |
| `apps/api_server/src/services/turn_redispatch.ts` | `RetainedTurn.dispatchId`; hop provenance |
| `apps/api_server/src/services/agent_runner.ts`, `agent_delegation_service.ts`, `async_delegation_completion_service.ts`, `agent_approval_continuation_service.ts` | Pass `origin` (and the tier decision in agent_runner) |
| `apps/api_server/src/services/model_provenance_service.ts` (new) | Build `ModelProvenanceView` (validation, distinct, caps) |
| `apps/api_server/src/controllers/agent_sessions_controller.ts`, `routes/agent_sessions_routes.ts` | `GET /:id/model-provenance` |
| `apps/api_server/src/services/async_delegation_status_service.ts` | `servedModels` on `DelegationStatusView` |
| `apps/web/src/gateway/inspector.ts`, `src/components/Inspector.tsx`, `src/endpointMap.ts` | `modelProvenance(id)`, `LiveModelProvenance` section (same pattern as `LiveProvenance`), endpoint contract entry (`flutterSource: 'none — Electron-first (#1576)'`) |
| `apps/api_server/src/__tests__/issue_1576_*.test.ts` (new) | Unit and contract tests, plus the live E2E |

## External dependency check

- Confirmed in installed dist files: `ai@6.0.168` puts `response.{id,modelId,timestamp}` on `finish-step`. The
  defaults are an SDK-generated `aitxt-…` id and the requested wire model id. The provider's `response-metadata` overrides both.
  `@openrouter/ai-sdk-provider@2.8.1` emits the OpenRouter chunk `id` (gen-…) and `model` on every chunk
  (last one wins), and `providerMetadata.openrouter.provider`.
- OpenRouter docs (https://openrouter.ai/docs/api-reference/overview): the top-level `model` is the model
  that ended up serving the request, and `id` is the generation id for `GET /api/v1/generation`.
  **UNVERIFIED:** that `openrouter/free` specifically returns a concrete underlying `model` (and not the alias) on the live stream. The cheapest probe is the first step of S1 (below).
  **UNVERIFIED:** `provider` in the response is not in the documented schema, but the provider package reads it.
- `GET /api/v1/generation` enrichment (cost, `provider_name`) is **out of scope**. Its availability
  delay is undocumented. The stored `responseID` keeps that enrichment possible later.
- OTel GenAI semconv (github.com/open-telemetry/semantic-conventions `docs/registry/attributes/gen-ai.md`):
  `request.model` / `response.model` / `response.id` map to `requestModelID` / `modelID` / `responseID`.

## GitNexus impact (mega index `.mega-wt/integration`, 1 commit behind)

| Symbol | Reported | Grep-verified reality |
|---|---|---|
| `OpencodeClientService.promptAsync` | LOW, 3 direct (approval continuation, async completion, delegateToAgentAsync) | Also ws_gateway via `.bind` (`:874`) and turn_redispatch deps (`:559`), which the graph misses |
| `OpencodeClientService.prompt` | LOW, 1 direct | agent_runner `:1543` |
| `resolveTieredModel`, `handleInputFrame`, `redispatchTurn`, `retainTurn`, processor `handleEvent` | 0 callers | Under-resolved. The real callers are agent_runner `:941`, ws_gateway `:1130`, turn_redispatch `:335`, ws_gateway `:1028`, and the processor stream loop |
| `getDelegationStatus` | LOW, 2 direct | controller `status` plus a repository |

All signature changes are additive: optional trailing params, optional fields, and a new wrapper function.
Risk is **MEDIUM** despite the LOW reports, because the dispatch path carries every turn. The mitigation is the rule
that provenance writes are non-fatal, plus the live gate.

## Doubt review

What would make this wrong:
1. For routers, OpenRouter's stream `model` might echo the alias.
2. HttpApi history reads might re-encode parts and strip `served`. It is declared in the schema, so it should survive, but verify on `GET /session/:id/message`.
3. The FIFO user-message link could mislink when two dispatches to one session interleave. Model match plus the 60 s window make this unlikely. The upgrade path is api_server minting the engine `messageID`. That was rejected for now because engine message ordering depends on id sort.
4. The mobile proxy `part.delete` can erase a `step-finish` in the engine. The api_server copy in `agent_served_steps` survives that.

Cheapest probe for #1: before any other coding, send one streamed OpenRouter `openrouter/free` request from the sandbox
engine and log `finish-step.response.modelId` and `id` (never log keys). If the alias comes back
unchanged, stop and escalate: the capture then needs `/generation` lookup by id instead.
Primary sources checked: the installed dist files above and the OpenRouter API overview.

## Issue table

| # | Title | Likely files | Acceptance criteria (falsifiable) | Deps | Required validation |
|---|---|---|---|---|---|
| S1 | Engine: stamp served identity on step-finish; refuse client-forged `served` | fork `message-v2.ts`, `processor.ts`, `handlers/session.ts`, `test/session/served-provenance.test.ts` | (a) A mock model emitting `response-metadata {id:'gen-x', modelId:'vendor/m'}` yields a `step-finish` part with `served.modelID==='vendor/m'`, `responseID==='gen-x'`, `requestModelID===model.api.id`. (b) With no metadata, `served.modelID===model.api.id` and `responseID` is absent (no `aitxt-`). (c) `providerMetadata.openrouter.provider:'Chutes'` gives `upstreamProvider==='Chutes'`. (d) Strings are ≤256 chars. (e) PATCH `part.update` with a forged `served` leaves the stored `served` unchanged (and absent if it was absent). (f) A retry-then-success run produces one assistant message and one served step, carrying the successful attempt's id. (g) `GET /session/:id/message` returns `served` | — (probe first) | `cd apps/opencode_fork/packages/opencode && bun run typecheck && bun test test/session/ src/session/ && bun run build --single` |
| S2 | api_server: ledger and served-step store, choke-point write, link, served insert | `models/model_provenance.ts`, `database/migrations.ts`, `repositories/model_provenance_repository.ts`, `services/opencode_client_service.ts`, `services/opencode_stream_bridge.ts`, `__tests__/issue_1576_ledger.test.ts` | (a) `promptAsync` writes a `pending` row before the SDK call and `sent`/`rejected` after it. A `{}` SDK no-op gives `rejected`. (b) A row is written with `origin='unspecified'` when there is no provenance. (c) A thrown repository error does not change the `promptAsync` return value. (d) A user `message.updated` links the oldest matching row. A second identical event does not re-link. A mismatched `info.model` does not link. (e) A duplicate `step-finish` event yields 1 `agent_served_steps` row. A `message.removed` leaves it intact. (f) A non-charset `modelID` is stored as `"<unrecognized>"`. (g) Under `dbClient='postgres'` every method no-ops, and `live_postgres_bootstrap` / `skill_schema_parity` pass unchanged | — (parallel with S1) | `cd apps/api_server && npx tsc --noEmit && npx vitest run src/__tests__/issue_1576_ledger.test.ts src/__tests__/skill_schema_parity.test.ts src/__tests__/opencode_client_service.test.ts` |
| S3 | Resolution source plumbing (override, tier, fallback, origins) | `agent_model_resolver.ts`, `ws_gateway.ts`, `turn_redispatch.ts`, `agent_runner.ts`, `agent_delegation_service.ts`, `async_delegation_completion_service.ts`, `agent_approval_continuation_service.ts`, `__tests__/issue_1576_resolution.test.ts` | (a) `…WithSource` returns `turn_override`/`session`/`agent_config`/`agent_default` in precedence order. The #1108 test still passes. (b) A budget downgrade gives `requestedTier` ≠ `tier`, and the ledger row shows `requested_tier`=pre-downgrade with a `reason` containing `downgraded`. (c) Unauthed tier fallback gives `routeAuthed=false`, and `reason` contains `no authed route`. (d) A hop row has `origin='fallback_redispatch'`, `supersedes_dispatch_id`= the prior row, and `reason` starting `auth_cross_provider`/`rate_limit_cross_provider`. (e) A WS frame carrying `origin`, `served` or `provenance` keys does not change the stored origin (`ws_input`) or served data | S2 | `npx tsc --noEmit && npx vitest run src/__tests__/issue_1576_resolution.test.ts src/services/__tests__/issue_1108_model_override_persistence.test.ts src/__tests__/agents_ws_e2e.test.ts` plus `npx vitest run src/services/__tests__/turn_redispatch.test.ts src/services/__tests__/turn_redispatch_auth_cascade.test.ts` |
| S4 | Projection API and delegation status | `services/model_provenance_service.ts`, `controllers/agent_sessions_controller.ts`, `routes/agent_sessions_routes.ts`, `services/async_delegation_status_service.ts`, `__tests__/issue_1576_projection.test.ts` | (a) `GET /agent-sessions/:id/model-provenance` returns exactly the `ModelProvenanceView` keys. (b) 2 served models give `multiModel:true`, first-seen order. (c) A step-finish without `served` in `parts_json` counts as `steps.unattributed`. (d) A served step with no dispatch link appears in `unlinkedServed`. (e) `routed` is true iff served ≠ requestModelId. (f) `responseIds` is capped at 200. (g) Unknown session → 404. (h) `rhythm_delegation_status` JSON includes `servedModels` per delegation. (i) Existing `GET /agent-sessions/:id` response is byte-identical | S2 (S3 for full data) | `npx tsc --noEmit && npx vitest run src/__tests__/issue_1576_projection.test.ts` plus `npx vitest run src/__tests__/async_delegation_status.test.ts` |
| S5 | Electron Inspector model provenance | `apps/web/src/gateway/inspector.ts`, `src/components/Inspector.tsx`, `src/endpointMap.ts`, `tests/electron-e25b-inspector.spec.ts` | (a) With a fixture of 2 served models, the Inspector shows "Served by" with both, a "Spanned 2 models" warning and a "Routed" chip. (b) With `servedModels:[]` and `unattributed>0` it shows "Not recorded (N steps before provenance capture)" and invents nothing. (c) Dispatch history lists origin/requested/dispatched/reason, and hops show "replaced …". (d) Refresh re-fetches. (e) Model strings render as text | S4 contract (can build against the type in parallel) | `cd apps/web && npm run typecheck && npx playwright test --config tests/electron-e25b-playwright.config.ts` plus a live sandbox screenshot in S6 |
| S6 | Live routed-turn behavioral gate, sandbox knob forwarding, run log | `apps/api_server/src/__tests__/issue_1576_routed_provenance_live_e2e.test.ts`, `tools/dev/sandbox.sh` (forward 2 optional vars), `tools/dev/sandbox_guard_test.sh`, `docs/ai/runs/<run-date>-issue-1576.md` | Every row of the acceptance matrix below is observed live, or recorded as a named, unmet precondition (never as PASS) | S1–S4 (S5 for screenshot) | See "Live sandbox evidence" |

Parallelism: S1 ∥ S2 (disjoint: fork vs api_server). After S2: S3 ∥ S4 ∥ S5 (disjoint
files; S3 and S4 share only the S2 types). S6 goes last. One PR onto mega is fine. It is
a draft, no merge.

## Acceptance matrix (live, sandbox)

| Case | Setup | Must observe |
|---|---|---|
| L1 Routed alias | WS `session.input` with `modelOverride {openrouter, openrouter/free}` | ≥1 step with `served.modelID` ≠ `openrouter/free` and matching the charset. `responseID` matches `/^gen-/`. Provenance shows `requested.source='turn_override'`, `dispatched.modelId='openrouter/free'`, `routed:true`, and `sdkUserMessageId` = the transcript's user msg id |
| L2 Model override (direct) | Override to `RHYTHM_LIVE_1576_DIRECT_MODEL` (an authed direct provider) on a session whose row has another model | Dispatch `requested.source='turn_override'`. `served.modelID` equals the wire id or its dated variant. `routed:false`. Session row changes to the override (existing #1108 behavior) |
| L3 Fallback hop | Sandbox opencode config copy with an **invalid** key for provider P, and `AGENT_FALLBACK_CHAIN=<P-tier>,openrouter-free` | A `session.spillover` frame arrives. Dispatch A (`ws_input`, dispatched P) plus dispatch B (`fallback_redispatch`, `supersedesId=A`, `reason` starting `auth_cross_provider`, dispatched `openrouter/openrouter/free`). Served models are attributed to B only, and the list is non-empty |
| L4 Unavailable | Override to `openrouter/rhythm-nonexistent-1576` | Dispatch `status='rejected'`, **or** `sent` with an assistant error. Zero served steps attributed to it. No fabricated model |
| L5 Tier downgrade | `AGENT_MODEL_ROUTING_NEAR_BUDGET_FRACTION=0.99` at `sandbox.sh up`. `POST /agent-research` (taskKind `research`, no `RHYTHM_RESEARCH_MODEL`) | Dispatch `origin='agent_runner'`, `requested.source='tier'`, `requested_tier` = policy tier, `reason` contains `downgraded`. **Precondition:** `/agents/usage-budget` shows a numeric `remainingFraction` for the chosen provider. If it doesn't, record `L5 PRECONDITION UNMET` with the snapshot, not PASS |
| L6 Durability, late events | After idle, `tools/dev/sandbox.sh restart`, then GET provenance again | Identical JSON before and after restart (in-memory maps wiped). Re-GET is idempotent |
| L7 Forgery | PATCH a `step-finish` part through `/mobile-gateway/opencode/session/:id/message/:mid/part/:pid` with fake `served` | Stored and projected served data unchanged |

## Live sandbox evidence (commands)

`tools/dev/sandbox.sh` launches the API and engine with `env -i` and a fixed `runtime_env`
allowlist (`sandbox.sh:27-40`, `:490-494`, `:694`). It always runs the **worktree's own**
`apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode` (`:24`). That has two consequences.
First, caller env such as `AGENT_FALLBACK_CHAIN` does **not** reach the sandbox API today. Second, the fork build
must happen in the coding worktree. So S6 includes one small tooling change: `sandbox.sh` appends
`AGENT_FALLBACK_CHAIN` and `AGENT_MODEL_ROUTING_NEAR_BUDGET_FRACTION` to `runtime_env`
**only when set** in the caller's env. Nothing else is forwarded. Add a case to `tools/dev/sandbox_guard_test.sh`.

```bash
# never start an api_server by hand; never touch :4096/:4001
cd apps/opencode_fork/packages/opencode && bun run build --single && cd -
cd apps/api_server && npm run build && cd -
# AGENTS.md (mega) requires all four fixture/path vars; fixture DB + opencode config are read-only,
# under the approved root, outside the sandbox dir; config has a non-empty safe local-command `mcp` map
# and an auth.json with the OpenRouter (and L2 direct-provider) credentials.
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-1576-fixture
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/opencode-config"
export RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-sandbox-1576 RHYTHM_SANDBOX_API_PORT=4298 RHYTHM_SANDBOX_ENGINE_PORT=4297
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
# Pass 1 — L1 L2 L4 L6 L7 (no knobs)
tools/dev/sandbox.sh up
cd apps/api_server && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4298 \
  RHYTHM_LIVE_1576_CASES=L1,L2,L4,L6,L7 \
  npx vitest run src/__tests__/issue_1576_routed_provenance_live_e2e.test.ts --no-file-parallelism; cd -
tools/dev/sandbox.sh down
# Pass 2 — L3 L5. Second config copy under the same root with ONE provider key (google) set to
# "invalid-1576" in ITS auth.json (add the entry if absent). Never print keys; never edit the pass-1 copy or the original.
RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/opencode-config-badgoogle" \
AGENT_FALLBACK_CHAIN=gemini,openrouter-free AGENT_MODEL_ROUTING_NEAR_BUDGET_FRACTION=0.99 \
tools/dev/sandbox.sh up
cd apps/api_server && RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4298 \
  RHYTHM_LIVE_1576_CASES=L3,L5 \
  npx vitest run src/__tests__/issue_1576_routed_provenance_live_e2e.test.ts --no-file-parallelism; cd -
# S5 screenshot: Electron source shell against :4298, Inspector of the L1 and L3 sessions (see docs/ai/testing-guide.md Electron section)
tools/dev/sandbox.sh down
```

Follow the `tools/dev/sandbox_guard_test.sh` rules for the fixture root. The run log
`docs/ai/runs/<run-date>-issue-1576.md` records the exact commands, observed JSON excerpts (model ids and
gen ids, never keys), and any unmet precondition by name.

## Coverage matrix (request → slice → check)

| Requirement | Slice | Falsifiable check |
|---|---|---|
| Trace alias/tier through resolver, turn, engine, persistence, UI | This doc | Trace table with file:line |
| Where actual ids become known / where requested overwrite | This doc | Trace rows "Engine stream", "Fallback hop", "Persistence" |
| Requested selection preserved | S2, S3 | S3(a)(b), L1, L2 |
| Actual resolved provider/model | S1, S2 | S1(a), L1 |
| Fallback/downgrade reason | S3 | S3(b)(c)(d), L3, L5 |
| Generation/run identity | S1, S2, S4 | S1(a)(b), S4(f), L1 `gen-` |
| Retries | S1 | S1(f) |
| Late events | S2 | S2(e), L6 |
| No SQLite/Postgres drift | S2 | S2(g); no `agent_sessions` columns |
| Renderer/model cannot supply provenance | S1, S3 | S1(e), S3(e), L7 |
| Tier downgrade / fallback / override / unavailable live | S6 | L5, L3, L2, L4 |
| #1578 independence | S3 | No reference to `agent_prompt_injections`; `origin` union extendable |

## Open questions (AFK safe defaults applied)

1. Flutter Inspector parity? **Default: defer.** Electron plus MCP cover the reviewer job, and a follow-up issue would be filed.
2. Block routed aliases for verification-gated runs (issue open question)? **Default: flag, don't block.** `routed:true` and
   `multiModel` are surfaced. Gating is a separate policy decision.
3. Multi-model warning? **Default: yes**, Inspector "Spanned N models" (S5).
4. Delete ledger rows on session hard-delete? **Default: keep.** They hold ids only, no content.
5. Mobile per-model usage (`usage.ts:59`) and research stage attribution (`agent_research_repository.ts:474`) still
   use the requested key. **Default: out of scope**, follow-up.
6. Validate the WS `modelOverride` against the catalog/auth list the way PATCH does? **Default: out of scope.** It is recorded
   truthfully as `turn_override`. File a follow-up.
7. **Fork edit authorization.** AGENTS.md says to edit `apps/opencode_fork` "only when working the
   `mcp-scope-*` issues". Other `Rhythm carried patch` markers (#775, #1094) show that rule is stale in practice,
   but it has not been formally lifted. **Default: Astra's review must explicitly approve S1.** If S1 is refused,
   ship S2–S5 as Approach B: served stays empty, `steps.unattributed` counts every routed step, and the Inspector says
   "Not recorded". That is truthful, but #1576 stays open.

## Handoff

Planning produced large exploration output. The coding dispatch should start from this file alone
(`/compact` or a fresh session). Astra review gate: the Design section, the doubt review and Open question 7.
S1's probe runs before any code. Draft PR onto mega only. No merge.
