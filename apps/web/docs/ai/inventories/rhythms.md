# Rhythms behavior inventory — issue 2004

## Scope and source map

This inventory covers the shipped Rhythms collection, create/edit dialogs, workflow-step editor, enable/pause switch, delete confirmation, recurrence progress data, and the recurring-rule collaborator endpoints named in the issue. The checked-out Flutter feature is under `lib/features/rhythms/` rather than `lib/app/features/rhythms/`.

Citation abbreviations below refer to these read-only Rhythm sources:

- `RV`: `apps/desktop_flutter/lib/features/rhythms/views/rhythms_view.dart`
- `RC`: `apps/desktop_flutter/lib/features/rhythms/controllers/rhythms_controller.dart`
- `RR`: `apps/desktop_flutter/lib/features/rhythms/repositories/rhythms_repository.dart`
- `RD`: `apps/desktop_flutter/lib/features/rhythms/data/rhythms_data_source.dart`
- `RM`: `apps/desktop_flutter/lib/features/tasks/models/recurring_task_rule.dart`
- `WMP`: `apps/desktop_flutter/lib/shared/widgets/workspace_member_picker.dart`
- `WC`: `apps/desktop_flutter/lib/app/core/workspace/workspace_controller.dart`
- `WD`: `apps/desktop_flutter/lib/app/core/workspace/workspace_data_source.dart`
- `AS`: `apps/desktop_flutter/lib/app/core/layout/app_shell.dart`
- `NS`: `apps/desktop_flutter/lib/app/core/layout/navigation_sidebar.dart`
- `AR`: `apps/api_server/src/routes/recurring_rules_routes.ts`
- `AC`: `apps/api_server/src/controllers/recurring_rules_controller.ts`
- `APR`: `apps/api_server/src/repositories/recurring_task_rules_repository.ts`

## Route and selection truth

Flutter exposes Rhythms as shell navigation index 3, mounts one `RhythmsView`, and does not have a URL router or selected-rule parameter (`app_constants.dart:5-15`; `NS:22-43`; `AS:322-345`). A rhythm notification selects the Rhythms tab but does not select the notification's rule id (`AS:130-149`). Each card opens an in-place edit dialog; there is no persistent rule inspector or Flutter deep link (`RV:197-318`).

The web route and deep links required by issue 2004 are therefore routing adaptations, not literal Flutter routes:

- `#/rhythms` — collection.
- `#/rhythms/rule/:ruleId` — collection plus selected-rule detail.
- `#/rhythms/rule/:ruleId/edit` — the same selected rule with its edit dialog open.

The collection should load once through `GET /recurring-rules`; selection and deep-link parsing remain client-side, so selecting a card must not invent `GET /recurring-rules/:id` or collaborator-list receipts.

## Load, data, and rendered collection

- On first frame, Rhythms loads recurring rules and independently asks the shared workspace controller to load members (`RV:24-30`). Rules use `GET /recurring-rules` (`RD:15-25`); the member picker uses `GET /workspaces/me/members` through the workspace controller/repository (`WC:21-31`; `WD:41-51`).
- `RhythmsStatus` is only `idle`, `loading`, or `error`. Load clears the previous error, replaces the rule list on success, and stores the thrown message on failure (`RC:5,20-33`).
- Empty initial loading is a centered spinner. An empty loaded list is the `No recurring rules yet` state with a `New rule` action (`RV:171-193,1261-1333`). With stale rules, loading leaves the list visible; an error renders a retry banner above whichever list/empty content remains (`RV:59-77,171-193`).
- Rules preserve server order; the API repository orders by `created_at ASC` and includes rules owned by or shared with the authenticated user (`APR:137-169`). Flutter has no search, filter, sort, grouping, or manual refresh control. Issue seed language about “list/search/filter” must resolve to the actual Flutter list: do not add search/filter controls merely because they sound useful.
- Each card displays completion percentage as a donut, title, `patternDescription`, enabled switch, Edit, and Delete (`RV:209-297`). Disabled rules are visually dimmed but Flutter does not print an Enabled/Paused word (`RV:211,230-255`). The web contract adds the explicit status word for accessibility while retaining the same switch behavior.
- Exact pattern text is `Every <weekday>`, `Monthly on the <ordinal>`, or `Every <month> <ordinal>`; missing schedule values default to Monday/day 1/January (`RM:201-253`). Supported frequency values are weekly, monthly, and annual (`RM:152-160`; `RV:427-455`).
- The returned model also carries owner id, workflow steps, collaborators, progress counts, waiting person, next due date, and goal id (`RM:102-165`). The API decorates every collection/detail response with collaborator data, assignee names, generated-task counts, completion ratio, waiting person, and the first remaining due date (`AC:254-313`). Current Flutter renders only `completionRatio` through `completionFraction`; it does not render collaborators, counts, waiting person, or `nextDueDate` (`RM:194-199`; `RV:224-269`).

