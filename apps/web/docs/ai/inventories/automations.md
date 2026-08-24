# Automations behavior inventory — issue 2008

## Evidence key and scope

Behavior was traced from the shipping Flutter surface and its API implementation. The Automations UI is one large file; the builder, catalog pickers, conditions, template helpers, preview dialog, and resync control are private widgets/methods in that file rather than separate imports.

- `ARV` — `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/tasks/views/automation_rules_view.dart`
- `ARC` — `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/tasks/controllers/automation_rules_controller.dart`
- `ARR` — `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/tasks/repositories/automation_rules_repository.dart`
- `ARD` — `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/tasks/data/automation_rules_data_source.dart`
- `ACM` — `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/tasks/models/automation_catalog.dart`
- `ARM` — `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/tasks/models/automation_rule.dart`
- `IA` — `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/integrations/models/integration_account.dart`
- `PCO` — `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/integrations/models/planning_center_task_options.dart`
- `FDS` — `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/facilities/data/facilities_data_source.dart`
- API citations are relative to `/Users/ajhochhalter/Documents/Rhythm/apps/api_server/src/`.

The Flutter shell places Automations at navigation index 7 and constructs `AutomationRulesView` there (`app/core/layout/app_shell.dart:322-345`; `app/core/layout/navigation_sidebar.dart:30`). The view loads once after its first frame (`ARV:34-39`). There is no separate rule-builder file, catalog-picker widget, or resync-progress widget to inventory.

## Page structure and deterministic list behavior

The header exposes the title, explanatory copy, New automation, and four read-only statistics: rule count, enabled count, connected-provider count, and latest account sync (or Never) (`ARV:64-73,171-245`). Rules are grouped by `source` and groups are ordered Rhythm, Planning Center, Google Calendar, Gmail, then unknown sources; rules retain the API's within-group order (`ARV:27-32,46-57,88-99`). The API returns owned rules in `created_at ASC` order (`repositories/automation_rules_repository.ts:58-88`).

Important correction to the seed: Flutter has **no rule search input and no list-filter control** anywhere in `AutomationRulesView`. The only deterministic list organization is source grouping plus enabled switches (`ARV:42-106,346-550`). The web contract therefore must not invent list search/filter controls; it verifies source order, rule order, counts, and enabled state.

Each group shows a provider/account label and sync support. A missing account is described as “Internal Rhythm rules,” even for a disconnected external-source rule; a present account displays account/provider and sync mode (`ARV:358-382`). Each card displays rule name, catalog-derived trigger → action labels, account, Connected/Internal/Disconnected, last match count, last evaluation, and a compact sample label when present (`ARV:443-519`). The rule model carries conditions/config/account and execution metadata (`ARM:29-64,73-95`).

## Bootstrap endpoint sequence

`load()` starts loading, clears the current error and preview, then runs eight requests concurrently. Any rules/catalog/providers/accounts failure makes the whole page `error`; PCO options, Gmail labels, and project-template names intentionally degrade to null/empty because their data-source methods swallow HTTP failures (`ARC:44-74`; `ARD:49-142,237-248`).

| Purpose | Exact request and success | Failure behavior | Evidence |
|---|---|---|---|
| Rules | `GET /automation-rules` → 200 | `assertOk`; page error | `ARD:49-59`; API `routes/automation_rules_routes.ts:8-15` |
| Trigger catalog | `GET /automation-catalog/triggers` → 200 | `assertOk`; page error | `ARD:61-75`; API `routes/automation_catalog_routes.ts:8-11` |
| Action catalog | `GET /automation-catalog/actions` → 200 | `assertOk`; page error | `ARD:77-91`; API `routes/automation_catalog_routes.ts:8-11` |
| Provider catalog | `GET /automation-catalog/providers` → 200 | `assertOk`; page error | `ARD:93-107`; API `routes/automation_catalog_routes.ts:8-11` |
| Integration accounts | `GET /integrations/accounts` → 200 | `assertOk`; page error | `ARD:109-121`; API `routes/integrations_routes.ts:8-9` |
| PCO teams/positions | `GET /integrations/planning-center/task-options` → 200 | HTTP ≥400 becomes `null`; builder explains connection prerequisite | `ARD:123-132`; API `routes/integrations_routes.ts:38-41` |
| Gmail labels | `GET /integrations/gmail/labels` → 200 | HTTP ≥400 becomes `[]`; Any/Unread/Inbox remain | `ARD:134-142`; API `routes/integrations_routes.ts:23-25` |
| Project templates | `GET /project-templates` → 200 | HTTP ≥400 becomes `[]`; free-text template name fallback | `ARD:237-248`; API `routes/project_templates_routes.ts:10-16` |

