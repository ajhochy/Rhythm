# Integrations behavior inventory — issue 2009

## Sources and notation

Behavior authority is the read-only Flutter Integrations feature plus the imported AI Import dialog. Citations use these aliases:

- `IV` — `apps/desktop_flutter/lib/features/integrations/views/integrations_view.dart`
- `IC` — `apps/desktop_flutter/lib/features/integrations/controllers/integrations_controller.dart`
- `IR` — `apps/desktop_flutter/lib/features/integrations/repositories/integrations_repository.dart`
- `ID` — `apps/desktop_flutter/lib/features/integrations/data/integrations_data_source.dart`
- `IA` — `apps/desktop_flutter/lib/features/integrations/models/integration_account.dart`
- `GC` — `apps/desktop_flutter/lib/features/integrations/models/google_calendar_settings.dart`
- `GS` — `apps/desktop_flutter/lib/features/integrations/models/gmail_signal.dart`
- `PO` — `apps/desktop_flutter/lib/features/integrations/models/planning_center_task_options.dart`
- `PP` — `apps/desktop_flutter/lib/features/integrations/models/planning_center_task_preferences.dart`
- `AI` — `apps/desktop_flutter/lib/features/imports/views/import_dialog.dart`
- `TC` / `TD` — Tasks controller / data source
- `RC` / `RD` — Rhythms controller / data source
- `PC` / `PD` — Project-template controller / data source
- `AS` — `apps/desktop_flutter/lib/app/core/layout/app_shell.dart`

API disambiguation cites paths relative to `apps/api_server/src/`. The authenticated integration router is mounted at `/integrations`, auth at `/auth`, and import target routers at `/tasks`, `/recurring-rules`, and `/project-templates` (`app.ts:124,129-133`).

## Shipped composition and load flow

Flutter loads after the first frame. It always requests the three account DTOs, then conditionally requests Calendar settings, Gmail signals, and PCO task preferences only for connected accounts. PCO options are lazy-loaded when Choose first opens. A never-synced connected Calendar silently auto-syncs once per controller session (`IV:24-31`; `IC:54-110,225-237`).

The page header shows connected/total account counts, “Auto sync every 30 min,” explanatory manual-sync copy, and Sync all. The body contains exactly three integration cards in order—Google Calendar, Gmail, Planning Center—then the assistant Google consent card and AI Import section (`IV:51-153,1021-1115,1362-1460`). There is no disconnect, revoke, delete-account, Gmail-enable toggle, search, filter, sorting, or per-signal action in this Flutter surface.

## Account status and permission semantics

The API returns one DTO for every provider even when no stored account exists. Derived statuses are `connected`, `needs_reauth`, `error`, and `disconnected`; missing refresh token or minimum provider scope yields `needs_reauth` (`controllers/integrations_controller.ts:15-68`; `controllers/integrations_status.ts:6-54`). The Flutter model derives `connected` only from `status == 'connected'` and retains `needsReauth`, scope, sync support, trigger families, identity, last-sync, and error fields (`IA:19-55`).

Flutter's shared visual chip maps any `errorMessage` to “Needs attention,” connected to “Connected,” and every other state—including `needs_reauth`—to “Not connected” (`IV:224-242,282-333`). Only the Calendar card opts into status-driven actions: `connected` shows Sync Calendar; every other status shows Reconnect Google. Gmail and Planning Center instead always show Connect/Reconnect and additionally show Sync when connected (`IV:81-141,219-222,361-422`).

The redesign must make the API distinctions legible without inventing controls:

- `connected`: Connected, identity when present, last-sync metadata, individual sync enabled.
- `disconnected`: Not connected, Connect enabled, settings/signals explain the connection prerequisite.
- `needs_reauth`: Permission required / expired authorization, Reconnect enabled, individual sync disabled.
- `error`: Needs attention plus the stored error message and Retry/Reconnect as applicable.
- transient `syncing`: the activated sync button is disabled with progress and an announced status.

The permission label is a truthful web clarification of fields Flutter already receives; it does not add a permission-management control. The fixtures should expose all five states deterministically while keeping the default journey fully connected.

## Visible integration control inventory