## Visible control inventory

### Header, list, and cards

| Control / content | Preconditions | Trigger and visible outcome | Wire behavior | Loading / success / failure |
|---|---|---|---|---|
| New rule (header and empty state) | Authenticated writable page | Opens `New Recurring Rule` dialog (`RV:61,87-95,138-154,1311-1328`) | Client-side open | No receipt until Create |
| Rule card / selected detail (web adaptation) | Rule exists | Selects the rule and exposes its server-returned schedule/progress/collaborators | Client-side selection | Invalid deep-link behavior is a lead decision |
| Completion donut | Rule loaded | Read-only percentage from `progress.completionRatio`, defaulting to 0 (`RV:224-243`; `RM:194-199`) | Client-side display | Decorated by the collection response |
| Enabled switch | Rule loaded | Optimistically flips enabled/dimmed state (`RV:273-279`; `RC:114-132`) | `PATCH /recurring-rules/:id {enabled}` (`RD:67-96`) | Server success replaces the rule; failure reverts the switch and exposes the global error banner |
| Edit rule | Rule loaded | Opens prepopulated `Edit Rule` dialog (`RV:280-305,759-780`) | Client-side open; Save uses PATCH | Save spinner disables Save/Cancel while active (`RV:1012-1037`) |
| Delete rule | Rule loaded | Opens destructive confirmation naming the rule and warning that generated tasks remain (`RV:287-317`) | Confirm: `DELETE /recurring-rules/:id` (`RD:98-104`) | Row disappears after success; controller error/banner on failure (`RC:135-145`) |

Flutter does not expose a separate pause button: “pause” is `enabled:false` through the switch. It also has no search/filter controls to classify as client-side.

### Create dialog

| Control | Flutter behavior / validation | Payload behavior | Failure behavior |
|---|---|---|---|
| Title | Autofocused; trimmed; blank submission returns without a request or visible error (`RV:418-425,680-683`) | Required `title` | The web contract requires a native/visible validation message so the blank path is deterministic |
| Frequency | Weekly, Monthly, Annual; changing frequency supplies missing step defaults but does not clear schedule values from the local models (`RV:427-455`) | Required `frequency` | API rejects other values (`AC:58-68`) |
| Day of Week | Weekly only; Sunday=0 through Saturday=6; defaults Monday (`RV:363-382,457-478`) | `dayOfWeek` | Top-level day range is not explicitly validated in the API controller |
| Day of Month | Monthly/annual only; digits; local callback accepts only 1–31 (`RV:479-518,1238-1258`) | `dayOfMonth` | Typing an invalid value leaves the prior model value while the field can show invalid text; web must make that state visibly invalid rather than silently saving the old value |
| Month | Annual only, January=1 through December=12 (`RV:492-518`) | `month` | Same top-level API-validation gap |
| Add step | Appends a locally generated step with recurrence defaults (`RV:547-566,657-659`) | Step fields are serialized inside `steps` | Flutter uses `DateTime.now().microsecondsSinceEpoch`; web fixtures must use deterministic ids per C8 |
| Sequential | Visible only when more than one step exists (`RV:532-546`) | `sequential` boolean | No separate request |
| Step task title | Empty steps are silently discarded, not submitted (`RV:661-687,1175-1181`) | `steps[].title` | Non-empty steps require their frequency-specific schedule fields (`RV:661-694`) |
| Step assignee | Optional workspace member or None (`RV:1183-1187`; `WMP:5-57`) | `steps[].assigneeId` | Member-load failure is stored by the shared controller but Rhythms does not surface it in the dialog (`WC:21-31`) |
| Step recurrence | Weekly day; monthly day; annual month and day (`RV:1188-1231`) | `steps[].dayOfWeek/dayOfMonth/month` | Invalid/missing non-empty step schedule shows `Each step must have the required day field(s) set.` (`RV:661-694`) |
| Remove step | Disposes/removes the local step (`RV:600-619`) | Client-side until create | No receipt |
| Cancel | Closes unless saving (`RV:639-642`) | Client-side | No receipt |
| Create | Disables actions and shows a spinner while awaiting (`RV:643-652,696-711`) | `POST /recurring-rules {title,frequency,dayOfWeek?,dayOfMonth?,month?,sequential,steps}` (`RD:39-65`) | Controller catches errors, but the dialog still pops after `await`; this can hide failed creation (`RC:67-93`; `RV:696-712`) |