The API catalog filters triggers and providers to Rhythm plus providers with connected accounts (`controllers/automation_catalog_controller.ts:8-35`; `services/automation_catalog_service.ts:196-227`). Accounts include connected/error/reauth metadata, labels, trigger families, sync support, and last sync (`IA:19-55`; API `controllers/integrations_controller.ts:15-68`).

## Visible control inventory

| Surface/control | Type and precondition | Trigger and visible outcome | Endpoint / payload / status; loading and failure | Flutter evidence |
|---|---|---|---|---|
| New automation | Header button; catalog available | Opens builder seeded from first available provider/action | Dialog open is `client-side`; builder opening also starts `GET /facilities` → 200 for reservation choices | `ARV:72,220-224,695-846,897-1158`; `FDS:18-28` |
| Create automation | Empty-state button | Opens the same builder | Same as New automation | `ARV:284-343` |
| Rule card | Clickable inspection surface | Loads preview, then opens preview dialog | `GET /automation-rules/:id/preview` → 200. Failure sets controller/page error; current Flutter can still open a dialog with fallback content after the caught future returns | `ARV:154-168,454-456,562-640`; `ARC:76-85`; `ARD:144-153` |
| Enabled switch | Switch; rule exists | Patches inverse enabled state and replaces the matching list record | `PATCH /automation-rules/:id {enabled}` → 200. Spinner absent; failure leaves original state and shows page error | `ARV:462`; `ARC:154-169`; `ARD:188-219` |
| Trigger / Resync | Button; not already resyncing | Rhythm label is Trigger; external label is Resync. Button disables and shows spinner, request runs, then all eight bootstrap endpoints reload | `POST /automation-rules/:id/resync` → 200, then bootstrap GETs. Failure sets page error; spinner clears in `finally` | `ARV:402-405,522-537`; `ARC:186-200`; `ARD:229-235` |
| Visibility icon | Icon button | Same preview behavior as card click | `GET /automation-rules/:id/preview` → 200 | `ARV:539-542` |
| Edit icon | Icon button | Opens builder prefilled from the rule; Save updates matching card | Dialog is client-side; open starts `GET /facilities` → 200; Save uses `PATCH /automation-rules/:id {name,source,triggerKey,actionType,triggerConfig?,actionConfig?,sourceAccountId?,conditions}` → 200 | `ARV:117-151,543,743-846`; `ARC:118-152`; `ARD:188-219` |
| Delete icon | Icon button; rule exists | Deletes immediately and removes matching rule. Flutter has no confirmation dialog | `DELETE /automation-rules/:id` → 204. Failure keeps rule and shows page error | `ARV:406,544`; `ARC:171-184`; `ARD:221-227`; API `controllers/automation_rules_controller.ts:260-267` |
| Preview Close | Dialog button | Closes preview | `client-side`; no receipt | `ARV:562-640` |
| Builder Cancel | Dialog button | Closes without mutation | `client-side`; no receipt | `ARV:1118-1122` |
| Builder Create / Save | Dialog submit | Validates, returns draft, closes; parent creates/updates list | Create: `POST /automation-rules {name,source,triggerKey,actionType,triggerConfig?,actionConfig?,sourceAccountId?,enabled,conditions?}` → 201. Edit: PATCH payload above → 200 | `ARV:1123-1156,117-152`; `ARD:155-219`; API `controllers/automation_rules_controller.ts:140-258` |

API-backed mutation failures are caught inside controller methods and do not rethrow (`ARC:87-200`). Consequently the Flutter builder closes before create/update success is known, and no success toast is shown. The fixture redesign must use the shared visible toast/receipt conventions while keeping state truthful on simulated failure.

## Builder: catalog, provider, trigger, condition, and action rules

### Source and account

The builder is a five-section dialog: Source, Trigger, optional Conditions, Action, Review (`ARV:897-1113`). Automation name is optional in practice: blank becomes `_suggestedName()` (`ARV:1123-1128,1533-1545`). Source options are limited to Rhythm, connected providers, and an existing rule's historical provider; disconnected providers are not selectable for new rules (`ARV:2113-2137`). Source changes reset the trigger and synchronize the connected account; Rhythm clears account, external sources auto-select their first connected account (`ARV:916-968,2139-2151`).

External submission requires the selected account to match the source and be connected. The visible validation is “Connect <provider> before creating this automation” (`ARV:2172-2182`). Flutter does not provide a Connect button here; the web control must be disabled/explained and route users to the separate Integrations page rather than opening OAuth, consistent with fixture isolation.