| Surface/control | Type and precondition | Trigger and visible outcome | Endpoint / payload / simulated status; loading/failure | Flutter evidence |
|---|---|---|---|---|
| Initial account load | Automatic, authenticated page entry | Renders three provider cards, identity/status, connected count | `GET /integrations/accounts` → 200; page loading first, ErrorBanner + Retry on failure | `IV:24-31,49-77`; `IC:54-95`; `ID:18-30` |
| Header Sync all | Button; not already loading/syncing; at least one connected provider | Disables with spinner, syncs every account having an access token, reloads all connected detail surfaces | `POST /integrations/sync-all` → 200, then normal load receipts. Response is `{googleCalendar?,gmail?,planningCenter?,errors[]}`; partial errors still use HTTP 200. Flutter hides the body, so web must show per-provider success/failure and Retry failed | `IV:58-64,1088-1110`; `IC:116-131`; `ID:63-69`; API `services/integrations_service.ts:413-460` |
| Global Retry | ErrorBanner action after a load/sync/save error | Reloads account and connected-provider data | Same conditional GET sequence as load; spinner then ready/error | `IV:65-73`; `IC:54-97` |
| Google Calendar Connect/Reconnect | Button; disconnected, missing permission, expired auth, or error | Shows an explicit fixture OAuth handoff; never launches a process or external URL | Simulated `GET /auth/google/begin?sessionToken=fixture-session` → 302 FIXTURE HANDOFF; no request leaves loopback. Real Flutter invokes OS `open`/`xdg-open` | `IV:81-100,174-177,382-403`; `IC:112-114`; `ID:32-37`; API `controllers/auth_controller.ts:63-113` |
| Sync Calendar | Button; Calendar connected and not syncing | Disables with spinner; success refreshes account/settings/signals/preferences and updates last-sync/result receipt | `POST /integrations/google-calendar/sync` → 200, then normal load receipts. Failure stores account error and page ErrorBanner; Retry is available | `IV:81-100,361-379`; `IC:133-148`; `ID:55-61`; API `services/integrations_service.ts:50-149` |
| Calendar All | Local button; calendars loaded and not saving | Selects every available calendar checkbox; summary changes | `client-side`; no receipt | `IV:611-649` |
| Calendar None | Local button; calendars loaded and not saving | Clears every selected calendar; empty is valid and means no shadow-event sources | `client-side`; no receipt | `IV:626-657`; API `services/integrations_service.ts:622-636` |
| Calendar checkbox | Checkbox per available subscribed calendar; not saving | Toggles its ID and updates “n of m selected”; primary calendar is labelled | `client-side`; no receipt | `IV:675-691`; `GC:1-46` |
| Calendar Save | Button; settings loaded and not saving | Disables with spinner; submits sorted IDs, re-fetches settings, immediately syncs Calendar, refreshes accounts, then announces saved/synced result | `PUT /integrations/google-calendar/preferences {selectedCalendarIds}` → 200; `GET /integrations/google-calendar/settings` → 200; `POST /integrations/google-calendar/sync` → 200; `GET /integrations/accounts` → 200. Error leaves selection inspectable and exposes Retry | `IV:659-670`; `IC:150-169`; `ID:71-92` |
| Gmail Connect/Reconnect | Button; always present in Flutter, label depends on connected boolean | Shows the same normal Google fixture handoff used by Calendar; no real external URL | Simulated `GET /auth/google/begin?sessionToken=fixture-session` → 302 FIXTURE HANDOFF | `IV:103-118`; `IV:406-412`; `ID:32-37` |
| Sync Gmail | Button; Gmail connected and not syncing | Disables with spinner; refreshes data and signals. Failure produces ErrorBanner/account error and Retry | `POST /integrations/gmail/sync` → 200, then normal load receipts | `IV:103-118,361-379`; `IC:172-187`; `ID:106-112`; API `services/integrations_service.ts:152-249` |
| Recent inbox signals | Read-only list; Gmail connected and signals available | Shows unread total, then at most five unique threads in source order, with subject, sender, optional snippet, and unread marker | Initial/refresh `GET /integrations/gmail/signals` → 200. Empty callout instructs connect + sync | `IV:425-558`; `IC:70-73`; `ID:94-104`; `GS:12-36` |
| Planning Center Connect/Reconnect | Button; always present, label depends on connected boolean | Shows a PCO fixture OAuth handoff; no real external URL | Simulated `GET /auth/planning-center/begin?sessionToken=fixture-session` → 302 FIXTURE HANDOFF | `IV:120-141,406-412`; `ID:47-53`; API `controllers/auth_controller.ts:222-270` |
| Sync Planning Center | Button; PCO connected and not syncing | Disables with spinner; refreshes accounts and connected details. Sync emits automation signals/tasks/project candidates server-side, but page only reports deterministic summary | `POST /integrations/planning-center/sync` → 200, then normal load receipts | `IV:120-141,361-379`; `IC:189-204`; `ID:114-120`; API `services/integrations_service.ts:263-410` |
| PCO Choose | Button; PCO connected and not saving | If options are absent, loads them, then opens “Planning Center task filters”; load failure leaves dialog closed and exposes error | First open: `GET /integrations/planning-center/task-options` → 200; subsequent opens are client-side while cached | `IV:133-141,179-196,697-775`; `IC:225-237`; `ID:134-143` |
| PCO team chips | Multi-select; options loaded | Toggles team IDs. Selecting/deselecting teams prunes selected positions no longer available from the selected teams | `client-side`; no receipt | `IV:818-840,885-904,906-940`; `PO:1-55` |
| PCO position chips | Multi-select; options loaded | With no teams selected, shows the union of all positions; otherwise the sorted union for selected teams | `client-side`; no receipt | `IV:843-853,885-904`; `PO:30-55` |
| PCO Clear all | Dialog button | Clears both sets; empty means “no extra restriction,” not invalid | `client-side`; no receipt | `IV:813-815,858-865` |
| PCO Cancel | Dialog button | Closes without saving | `client-side`; no receipt | `IV:866-869` |
| PCO Save | Dialog button | Returns sorted team IDs/position names, closes, disables Choose while saving, then updates the visible summaries | `PUT /integrations/planning-center/task-preferences {teamIds,positionNames}` → 200. Failure exposes error and retains deterministic prior saved summary | `IV:870-880,187-196`; `IC:206-223`; `ID:145-157`; `PP:7-25` |

