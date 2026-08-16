# Phase 2 identity and ownership inventory

Date: 2026-08-15  
Flutter reference: `origin/main` at `9fa2761ed78159f83f56982c03fcd85dc035039a`  
Parity provenance root: `0b2d3b22d0b9f75ea5b4c0a6962a24751637adf789f3d51b8944c07e418541a4`

This inventory was built because `profiles-providers-models` and `ownership-isolation` each have zero parity mappings. Flutter citations below are from `git show origin/main:<path>`; every other citation is from this checkout as observed on 2026-08-15. “Unevidenced” means there is no automated check of the stated behavior today, or an existing check exercises only a fixture and therefore cannot prove the live boundary.

## Canonical vocabulary

The profile is an `agent_configs` row. Its stable identity is `id`, exposed unchanged by the API. The canonical persisted profile model fields are:

```ts
// API model / JSON response
modelProvider: string | null;
modelId: string | null;

// SQLite/Postgres columns
model_provider TEXT NULL
model_id TEXT NULL
```

The declarations are in `apps/api_server/src/repositories/agent_configs_repository.ts:4-29,167-190`; the migrations add the two nullable columns at `apps/api_server/src/database/migrations.ts:2099-2108`, and the Postgres bootstrap does the same at `apps/api_server/src/database/postgres_bootstrap.ts:1370-1375`. The row mapper proves that DB `model_provider`/`model_id` become API `modelProvider`/`modelId` at `apps/api_server/src/repositories/agent_configs_repository.ts:268-303`.

Flutter consumes and emits exactly those camel-case API keys (`modelProvider`, `modelId`) at `origin/main@9fa2761:apps/desktop_flutter/lib/features/agent_configs/models/agent_config.dart:36-66,104-111,205-232`. Flutter displays the pair as `provider / modelId`, but that combined string is presentation only (`origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart:1336-1351`).

A real HTTP response shape is asserted by the existing live API/engine lifecycle test after PATCHing a real profile:

```json
{"modelProvider":"lmstudio","modelId":"qwen/qwen3-coder-30b"}
```

See `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:272-301`. This is not the React `Profile.provider`/`Profile.model` display shape. React currently maps multiple guessed spellings and falls back to display strings at `apps/web/src/gateway/sessions.ts:85-87`; its component type declares `provider` and `model` at `apps/web/src/types.ts:113-130`, and `Profiles.tsx` offers labels such as `OpenAI` and `gpt-5.6` at `apps/web/src/components/Profiles.tsx:41-46`. Those are not canonical persisted profile field names or guaranteed provider/model IDs.

Identity layers must remain distinct:

| Identity | Canonical shape | Evidence |
|---|---|---|
| Rhythm profile ID | `agent_configs.id`; API/session input `profileId` | `apps/api_server/src/repositories/agent_configs_repository.ts:4-6`; `apps/web/src/gateway/sessions.ts:20-27,95-110` |
| Local Rhythm session ID | `agent_sessions.id`; API response `id` | `apps/api_server/src/repositories/agent_sessions_repository.ts:21-31`; `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:323-330` |
| SDK/engine session ID | DB `sdk_session_id`; API response `sdkSessionId` (legacy `sessionToken` fallback still read by the test/client) | `apps/api_server/src/repositories/agent_sessions_repository.ts:29-36`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/models/agent_session.dart:139-143,197-204`; `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:323-330` |
| Persisted session route | API `providerId`/`modelId`; DB `provider_id`/`model_id` | `apps/api_server/src/repositories/agent_sessions_repository.ts:34-36,105-112`; `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/models/agent_session.dart:168-205` |
| Engine model reference | `{ providerID, modelID }` | `apps/api_server/src/services/agent_profile_scope.ts:36-39`; `apps/opencode_fork/packages/opencode/src/session/prompt.ts:2387-2396` |
| Fork session model storage | JSON `{ id, providerID, variant? }` | `apps/opencode_fork/packages/opencode/src/session/session.sql.ts:55-60`; `apps/opencode_fork/packages/opencode/src/session/session.ts:72-88` |

Thus `profileId`, local `id`, and `sdkSessionId` are identifiers for different records. `provider/modelId` is a human-readable combined rendering or agent-frontmatter string, while the engine transport is the two-field object `{providerID, modelID}`.

## Behaviour: `profiles-providers-models`

| # | Surface | Path and lines | What it proves | Automated evidence today |
|---:|---|---|---|---|
| 1 | Flutter profile wire model | `origin/main@9fa2761:apps/desktop_flutter/lib/features/agent_configs/models/agent_config.dart:12-66,69-134,205-232` | Flutter reads/writes the API profile fields, including canonical `modelProvider`/`modelId`, profile identity/policy fields, and JSON-encoded scopes. | Yes: model/picker tests cover parsing and emitted model keys, notably `origin/main@9fa2761:apps/desktop_flutter/test/features/agents/agent_profile_model_picker_test.dart:196-319`. |
| 2 | Flutter profile REST boundary | `origin/main@9fa2761:apps/desktop_flutter/lib/features/agent_configs/data/agent_configs_data_source.dart:9-56`; controller at `.../controllers/agent_configs_controller.dart:83-123` | The shipping client lists, creates, patches, and deletes `/agent-configs`, then replaces local state with the API response. | Partial: controller/data-source fakes exist, but no cited Flutter test drives a real API restart. |
| 3 | Flutter profile manager/editor | `origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart:100-169,748-760,907-960,1307-1351` | Lists/sorts profiles, preselects a catalog entry by exact provider and model ID, and sends `modelProvider`/`modelId` on both create and edit. | Yes: `origin/main@9fa2761:apps/desktop_flutter/test/features/agents/agent_profile_model_picker_test.dart:166-319`; profile binding is separately checked at `origin/main@9fa2761:apps/desktop_flutter/test/contract/issue_1365_profile_binding_test.dart:9-51`. |
| 4 | API profile HTTP CRUD | `apps/api_server/src/routes/agent_configs_routes.ts:1-27`; `apps/api_server/src/controllers/agent_configs_controller.ts:223-230,305-313,347-414,416-495,634-649` | Defines list/get/create/patch/delete. Create and patch accept canonical `modelProvider`/`modelId`; successful writes project/reload and return the repository model. | Partial: `apps/api_server/src/__tests__/agent_configs_routes.test.ts:49-155` checks authenticated list/get/create and many validation paths. The live lifecycle check proves a canonical model PATCH response (`apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:272-301`). There is no focused restart contract for all CRUD fields. |
| 5 | API persistence | `apps/api_server/src/repositories/agent_configs_repository.ts:4-165,167-202,268-309,325-409,412-519` | This is the source of truth for field names and value shapes. Profiles are persisted globally in `agent_configs`; insert/update map `modelProvider`/`modelId` to nullable `model_provider`/`model_id`. | Yes for repository/sync behavior: `apps/api_server/src/__tests__/agent_profile_sync_hygiene.test.ts:90-101,352-392`. No test proves all profile fields survive a process restart. |
| 6 | API registry sync, projection, and model resolution | `apps/api_server/src/services/agent_profile_sync.ts:439-445,474-499,637-715`; `apps/api_server/src/services/opencode_agent_writer.ts:624-678`; `apps/api_server/src/services/agent_model_resolver.ts:267-327,333-397` | Registry strings are parsed as the first `/` into stored provider plus remaining model ID; profile rows project to frontmatter `model: provider/modelId`; runtime resolution returns `{providerID, modelID}` and may fall back only when canonical stored fields cannot resolve. | Partial: hygiene tests cover importer values; live tests such as `apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:272-351,473-476` cover projection/engine routing. They do not restart the API and then create a new engine session. |
| 7 | API-to-fork session boundary | `apps/api_server/src/services/agent_profile_scope.ts:99-186`; `apps/api_server/src/services/opencode_client_service.ts:1127-1274,1573-1605,1618-1648` | Resolves a profile into the engine model pair and allowlists, creates the SDK session, reloads cached agent config, and sends prompt model as `{providerID, modelID}`. | Partial: existing live lifecycle evidence exercises a real engine and distinct local/SDK IDs (`apps/web/tests/sessions/session-live-lifecycle.live.spec.ts:307-351`), not the required API-restart sequence. |
| 8 | React profile editor and state | `apps/web/src/types.ts:113-130`; `apps/web/src/components/Profiles.tsx:8-22,29-51`; `apps/web/src/store.tsx:345-349` | The UI can list/select/create/edit/duplicate/default/delete fixture profiles, but it uses display-only `provider`/`model`, hard-coded options, invented `isDefault`/`defaultAccount` fields, and in-memory fixture mutations. It does not call live profile CRUD. | **Unevidenced for parity.** `apps/web/tests/inspector-profiles.spec.ts:114-141` checks the fixture workflow only and would pass without the API. |
| 9 | React live profile mapper | `apps/web/src/gateway/index.ts:64-87`; `apps/web/src/gateway/sessions.ts:20-27,85-110` | Live mode carries a bearer token and can GET `/agent-configs`, but `mapProfile` guesses several field spellings, converts canonical IDs to display strings, and exposes no create/patch/delete profile methods. | **Unevidenced.** No focused mapper/round-trip test exists; the lifecycle test calls the API directly for profile PATCH rather than driving `Profiles.tsx`. |
| 10 | React inspector | `apps/web/src/components/Inspector.tsx:20-30` | Resolves a profile by `selected.profileId`, displays the profile's display provider, and displays the session's model. It does not prove the engine pair or canonical profile fields. | **Unevidenced for canonical identity.** Inspector tests exercise fixture text/layout (`apps/web/tests/inspector-profiles.spec.ts:5-112`). |
| 11 | Mobile safe profile catalog and selection | `apps/mobile/providers/services/mobile-gateway-service.ts:87-181`; API producer `apps/api_server/src/routes/mobile_gateway_routes.ts:205-223` | Mobile receives a redacted catalog with `profileId`, `opencodeAgentId`, and defaults `{providerId, modelId,...}`, selects by `profileId`, and patches per-session state with distinct SDK session ID. This is a derived mobile DTO, not the persisted profile JSON vocabulary. | Yes: `apps/api_server/src/__tests__/msp_001_session_profile_live.test.ts:22-99` checks the live catalog/session state shape. |
| 12 | Mobile provider credential/config UI | `apps/mobile/components/settings/provider-config-dialog.tsx:9-109`; `apps/mobile/app/(tabs)/settings.tsx:98-164,308-399,540-579`; `apps/mobile/providers/opencode-provider.tsx:2649-2755` | Provider IDs come from engine discovery. API-key/token prompts live in component state, secret-looking prompt keys are visually masked, auth is sent to engine `client.auth.set({providerID,...})`, and provider enablement updates raw engine config. This configures engine providers; it does not edit a Rhythm profile's `modelProvider`/`modelId`. | **Unevidenced.** No provider-dialog test asserts masking, redaction, error bounding, or absence of credential reflection. |
| 13 | Fork session/model and profile allowlist runtime | `apps/opencode_fork/packages/opencode/src/session/session.sql.ts:16-69`; `apps/opencode_fork/packages/opencode/src/session/session.ts:60-147,205-209,280-290`; `apps/opencode_fork/packages/opencode/src/session/prompt.ts:1251-1326,2028-2169,2387-2396`; allowlist helpers at `.../mcp_allowlist.ts:1-40` and `.../skill_allowlist.ts:1-53` | The fork persists engine session project/workspace/model/allowlists, selects the model using `providerID`/`modelID`, and filters MCP tools/skills per session. It has no Rhythm profile row or `profileId`; profile identity has already been resolved by the API. | Yes for pure allowlist behavior: `.../mcp_allowlist.test.ts:36-111` and `.../skill_allowlist.test.ts:20-63`. Model restart/profile identity is only partially covered by the API/web live lifecycle test. |

## Behaviour: `ownership-isolation`

### Actual ownership model

There is no profile/config ownership model today.

`agent_configs` contains no `owner_user_id`, `workspace_id`, or `project_id` in either its base schema or later profile columns (`apps/api_server/src/database/migrations.ts:975-993,2099-2120`; `apps/api_server/src/database/postgres_bootstrap.ts:1313-1328,1370-1386`). `AgentConfig`, `AgentConfigInput`, and `AgentConfigRow` likewise declare no ownership field (`apps/api_server/src/repositories/agent_configs_repository.ts:4-202`). Repository reads are unqualified global `SELECT *`, and writes qualify only by profile ID (`apps/api_server/src/repositories/agent_configs_repository.ts:325-350,412-519`). Controller list/get/create/patch/delete never consult `req.auth`, a workspace claim, or a project claim (`apps/api_server/src/controllers/agent_configs_controller.ts:223-230,305-313,347-495,634-649`).

Authentication exists, but it is not ownership isolation. Outside local mode the entire router uses `requireAuth` (`apps/api_server/src/routes/agent_configs_routes.ts:1-11`), which verifies a bearer token and attaches `req.auth.user` (`apps/api_server/src/middleware/auth_middleware.ts:76-126`). In local mode that middleware is not registered at all. The only profile endpoints that inspect actor role are the exceptional security-lock/re-enable/audit endpoints, and that is admin authorization, not row ownership (`apps/api_server/src/controllers/agent_configs_controller.ts:115-135,501-575`).

The repository does contain ownership concepts elsewhere, but they do not scope profiles: `agent_sessions.owner_user_id` scopes sessions (`apps/api_server/src/repositories/agent_sessions_repository.ts:21-65`), workspaces and memberships exist for other resources (`apps/api_server/src/database/migrations.ts:761-815`), projects have no owner/workspace column (`apps/api_server/src/repositories/projects_repository.ts:4-15`), and fork sessions carry `project_id`/optional `workspace_id` but no user claim (`apps/opencode_fork/packages/opencode/src/session/session.sql.ts:16-29`).

### What each actor gets today

The result below is the code-path result for ordinary `/agent-configs` list/get/CRUD, not a recommended target policy:

| Actor | Remote/non-local API today | Local `AGENT_LOCAL=true` API today | Enforcement |
|---|---|---|---|
| Owner | `200` full global list/row after valid bearer; may mutate non-preset rows. | Same without requiring a token. | Authenticated only remotely; “owner” is not represented on the row. |
| Same-workspace non-owner | The same `200` full global list/row and same mutation authority as owner. | Same. | **Unenforced.** No workspace claim is read and no profile workspace column exists. |
| Cross-workspace user | The same `200` full global list/row and same mutation authority as owner. | Same. | **Unenforced.** The authenticated `User` has no workspace field (`apps/api_server/src/models/user.ts:1-14`), and membership is never queried by this router. |
| Unauthenticated caller | `401` (`Missing bearer token`) because `requireAuth` is mounted when not local; status comes from `AppError.unauthorized`. | `200`/normal route result because the auth middleware is intentionally absent. | Enforced only in non-local mode; **unenforced by design in local mode**. Citations: `apps/api_server/src/routes/agent_configs_routes.ts:9-11`, `apps/api_server/src/middleware/auth_middleware.ts:89-125`, `apps/api_server/src/errors/app_error.ts:19-21`. |

No current automated test runs the four-actor matrix against `/agent-configs`. `apps/api_server/src/__tests__/agent_configs_routes.test.ts:30-75` proves only that one authenticated user gets the full list. The generic local-auth regression test explicitly documents the local/no-token pattern but does not include `/agent-configs` in its route list (`apps/api_server/src/__tests__/agent_local_auth_bypass.test.ts:22-32,65-91`).

### Ownership surfaces

| # | Surface | Path and lines | What it proves | Automated evidence today |
|---:|---|---|---|---|
| 1 | Flutter local profile client | `origin/main@9fa2761:apps/desktop_flutter/lib/features/agent_configs/data/agent_configs_data_source.dart:9-56` | Shipping Flutter calls the loopback `/agent-configs` routes without auth headers, workspace, or project claims. | **Unevidenced for isolation.** Existing Flutter tests do not model multiple actors. |
| 2 | Profile schema/repository | `apps/api_server/src/repositories/agent_configs_repository.ts:4-202,325-350,353-519`; schema `apps/api_server/src/database/migrations.ts:975-993,2099-2120` | There is no owner/workspace/project column and every query is global or keyed only by profile ID. | **Unevidenced for isolation.** Repository tests cannot express an owner because the schema has none. |
| 3 | Remote/local route gate | `apps/api_server/src/routes/agent_configs_routes.ts:1-27`; `apps/api_server/src/middleware/auth_middleware.ts:76-126` | Non-local callers must authenticate; local callers bypass auth. It does not distinguish authenticated actors. | Partial: authenticated CRUD is tested, but `/agent-configs` has no anonymous or multi-actor matrix test. |
| 4 | Controller authorization | `apps/api_server/src/controllers/agent_configs_controller.ts:223-230,305-313,347-495,634-649`; exceptional admin checks `:115-135,501-575` | Ordinary profile operations ignore `req.auth`; only security lock operations require admin/system remotely. | **Unevidenced for row ownership.** No owner/same-workspace/cross-workspace contract exists. |
| 5 | Mobile profile catalog | `apps/api_server/src/routes/mobile_gateway_routes.ts:205-223`; `apps/api_server/src/services/mobile_project_scope.ts:49-66,213-227`; client `apps/mobile/providers/services/mobile-gateway-service.ts:141-157` | A paired device and valid project ID are required, but the handler then returns `new AgentConfigsRepository().list()` globally. Project validation establishes a valid local project, not profile ownership or membership. | Partial: one-device live catalog is tested (`apps/api_server/src/__tests__/msp_001_session_profile_live.test.ts:22-46`); same/cross-workspace results are not. |
| 6 | Mobile tools profile CRUD | `apps/api_server/src/routes/mobile_tools_routes.ts:241-273` | Device identity is attached and tool policy checked before reusing the same global `agentConfigsRouter`; unlike project-owned tool routes, `/agent-configs` does not mount `requireMobileProjectScope`. | **Unevidenced for isolation.** No two-device/two-workspace profile CRUD test exists. |
| 7 | React live gateway/profile UI | `apps/web/src/gateway/index.ts:64-87`; `apps/web/src/gateway/sessions.ts:95-110`; `apps/web/src/components/Profiles.tsx:8-51` | The live gateway supplies one bearer token, while the profile editor itself remains fixture state and renders a simulated read-only/forbidden state. No ownership claim or server denial drives those states. | **Unevidenced.** Fixture state tests do not prove API authorization or non-disclosure. |
| 8 | Fork project/workspace session isolation | `apps/opencode_fork/packages/opencode/src/session/session.sql.ts:16-29,65-69`; `apps/opencode_fork/packages/opencode/src/session/session.ts:60-88,320-329` | Engine sessions can be grouped by project/workspace, but have no user ID and no Rhythm `profileId`. This cannot enforce profile ownership. | **Unevidenced for profile ownership.** Fork allowlist tests cover capability isolation, not actor ownership. |

## Evidence gaps that become Phase 2 work

Nine inventory entries are unevidenced for the behavior claimed: React live profile CRUD/mapping/inspector identity (3), mobile provider-secret UI (1), and actor/profile ownership across Flutter, API repository/controller, mobile CRUD, React, and fork boundaries (5; the API schema/controller are one combined ownership gap for this count).

The following decisions are required before the ownership acceptance can become executable:

1. Is a profile owned by a user, workspace, project, or a deliberate combination, and which persisted columns/FKs represent that scope?
2. What access should a same-workspace non-owner have: list/get only, edit, or non-disclosing denial?
3. Should a cross-workspace profile return `404` (non-disclosing) or `403`, for both item and collection operations?
4. Is the local anonymous bypass an explicit permanent exception, or must packaged React/Electron authenticate even to the loopback service?
5. How does a project map to a workspace for profile visibility? Current `projects` rows have neither owner nor workspace.
6. Which provider operations are safe in packaged React/Electron: choose an already-configured provider/model only, or also add/remove credentials? The current React profile surface has no live provider-auth boundary.