### Trigger catalog and provider-specific configuration

Catalog keys, sources, descriptions, signal types, and config schemas are server data, not hard-coded display assumptions (`ACM:1-80`; API `services/automation_catalog_service.ts:9-124`). The builder filters triggers by selected source (`ARV:869-876`).

- Rhythm: single trigger select. `rhythm.task_due` and `rhythm.project_step_due` expose Days before due values 0,1,2,3,5,7,14; plan assembly has no extra field (`ARV:1041-1069,1315-1327`).
- Planning Center: multi-select checkbox list of all returned PCO triggers, optional multi-select teams and positions, and Lead-time window 3,7,14,21,30. Removing a team removes positions no longer valid for selected teams (`ARV:978-1040,1328-1419`). If task options are unavailable, the builder says “Connect Planning Center to filter by team” (`ARV:1329-1336`).
- Google Calendar: Title/location/description contains, Event type (Any/default/focusTime/outOfOffice), All-day only, and Date window 0,1,3,7,14,30 (`ARV:1421-1467`).
- Gmail: Sender contains, Subject contains, Label (Any/Unread/Inbox plus fetched labels), and Received within last hours 1,6,12,24,48,72 (`ARV:1469-1529`).

Trigger config omits blank/unset values. PCO `triggerKeys` is only emitted when more than one trigger is selected; the first selected key remains the canonical `triggerKey` (`ARV:2030-2062`).

### Conditions

Add condition is client-side and appends field/operator/value. Remove condition deletes that row (`ARV:1207-1299`). Fields are source-specific: Gmail subject/fromEmail/fromName/snippet/labelIds; Calendar title/description/location/eventType; PCO title/serviceTypeName/teamName/positionName/planDate; Rhythm title/notes (`ARV:1188-1205`). Operators are equals, not equals, contains, not contains, greater than, and less than (`ARV:1169-1186`). Empty condition values are silently omitted from the payload; no error is shown (`ARV:1301-1313`). The API validates only that condition field/operator/value are strings; it does not validate them against source catalog fields/operators (`controllers/automation_rules_controller.ts:12-36`).

### Actions

The returned action catalog includes Create task, Create project from template, Tag task, Send notification, Auto-schedule task, and Create reservation (`ARM:149-157`; API `services/automation_catalog_service.ts:126-163`). Availability is further constrained in Flutter: PCO may only create task/project, Calendar may use every action, and Rhythm/Gmail exclude reservation (`ARV:877-895`).

- Create project from template: fetched template dropdown; if the catalog is empty, free-text Project template name. Non-empty template name is required (`ARV:1766-1812,2184-2187`).
- Send notification: required Message template, examples, placeholder help, and rendered preview (`ARV:1626-1702,1813-1852,2188-2191`).
- Create reservation: facilities loading indicator, facility dropdown or “No facilities available” prerequisite, optional title/notes templates. Facility is required (`ARV:1853-1912,2153-2170,2192-2195`). Facilities are loaded on every builder open, not only when this action is selected (`ARV:844-846`).
- Other task actions: title/notes templates, source-specific placeholder chips/examples and rendered previews; Tag task adds Tag; Auto-schedule adds Target day Monday-Friday; PCO Create task adds Schedule in service week Monday-Sunday (`ARV:1913-2027,2221-2258`).

Action config omits blank fields and includes `facilityId`, `templateName`, templates, tag, targetDay, and targetDayOfWeek when set (`ARV:2064-2090`). Review summarizes provider/account, trigger config, and action (`ARV:2092-2111`).

## Preview and resync semantics

The endpoint named preview does **not** evaluate current source data and does not compute prospective changes. It returns a textual rule/config summary plus stored `previewSample`, `lastMatchedAt`, `lastEvaluatedAt`, and `matchCountLastRun` (`controllers/automation_rules_controller.ts:84-105,124-138`). Flutter renders that summary, last-run match count/timestamps, and the latest sample (`ARV:562-640`). The acceptance contract therefore asserts a non-mutating historical inspection receipt and makes no false “dry-run changes” claim.

Resync is mutating. External rules run their provider sync; Rhythm generates signals and evaluates them, returning generated signal, matched-rule, and executed-action counts (`services/integrations_service.ts:463-505`). Flutter discards the response body and only exposes button progress, then reloads all page data (`ARC:186-200`). The issue seed requires a visible result, so the fixture contract adds a truthful result status derived from that real response shape while preserving Flutter's spinner and reload sequence.

## Route and deep-link inventory

Flutter navigation is index-based and has no URL deep links (`app/core/layout/app_shell.dart:261,322-345`). The web contract adds URL representation for existing surfaces:

- `#/automations` — grouped rule collection.
- `#/automations/<ruleId>` — collection with the matching rule's preview inspector/dialog open; canonical fixture `#/automations/rule-calendar-room`.
- Unknown IDs render a recoverable rule-not-found state with Back to automations; no API is invented.
- Query state follows the path, e.g. `#/automations/rule-calendar-room?state=readonly`.

Builder create/edit remain controls/dialogs on the collection route rather than new routes, keeping the lead's route ask minimal.

## State matrix and failure coverage

Flutter directly models idle, loading, and error; initial loading replaces an empty list, empty rules render the create escape hatch, and an error banner can Retry (`ARC:10,44-74`; `ARV:74-99,284-343`). It has no page-specific role or read-only model; every API route is authenticated (`routes/automation_rules_routes.ts:8`; `routes/automation_catalog_routes.ts:8`; `routes/integrations_routes.ts:8`). The shared fixture matrix maps the surrounding shell/server states explicitly:

- `ready` (default): deterministic populated, created-at ordered rule groups.
- `loading`: `page-state-loading`; no mutation.
- `empty`: `page-state-empty`; primary Create automation opens builder.
- `server-error`: `page-state-server-error` alert; Retry replaces URL state with ready without reload.
- `forbidden`: `page-state-forbidden`; names authenticated workspace membership/ownership prerequisite.
- `unavailable`: `page-state-unavailable`; names the local Rhythm API prerequisite.
- `readonly`: `page-state-readonly`; list/preview inspection remains available; native disabled fieldset plus `aria-disabled="true"` disables create/edit/toggle/delete/resync.
- `catalog-empty`: rules remain inspectable, New/Create are disabled, and a visible catalog-unavailable prerequisite is given. This covers an empty provider/trigger/action catalog without inventing fallback choices.
- `invalid-config`: an existing rule whose source/trigger/action no longer agree is visibly marked invalid; preview remains available, mutating execution is disabled, and Edit is the recovery.
- `provider-error`: a rule/account displays provider error/reauth context; provider-dependent builder and Resync controls are disabled with a visible Integrations handoff.

PCO options, Gmail labels, project templates, and facilities are partial-dependency failures rather than whole-page errors because Flutter degrades them to null/empty (`ARD:123-142,237-248`; `ARV:2153-2169`). Those controls keep their explicit fallbacks/prerequisites.

## Permissions, accessibility, responsiveness, and fixture translation

- Rule ownership is enforced by repository lookup/filtering, not a distinct Automations role (`repositories/automation_rules_repository.ts:58-88,117-148`). A missing/unowned ID is 404 rather than 403. The shared forbidden/readonly states are shell-level fixture representations.
- Flutter icon buttons lack text labels in this file (`ARV:539-544`). The web implementation must add accessible names without adding behavior.
- Builder and preview are modal dialogs; the web must trap focus, close on Escape, and restore the invoking trigger. Validation errors use alert semantics; progress/results use live status.
- The 620px Flutter builder and row-shaped cards (`ARV:447-550,897-904`) need responsive translation: stack card actions and builder fields at narrow widths while preserving all controls and 44px targets.
- Visual translation follows the mineral reference: dark blue-green surfaces, hairline mineral dividers, restrained turquoise accent, compact density, 10/16/24px radii, Inter UI, and SF Mono operational metadata (`../rhythm-dashboard-redesign.html:13-69,78-98,111-197`).
- Runtime and tests remain deterministic fixture-only. No OAuth, API, analytics, or provider host is opened. “Connect” is a visible fixture handoff to `#/integrations`, never external navigation.

## Open questions

1. The issue seed says list/search/filter, but Flutter has no search or list-filter control. The contract omits both. Does product explicitly want a web-only discovery enhancement in a later issue?
2. “Preview renders matches/changes” overstates the endpoint: it returns historical sample/run metadata and a config summary, not a dry-run or change set. Should a future API add true prospective evaluation?
3. Resync returns useful counts/results, but Flutter discards them. The contract exposes a fixture result to satisfy the seed. Which provider-specific result fields should become the stable user-facing summary?
4. Planning Center visually allows clearing all trigger checkboxes, but submit falls back to the first trigger through `_selectedTriggerKey`; should zero selected triggers be an explicit validation error?
5. Empty condition values are silently dropped and server validation does not enforce source field/operator compatibility. Should the web hard-error incomplete/invalid rows, or preserve Flutter's omission behavior?
6. Delete is immediate in Flutter. Should the redesign preserve that exact behavior or add a confirmation before the implementation turn?