The create surface does **not** support task notes, due date, status, priority, tags, energy, preferred agent, goal, arbitrary owner, or collaborators. Ownership is implicitly the authenticated user in the API (`AC:74-84`). “Supported task template fields” therefore means step title, optional assignee, and frequency-specific day/month only.

### Edit dialog

Edit exposes the same recurrence and step fields as Create, prefilled from the selected rule. Legacy null step schedule fields fall back to the rule-level schedule (`RV:759-780`). Empty title submission is ignored; empty step titles are dropped; frequency-specific step validation matches Create (`RV:1042-1078`). Save sends the complete supported edit surface in one `PATCH /recurring-rules/:id` and closes after awaiting the controller (`RV:1080-1097`; `RD:67-96`).

API update deletes future open generated tasks, then regenerates the lookahead only if the returned rule is enabled (`AC:100-135`). This is why the selected detail's generated/next-due information must update deterministically after edit or enable/pause in the fixture design. As in Create, the controller swallows the error and the dialog closes anyway (`RC:35-65`; `RV:1080-1097`).

### Collaborators: latent data path, no shipped Flutter control

The rule model parses collaborators (`RM:3-24,139-143`), and `RhythmsDataSource` defines add/remove calls (`RD:106-121`). However:

- `RhythmsRepository` and `RhythmsController` do not expose collaborator methods (`RR:5-57`; `RC:7-146`).
- `_RuleTile` receives a `RhythmsDataSource` but never calls it (`RV:161-207,209-318`).
- The only `WorkspaceMemberPicker` use in Rhythms is the workflow-step assignee field (`RV:1183-1187`).

Therefore current Flutter has no add/remove collaborator control. Issue 2004 nevertheless names collaborator add/remove as a minimum acceptance outcome. The contract treats it as an explicit issue-level addition on selected-rule detail, backed by the latent Flutter data methods and returned model, and flags this parity exception for the lead.

Server truth for that addition:

- `POST /recurring-rules/:id/collaborators {userId}` is owner-only and returns the updated collaborator list with status `200`, not `201` (`AR:15-17`; `AC:213-236`).
- `DELETE /recurring-rules/:id/collaborators/:userId` is owner-only and returns `204` (`AC:238-252`).
- `GET /recurring-rules/:id/collaborators` exists and returns `200`, but Flutter's Rhythms data source has no fetch method and the main rule response already includes collaborators (`AR:15`; `AC:204-211,263-305`). Do not fabricate this receipt for normal selection/add/remove.
- The owner and existing collaborators must be excluded from an add picker. The most faithful candidate source is the already-loaded workspace member list, not all users.

## Endpoint and permission matrix

All recurring-rule and user/workspace routes require authentication; the API mounts them at `/recurring-rules`, `/users`, and `/workspaces` (`api_server/src/app.ts:130-139`; `AR:8-17`; `users_routes.ts:8-13`; `workspace_routes.ts:8-16`).

