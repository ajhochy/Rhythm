# Phase 10 capability inventory — cross-cutting failure-state closure

Reference: Flutter from `origin/main` at `9fa2761ed78159f83f56982c03fcd85dc035039a`.
React, Electron, and API evidence is from the current `codex/react-electron-live-suite` worktree on
2026-08-15. This compares executable capabilities, not test declarations. A fixture state picker,
seeded receipt, endpoint-map row, or test declaration is not a live capability.

## Missing in React/Electron

These are capabilities the shipping Flutter client has and the React/Electron client cannot perform
against the live boundary today.

1. **Load and recover the live Dashboard.** Flutter requests the authenticated
   `/dashboard/summary`, enters a real loading/error state, retains the error, and retries the request
   from the error surface (`origin/main@9fa2761:apps/desktop_flutter/lib/features/dashboard/data/dashboard_data_source.dart:17-31`;
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/dashboard/controllers/dashboard_controller.dart:90-137,198`;
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/dashboard/views/dashboard_view.dart:68-76,98-113`).
   React imports Dashboard fixtures and changes a query-driven surface state; it does not call a
   gateway (`apps/web/src/pages/dashboard/index.tsx:1-21,29-51`). No React Dashboard gateway or live
   recovery implementation found.

2. **Load and recover the live weekly Planner.** Flutter's controller loads the real weekly plan,
   records transport failures, and the view keeps an actionable retry banner
   (`origin/main@9fa2761:apps/desktop_flutter/lib/features/weekly_planner/controllers/weekly_planner_controller.dart:7-71`;
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/weekly_planner/views/weekly_planner_view.dart:78-89,361-366`).
   React imports planner fixtures and synthesizes `GET /weekly-plan` receipts from the selected demo
   state rather than issuing that request (`apps/web/src/pages/planner/index.tsx:1-18,26-46`). No React
   Planner gateway or live recovery implementation found.

3. **Load and recover live Rhythms.** Flutter performs authenticated recurring-rule CRUD and exposes
   controller loading/error plus retry (`origin/main@9fa2761:apps/desktop_flutter/lib/features/rhythms/data/rhythms_data_source.dart:9-120`;
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/rhythms/controllers/rhythms_controller.dart:5-29`;
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/rhythms/views/rhythms_view.dart:62-68`).
   React imports and clones seeded rhythms with query-selected states
   (`apps/web/src/pages/rhythms/index.tsx:1-20,30-36`). No React Rhythms gateway or live recovery
   implementation found.

4. **Load and recover live Projects.** Flutter calls the project-template and project-instance
   boundaries, records failures, and retains an error surface rather than replacing the source with a
   sample (`origin/main@9fa2761:apps/desktop_flutter/lib/features/projects/data/projects_local_data_source.dart:9-128`;
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/projects/controllers/project_template_controller.dart:5-29`;
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/projects/views/projects_view.dart:395-404`).
   React clones seeded templates/instances and has no gateway import
   (`apps/web/src/pages/projects/index.tsx:1-34`). No React Projects gateway or live recovery
   implementation found.

5. **Load, poll, and recover live Messages.** Flutter loads real threads, messages, and users, polls
   every 30 seconds, preserves the previous thread list across a failed refresh, and tries again on the
   next poll (`origin/main@9fa2761:apps/desktop_flutter/lib/features/messages/controllers/messages_controller.dart:25-85,98-151,202-209,245-263`;
   initial loading/empty UI at
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/messages/views/messages_view.dart:92-145`).
   React imports cloned message fixtures; its server-error copy explicitly names the seeded adapter
   (`apps/web/src/pages/messages/index.tsx:1-20,47-52`). No React Messages gateway or live recovery
   implementation found.

6. **Load and recover live Facilities and reservation subresources independently.** Flutter calls
   facilities, reservations, series, and overview endpoints; the main list and overview each have
   independent loading/error/retry behavior
   (`origin/main@9fa2761:apps/desktop_flutter/lib/features/facilities/data/facilities_data_source.dart:12-205`;
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/facilities/views/facilities_view.dart:83-89,1429-1436`).
   React clones seeded facilities and reservations and has no gateway import
   (`apps/web/src/pages/facilities/index.tsx:1-28`). No React Facilities gateway or live recovery
   implementation found.

7. **Load and recover live Automations and dependency failures.** Flutter loads the real rule,
   trigger, action, provider, and integration-account catalogs, then persists rule operations
   (`origin/main@9fa2761:apps/desktop_flutter/lib/features/tasks/data/automation_rules_data_source.dart:43-149,155-215`;
   controller retry at
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/tasks/controllers/automation_rules_controller.dart:10-81`).
   React imports seeded catalogs/rules and encodes three non-canonical route-state literals,
   `catalog-empty`, `invalid-config`, and `provider-error`
   (`apps/web/src/pages/automations/index.tsx:1-31`). No React Automations gateway or live recovery
   implementation found.