## Assistant Google consent

The separate “Google tools for the assistant” card grants broader Calendar and Gmail read/send authority for agent actions. Its only control is “Enable Google tools for the assistant,” which starts the same Google begin route with `intent=agent`; the API forces consent and uses `GOOGLE_AGENT_SCOPES` (`IV:1405-1460`; `ID:39-45`; API `controllers/auth_controller.ts:69-86`). The fixture receipt is `GET /auth/google/begin?intent=agent&sessionToken=fixture-session → 302 FIXTURE HANDOFF`. This is not the Gmail metadata connection toggle and must remain visually separate.

## AI Import control and validation inventory

| Surface/control | Trigger and visible outcome | Endpoint / receipt behavior | Flutter evidence |
|---|---|---|---|
| Open Import | Opens the AI Import modal from the Import card | `client-side`; no receipt | `IV:947-1019,1362-1395` |
| Close / Cancel / Escape | Closes without mutation and restores trigger focus in the web adaptation | `client-side`; no receipt | `AI:203-239,246-283,496-580` |
| Copy prompt | Copies the full JSON schema prompt; temporary “Copied!” acknowledgement | `client-side`; fixture clipboard outcome, no external AI contact | `AI:39-113,293-360` |
| Prompt/Paste tabs and Next | Switches between the schema and paste editor | `client-side`; no receipt | `AI:212-234,275-283,496-580` |
| JSON editor | Accepts structured `{tasks,rhythms,projects}`, legacy typed arrays, and markdown-fenced JSON | Empty input: “Paste the JSON first.” Invalid JSON/type: visible `Invalid JSON` error. Object section values must be arrays. Unknown legacy item types are ignored | `AI:115-130,190-200,366-405,419-490` |
| Import | Disables as “Importing…”. Runs tasks first, rhythms second, then each template and its steps. Success closes and announces exact counts or “Nothing to import” | Task: `POST /tasks {title,notes?,scheduledDate?,preferredAgent}` → 201. Rhythm: `POST /recurring-rules {title,frequency,dayOfWeek?,dayOfMonth?,month?}` → 201. Template: `POST /project-templates {name,description?}` → 201. Step: `POST /project-templates/:templateId/steps {title,offsetDays,offsetDescription?,sortOrder,assigneeId}` → 201, followed by `GET /project-templates` → 200 per step because the controller reloads | `AI:115-200`; `TC:41-63`; `TD:26-55`; `RC:67-93`; `RD:39-65`; `PC:35-45,115-139`; `PD:27-69` |

Flutter's create controllers catch errors and do not rethrow, so AI Import can increment counts and claim success even when an underlying create failed (`TC:47-62`; `RC:76-92`; `PC:35-44,123-138`; `AI:138-189`). The fixture contract intentionally requires truthful deterministic partial-failure reporting and Retry remaining work, without duplicating successful records. This corrects a false-success defect; it does not add an import format or external service.

## Route and deep-link inventory

Flutter navigation is index-based: Integrations occupies shell index 8 (`AS:322-346`; source comment `AS:261`). It has no URL or provider deep links. The web contract gives stable URL representation to visible Flutter sections:

- `#/integrations` — canonical page; all sections visible.
- `#/integrations/google-calendar`, `#/integrations/gmail`, and `#/integrations/planning-center` — same page with the named card identified and focused/scroll-targeted.
- `#/integrations/assistant-tools` — same page focused on assistant consent.
- `#/integrations/import` — same page with AI Import dialog open and focus contained.
- Query state follows the path, e.g. `#/integrations/gmail?state=readonly`.

These links do not add data behavior. Unknown subpaths show a recoverable “Integration section not found” state with Back to integrations.

## State inventory and deterministic matrix

Flutter directly models `idle`, `loading`, and `error`. Initial loading replaces the body, while later errors retain existing cards under an ErrorBanner with Retry (`IC:11,54-97`; `IV:65-78,1225-1271`). Disconnected empty Calendar/Gmail/PCO detail areas each explain their connect/sync prerequisite (`IV:442-448,599-605,763-770`). Auth and Google permission gates sit above the page (`AS:835-846,850-944`). Integration routes require authentication (`routes/integrations_routes.ts:8`).

The shared deterministic web matrix is:

- `ready` (default): three connected synthetic accounts, settings/signals/preferences, assistant consent, import, and initial GET receipts.
- `loading`: `page-state-loading` with status semantics; no mutation.
- `empty`: `page-state-empty`, all providers disconnected, visible Connect Google primary escape hatch.
- `server-error`: `page-state-server-error` alert and `page-retry`; Retry changes the hash query to `state=ready` and recovers without reload.
- `forbidden`: `page-state-forbidden` names a valid authenticated Rhythm workspace session as prerequisite.
- `unavailable`: `page-state-unavailable` names the local Rhythm integration service/API prerequisite.
- `readonly`: `page-state-readonly` names integration-management write access, retains account/settings/signal inspection, and natively disables every mutating control through `fieldset[disabled][aria-disabled=true]`.

Provider fixtures additionally cover disconnected, `needs_reauth`, stored error, and transient syncing without conflating them with page-level server failure. Mutation outcome fixtures cover success, provider error, sync-all partial failure, and retry.

## Accessibility and responsive contract

The page has one Integrations `h1`; provider cards are labelled sections; every checkbox/chip/editor has a programmatic label; transient saves/syncs and receipts are polite live regions; errors are alerts. OAuth handoffs and both dialogs trap focus, close on Escape, and restore their trigger. Enabled controls have stable kebab-case `data-testid`s and at least 44px touch targets. Client-only selection, dialog, copy, and navigation controls never receive fake receipts.

At 1440/1024/768/390 CSS px the page must avoid horizontal overflow. Header/card actions wrap, the PCO chip dialog and import editor fit the viewport, and the page survives 200% text, RTL, forced colors, reduced motion, and long CJK/emoji fixture content. Visual translation uses the mineral reference's blue-green surfaces, hairline dividers, restrained turquoise, compact density, Inter, SF Mono receipts, and tokenized dark/light themes (`../rhythm-dashboard-redesign.html:8-74,82-182`).

## Open questions / riskiest ambiguities

1. `sync-all` returns HTTP 200 with `errors[]`, but Flutter discards the body and shows no partial state (`IC:116-131`; API `services/integrations_service.ts:413-460`). The contract surfaces per-provider partial failure and retries only failed providers; confirm this product correction.
2. Only Calendar uses `status` to choose Sync versus Reconnect; Gmail/PCO always expose Connect/Reconnect even while connected (`IV:382-412`). The contract preserves their controls but disables Sync on permission/error states and labels permission explicitly; confirm whether all cards should eventually adopt Calendar's status-driven action model.
3. AI Import controllers swallow individual create failures, allowing false success and potentially partial writes (`AI:138-200`; `TC:47-62`; `RC:76-92`; `PC:35-44,123-138`). The contract reports completed versus failed items and retries remaining items idempotently; confirm whether production Flutter should later receive the same correction.
4. Calendar Save permits an empty selection and then syncs zero calendars. The API explicitly preserves empty as empty (`IV:650-670`; API `services/integrations_service.ts:633-636`). Confirm that “None” is intentional rather than requiring at least one calendar.
5. Flutter's PCO helper says an empty section means no extra restriction, and options derive positions by selected teams (`IV:813-815,885-904`). Confirm that stale saved position names absent from newly fetched options should be pruned on dialog open as well as after a team toggle.
6. The account DTO contains `lastSyncedAt`, `scope`, trigger families, and sync support, but Flutter only renders identity/error/status (`IA:42-55`; `IV:289-333`). The contract displays last sync and a concise permission prerequisite, but leaves trigger families to Automations.