| Method / route | Rhythms-page use | Payload / response | Permission and behavior truth |
|---|---|---|---|
| `GET /recurring-rules` | Initial load / Retry | `200` decorated list | Owned and collaborator-visible rules, oldest first (`AC:30-42`; `APR:137-169`) |
| `POST /recurring-rules` | Create | Supported recurrence/steps; `201` decorated rule | Actor is implicit owner; immediately generates default eight-week lookahead (`AC:58-95`) |
| `PATCH /recurring-rules/:id` | Edit and enable/pause | Partial supported keys; `200` decorated rule | Any actor who can resolve an owned/shared rule can currently patch it; future open generated tasks are replaced (`AC:100-135`; `APR:215-264,322-383`) |
| `DELETE /recurring-rules/:id` | Confirm delete | No payload; `204` | Any actor who can resolve an owned/shared rule can currently delete it (`AC:138-145`; `APR:385-402`) |
| `POST /recurring-rules/:id/collaborators` | Seed-mandated selected-rule addition | `{userId}`; `200` collaborator list | Owner only; exact forbidden text is `Only the rhythm owner can manage collaborators` (`AC:213-236`) |
| `DELETE /recurring-rules/:id/collaborators/:userId` | Seed-mandated selected-rule removal | No payload; `204` | Owner only; invalid id is `400` (`AC:238-252`) |
| `GET /workspaces/me/members` | Step assignee and collaborator candidates | `200` workspace-member list | Actual call made by `RhythmsView` through `WorkspaceController` (`RV:27-30`; `WD:41-51`) |
| `GET /users` | None in current Rhythms UI | `200` all users | `RD.fetchUsers` and `RR.getUsers` exist but are never called by the view/controller (`RD:27-37`; `RR:10-13`) |
| `GET /recurring-rules/:id` | None in current Rhythms UI | `200` decorated rule | Registered server route only; collection selection should not invent this request (`AR:9-13`; `AC:44-56`) |
| `GET /recurring-rules/:id/collaborators` | None in current Flutter data source | `200` list | Registered server route only; omit until a real refresh control needs it (`AR:15`; `AC:204-211`) |
| `POST /recurring-rules/:id/steps` | None; dialogs patch the full step list | `{title,assigneeId?,schedule,sortOrder?}`; `201` step | Server-only route, not a Flutter Rhythms control (`AR:14`; `AC:147-202`) |

The API controller validates step recurrence fields but does not equivalently validate top-level day/month ranges, title whitespace, update frequency, arbitrary update keys, assignee existence, or collaborator workspace membership (`AC:58-84,100-122,330-399`). The web fixture must validate the fields its dialog exposes without pretending those backend gaps are extra UI controls.

## Generated and next-run semantics

- Create immediately generates task instances from “now” through eight weeks ahead unless `RECURRENCE_LOOKAHEAD_WEEKS` overrides it (`AC:86-94`).
- Edit and enable/pause first delete future open tasks for the rule. Enabled rules regenerate the lookahead; paused rules do not (`AC:122-131`).
- Rule responses derive `totalCount`, `completedCount`, `remainingCount`, personal remaining count, waiting person, first remaining `nextDueDate`, and completion ratio from visible generated tasks (`AC:263-305`). A step-sourced task matches either `sourceId === rule.id` or `sourceId` prefixed by `rule.id:` (`AC:315-318`).
- Delete confirmation explicitly promises that already-generated tasks remain (`RV:307-316`). The web detail should call these “generated tasks” / “next due,” not claim an independent scheduler-run endpoint.

## Deterministic state matrix