8. **Load and recover live Integrations, including reconnect and partial sync.** Flutter loads the
   authenticated account status and performs Google Calendar, Gmail, Planning Center, settings, and
   sync requests; the view renders real load failure with retry
   (`origin/main@9fa2761:apps/desktop_flutter/lib/features/integrations/data/integrations_data_source.dart:12-153`;
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/integrations/views/integrations_view.dart:62-75`).
   React imports account, sync, and partial-failure fixtures and has no gateway import
   (`apps/web/src/pages/integrations/index.tsx:1-33,40-47`). No React Integrations gateway or live
   recovery implementation found.

9. **Retry the live Tool and Profile boundaries.** Flutter's Memory, Deep Research, Schedules,
   Webhooks, Skills, Playbooks, Cookbook, Organization Review, Run Quality, Gmail Signals, Gallery,
   and Settings families each have a real controller/data-source boundary with loading/error state;
   representative declarations span
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/agent_memory/controllers/agent_memory_controller.dart:6`,
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/agent_research/controllers/agent_research_controller.dart:10`,
   `origin/main@9fa2761:apps/desktop_flutter/lib/features/agent_schedules/controllers/agent_schedules_controller.dart:6`,
   and `origin/main@9fa2761:apps/desktop_flutter/lib/features/agent_webhooks/controllers/agent_webhooks_controller.dart:6`.
   React's shared Tool retry increments a counter and changes local state to `ready`; it never calls
   the endpoint printed on screen (`apps/web/src/components/ToolWorkspace.tsx:9-35,42-69`). The test
   confirms only this fixture reset (`apps/web/tests/tool-state-matrix.spec.ts:20-50`). Profiles have a
   live CRUD spine, but their failure retry is also a 240 ms local timer and uses unsupported literals
   (`apps/web/src/components/Profiles.tsx:14-27`). No live React Tool recovery implementation found.

10. **Reconnect the live agent socket and retain bounded outbound work.** Flutter waits for actual
    socket readiness, queues at most 50 frames, reports overflow, reconnects with exponential backoff
    from 250 ms to 30 seconds, and flushes in order
    (`origin/main@9fa2761:apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart:64-99,167-305`).
    React queues only during the first socket's `CONNECTING` state, silently ignores sends after it is
    closed, clears the queue on close, and has no reconnect loop
    (`apps/web/src/gateway/sessions.ts:168-182`). Its visible reconnect behavior is fixture-only
    (`apps/web/src/store.tsx:341-363`).

11. **Supervise the packaged local API/engine process and recover startup.** Flutter locates or reuses
    the API server, starts it as an owned child, waits for readiness, records bounded startup failure,
    retries, and terminates its child on shutdown
    (`origin/main@9fa2761:apps/desktop_flutter/lib/app/core/server/api_server_service.dart:186-314`;
    `origin/main@9fa2761:apps/desktop_flutter/lib/app/core/agents/agent_server_controller.dart:112-149,293-311`).
    Electron imports no child-process primitive and only loads static web assets plus configured remote
    gateway values (`apps/electron/src/main.mjs:1-10,84-94`; `apps/electron/src/preload.cjs:3-22`). No
    React/Electron API/engine ownership, restart, or startup-retry implementation found.

12. **Restore an authenticated session securely after relaunch.** Flutter persists the session token
    in macOS Keychain, migrates the legacy preference only after a successful secure write, validates
    it through `/me`, and uses the same persisted token to seed the supervised relay
    (`origin/main@9fa2761:apps/desktop_flutter/lib/app/core/auth/auth_session_service.dart:54-84,86-112,162-205`).
    React passes the login token only into the current `renderGateway` closure; neither `main.tsx` nor
    the Electron auth bridge persists or restores the returned session
    (`apps/web/src/main.tsx:23-36,50-65`; `apps/electron/src/main.mjs:51-64`;
    `apps/electron/src/preload.cjs:14-22`). No React/Electron authenticated relaunch restoration found.

## Capability families

### Route matrix: what exists versus what is demonstrated

| Family | Flutter reference behavior | React behavior now | Phase 10 consequence |
|---|---|---|---|
| Dashboard | Authenticated summary request, real load/error/retry | Seeded page plus URL state picker | A fixture retry cannot satisfy a live route criterion. |
| Planner | Real weekly-plan load and retained error banner | Seeded week and synthesized receipts | Drive the real route, including a slow and failed response. |
| Tasks | Real REST CRUD; Flutter and React both have a live boundary | React maps 401/403 to `forbidden`, 404 to `unavailable`, other failures to `server-error` (`apps/web/src/pages/tasks/index.tsx:121-153`) | Retain this spine and prove it under faults; do not replace it with fixtures. |
| Rhythms | Real recurring-rule CRUD and retry | Seeded rule state | Add a live domain before its failure states can be true. |
| Projects | Real templates/instances and retained errors | Seeded templates/instances | Add a live domain and isolate collection/detail/mutation failures. |
| Messages | Real thread/message traffic plus repeat polling | Seeded thread state | Add live traffic; preserve drafts and last known data on failure. |
| Facilities | Real facilities/reservations/series with subpanel retry | Seeded facilities/reservations | Prove subresource failure isolation, not only whole-page replacement. |
| Automations | Real rules/catalog/accounts | Seeded catalogs and extra state literals | Map dependency conditions into the seven canonical surface states plus bounded detail. |
| Integrations | Real account status, reconnect, settings, and sync | Seeded account/sync failures | Drive account and partial-sync responses without leaking provider errors. |
| Agents/Profiles | Partial live session/profile gateway | One-shot socket; fixture reconnect and profile failure timer | Complete transport recovery without changing persisted session vocabulary. |
| Tool routes | Flutter controllers call real endpoints | Shared fixture-only ToolFrame | Each route must derive state from its actual live request. |

Only Tasks and Sessions are reachable through React gateway domains. `GatewayDomainContracts` contains
only `tasks` and `sessions`, and `composeGateway` constructs only those domains
(`apps/web/src/gateway/index.ts:3-18,46-86`). The only page-level `useGateway` consumer is Tasks; the
other use is the shared Agents store (`apps/web/src/pages/tasks/index.tsx:8,121-153`;
`apps/web/src/store.tsx:3,100-101`). This is absence evidence, not a line-count inference.

### Startup, offline, reconnect, and relaunch

React does have three useful pieces: invalid requested-live configuration fails closed instead of
mounting fixtures (`apps/web/src/main.tsx:39-47,50-68` and
`apps/web/tests/gateway/invalid-live.spec.ts:3-8`); the environment receipt makes eight bounded health
attempts (`apps/web/src/gateway/context.tsx:18-50`); and the custom `rhythm://app` protocol loads
packaged local assets without a web server (`apps/electron/src/policy.mjs:8-17,45-51`;
`apps/electron/src/main.mjs:84-94,138-168`).

Those pieces do not reconnect the one-shot session socket, do not start/restart the API or engine, and
do not restore an authenticated session. The receipt also displays `Connecting` after its internal
state has become `error`, so a terminal health failure is not exposed as a distinct actionable state
(`apps/web/src/gateway/context.tsx:40-50`).

Flutter is not automatically correct merely because it is the reference. `restoreSession()` clears a
stored token on every validation exception, including a network failure
(`origin/main@9fa2761:apps/desktop_flutter/lib/app/core/auth/auth_session_service.dart:70-82`), so Phase
10 must prove the React persistence policy directly: retain only authorized state, distinguish an
offline validation failure from an invalid token, and never use fixture identity as an offline
substitute.

### Authorization, not-found, and route-state mapping

The canonical React surface-state vocabulary is exactly:

```ts
type ToolSurfaceState =
  | 'ready'
  | 'loading'
  | 'empty'
  | 'server-error'
  | 'forbidden'
  | 'unavailable'
  | 'readonly';
```

Authoritative declaration: `apps/web/src/components/ToolWorkspace.tsx:9`; the same seven literals are
already repeated by the completed page families (for example Dashboard at
`apps/web/src/pages/dashboard/index.tsx:18-21`). Phase 10 criteria and implementations must not invent
`offline`, `retrying`, `success`, `terminal-error`, `not-found`, `unauthorized`, `failure`,
`read-only`, `catalog-empty`, `invalid-config`, or `provider-error` as additional route-state values.
Those conditions map into the seven values and remain distinguishable through bounded copy/actions and
HTTP metadata:

| Boundary condition | Surface state | Required distinction |
|---|---|---|
| Initial request or retry in flight | `loading` | `aria-busy`/live status; prior authorized data may remain visible but inert. |
| Non-empty 2xx result | `ready` | The result must be from the selected live gateway. |
| Empty 2xx collection | `empty` | Empty is not a 404 and does not load sample data. |
| 5xx, malformed response/event, or bounded terminal timeout | `server-error` | Actionable retry and a redacted correlation/status detail only. |
| 401 or 403 | `forbidden` | 401 offers sign-in/session refresh; 403 does not. Copy may distinguish them without adding a state literal. |
| 404, offline/network loss, missing prerequisite, or unavailable health | `unavailable` | A detail lookup may say the item is unavailable; authorization-protected existence remains non-disclosing. |
| Authorized inspection without mutation permission | `readonly` | All mutating controls are disabled; persisted authorization values remain unchanged. |

React currently violates that vocabulary in Profiles (`first-use`, `no-results`, `failure`,
`read-only`, and a hidden `retrying` branch at `apps/web/src/components/Profiles.tsx:14-27`) and
Automations (`catalog-empty`, `invalid-config`, `provider-error` at
`apps/web/src/pages/automations/index.tsx:26-31`). `DemoState` also contains presentation-only values
such as `offline` and `retrying` (`apps/web/src/types.ts:13-25`); those may describe a session fixture,
but they are not route surface-state literals and must never be persisted as one.

### Error envelopes and redaction

The shared middleware correctly returns structured `AppError` responses and redacts unhandled 500s:
`{error:{code,message}}`, with `correlationId` only on an internal error
(`apps/api_server/src/errors/app_error.ts:1-33`;
`apps/api_server/src/middleware/error_handler.ts:73-113`). The mobile gateway branch additionally
avoids URL, headers, body, params, raw error, and stack in the response/log metadata
(`apps/api_server/src/middleware/error_handler.ts:21-69`).

The API is not yet uniformly behind that envelope. Project checkout and session checkout return raw
Git stderr (`apps/api_server/src/controllers/projects_controller.ts:191-199`;
`apps/api_server/src/controllers/agent_sessions_controller.ts:844-850`), the OpenRouter catalog emits
`detail: String(err)` (`apps/api_server/src/routes/opencode_models_routes.ts:75-81`), and the Copilot
device-start route returns `err.message` (`apps/api_server/src/routes/opencode_auth_routes.ts:118-129`).
The renderer also displays raw thrown OAuth and startup messages
(`apps/web/src/gateway/auth.tsx:27-40,50-54`; `apps/web/src/main.tsx:39-46`). Phase 10 must close all of
these boundaries and prove that bearer/session tokens, OAuth codes, API keys, request bodies, stack
traces, raw stderr, absolute paths, and fixture identity never reach visible text or serialized
evidence.

### Electron native/renderer policy

Electron correctly validates `rhythm://app` GET paths, rejects traversal/malformed encoding, resolves
only files below the packaged dist root, and denies navigation, popups, permissions, and downloads
(`apps/electron/src/policy.mjs:8-17,19-51`; `apps/electron/src/main.mjs:87-105,138-168`). The preload
bridge is frozen and narrow, but it still exposes `RHYTHM_LIVE_TOKEN` when that test-only environment
variable is present (`apps/electron/src/preload.cjs:3-22`). Package evidence must prove production
sign-in keeps the bearer out of preload globals/DOM/storage/logs and that reconnect/relaunch do not
weaken these boundaries.

### Existing tests and what they do not prove

- `tool-state-matrix.spec.ts` proves deterministic fixture presentation and accessibility, not live
  calls (`apps/web/tests/tool-state-matrix.spec.ts:20-69`).
- `parity-edge-cases.spec.ts` changes Tool state through the visible selector and observes a fixture
  reset (`apps/web/tests/parity-edge-cases.spec.ts:92-116`).
- `resilience-map-a11y.spec.ts` selects `offline` and other demo states and resets fixtures; it does not
  disconnect a live transport (`apps/web/tests/resilience-map-a11y.spec.ts:6-17`).
- `invalid-live.spec.ts` does prove one important negative: invalid requested-live startup never falls
  back to fixture identity (`apps/web/tests/gateway/invalid-live.spec.ts:3-8`).

Phase 10 evidence therefore needs three separate layers: deterministic fixture state matrices, real
serial API/engine fault injection, and unsigned packaged offline/reconnect/relaunch checks. None may
stand in for another.

## Canonical persisted and transport vocabulary

Surface states are renderer state, not database state. Domain status values below cross an API,
WebSocket, or persistence boundary and must remain byte-for-byte distinct from display strings.

| Concept | Canonical field names and value shape | Authoritative evidence |
|---|---|---|
| Route surface state | `ready | loading | empty | server-error | forbidden | unavailable | readonly` | `apps/web/src/components/ToolWorkspace.tsx:9,27-35` |
| API application error | `AppError(statusCode:number, code:string, message:string)`; codes include `NOT_FOUND`, `BAD_REQUEST`, `UNAUTHORIZED`, `CONFLICT`, `FORBIDDEN`, `INTERNAL_ERROR` | `apps/api_server/src/errors/app_error.ts:1-33` |
| API error response | `{error:{code:string,message:string,correlationId?:string}}`; `correlationId` is emitted for redacted internal errors | `apps/api_server/src/middleware/error_handler.ts:63-69,80-85,96,113` |
| Auth context | `{sessionToken:string,user:User}`; request field `auth?: AuthContext` | `apps/api_server/src/middleware/auth_middleware.ts:76-85` |
| Task status | field `status`; `open | in_progress | waiting_for_reply | done` | `apps/api_server/src/models/task.ts:7-17` |
| Persisted agent-session status | field `status`; `starting | working | idle | resumable | closed | error`; failure detail field `statusMessage:string|null` | `apps/api_server/src/models/agent_session.ts:22,46-61` |
| Transient engine retry event | WebSocket `session.status` uses `status:'retrying'` with `attempt` and `reason`; it is not a persisted `AgentSessionStatus` | `apps/api_server/src/services/opencode_stream_bridge.ts:1534-1554` |
| React session connectivity presentation | field `connectionState?: 'online' | 'offline' | 'unavailable'`; this is not a route-state field | `apps/web/src/types.ts:73-81` |
| Integration storage status | field `status: 'connected' | 'error'`; secrets remain server-only fields `accessToken`, `refreshToken` and must never enter the renderer model | `apps/api_server/src/models/integration_account.ts:6-20` |
| Derived integration status | `{status:'connected'|'needs_reauth'|'error'|'disconnected',needsReauth:boolean}` | `apps/api_server/src/controllers/integrations_status.ts:6-15,45-54` |
| Engine health | `{status:'ready'|'unavailable',message:string,bridgeLive:boolean,websearchConfigured:boolean}` | `apps/api_server/src/services/opencode_health.ts:11-28` |
| Gateway mode and health | `mode:'fixture'|'live'`; health result `{service:'api'|'engine',state:'fixture'|'healthy'}` | `apps/web/src/gateway/index.ts:1-18` |
| Live auth response | `{sessionToken:string,user:AuthUser}`; `AuthUser` fields are `id,name,email,role,isFacilitiesManager?,photoUrl?,emailNotificationsEnabled?,artifactTabIds?` | `apps/web/src/gateway/auth.tsx:3-17` |
| Live artifact visibility/revisions | `visibility:'private'|'shared'|'organization'`; `currentStateRevision:number`; `currentBundleRevision:number`; `declaredCapabilities:string[]` | `origin/main@9fa2761:apps/desktop_flutter/lib/features/live_artifacts/models/live_artifact.dart:1-65` |

## Inventory conclusion

React has a real Tasks boundary, a partial Sessions/Profile boundary, fail-closed invalid-live startup,
local packaged assets, and a useful seven-state UI vocabulary. It does not have the twelve Flutter
capabilities listed first. Most completed route and Tool failure surfaces are demonstrations over
seeded state, so they cannot observe a disconnect, authorization response, malformed payload, restart,
or successful recovery. Phase 10 must add live domains and real recovery before converting the 246
review rows into retained evidence; otherwise the tests would certify the fixture controls that hide
the missing product behavior.