| Web fixture state | Flutter basis | Required deterministic Rhythms behavior |
|---|---|---|
| `ready` (default) | Normal idle list (`RV:183-193`) | Populated deterministic rules, explicit Enabled/Paused status, initial list/member receipts, selection/deep links |
| `loading` | Empty rules while controller is loading (`RV:171-178`) | `page-state-loading`; no mutation controls |
| `empty` | Loaded rules empty (`RV:179-180,1261-1333`) | `page-state-empty`; `New rule` opens/focuses Create |
| `server-error` | Error banner and Retry (`RV:62-69`; `RC:20-33`) | `page-state-server-error` alert; `page-retry` moves URL to ready and restores the fixture list without reload |
| `forbidden` | Owner-only collaborator endpoint failures (`AC:213-252`) | Name the rhythm-owner prerequisite; preserve inspection and disable owner-only collaboration controls |
| `unavailable` | Flutter folds transport/service failures into `error` | Name recurring-rule service/authentication prerequisite; no pretend success |
| `readonly` | No distinct Flutter state; shared swarm hardening | Keep rule inspection available; natively disable every mutation in a disabled fieldset and name the source-of-truth prerequisite |

Flutter has no distinct forbidden, unavailable, or readonly enum. They are required by the shared fixture matrix and must not be presented as shipped Flutter states.

## Error, success, and receipt behavior

- Initial/read receipts: `GET /recurring-rules → 200`, then `GET /workspaces/me/members → 200` for people pickers.
- Create: `POST /recurring-rules {title,frequency,<active schedule>,sequential,steps} → 201`.
- Edit: `PATCH /recurring-rules/:id {title,frequency,<active schedule>,sequential,steps} → 200`.
- Enable/pause: `PATCH /recurring-rules/:id {enabled:true|false} → 200`.
- Collaborator add: `POST /recurring-rules/:id/collaborators {userId} → 200`.
- Collaborator remove: `DELETE /recurring-rules/:id/collaborators/:userId → 204`.
- Delete: `DELETE /recurring-rules/:id → 204`.

Selection, dialog open/close/cancel, step add/remove/reorder within an unsaved form, and the absence of search/filter are client-side. They must not append fake receipts. The page ledger appends receipts and remains fixture-only.

## Visual, accessibility, and responsive implications

The mineral reference establishes dark blue-green canvas/surfaces, restrained turquoise accent, hairline borders, compact Inter UI, SF Mono operational data, 10/16/24px radii, and 44px controls (`../rhythm-dashboard-redesign.html:10-68,82-166`). Rhythms should use those existing shared tokens and keep its progress/schedule/receipt data compact; visual reference behavior does not override Flutter.

Create/edit and collaborator dialogs must use the existing focus-dialog pattern: semantic dialog, labelled controls, trapped focus, Escape close, and focus restoration. Progress updates and receipts need polite live semantics; failures need alerts. At 1440/1024/768/390 CSS px, cards and editor rows must reflow without page-level horizontal overflow, including 200% text, RTL, forced colors, reduced motion, and the long CJK/emoji fixture title required by the brief.

## Open questions and riskiest ambiguities

1. **Collaborator controls are not wired in Flutter.** The issue seed requires add/remove, but the shipped view/controller/repository never expose them even though the model/data source/server do. Confirm that this explicit seed addition is allowed despite the no-invented-controls rule.
2. **Generated/next-run data is returned but hidden.** Flutter renders only completion percentage; the seed requires generated/next-run information to be explicit. Confirm the selected-detail adaptation and labels (`generated tasks`, `next due`) rather than a new scheduler control.
3. **Ownership is inconsistent.** Collaborator mutation is owner-only, while API update/delete currently allow any collaborator-visible rule and Flutter shows every mutation to everyone. Confirm whether shared collaborators may edit, pause, and delete or whether those controls should become owner-only.
4. Create/edit dialogs close after controller-captured failures, and invalid day-of-month text can save the previous value. The contract chooses accessible visible validation and keeps deterministic failure states visible; confirm this hardening over literal Flutter behavior.
5. `GET /users` is present in `RhythmsDataSource` but unused; the actual picker uses workspace members. Confirm that the web page should omit `/users` receipts/contracts (recommended).
6. Confirm the path-based deep links (`/rhythms/rule/:id[/edit]`) and behavior for an unknown rule id; Flutter has no precedent.
