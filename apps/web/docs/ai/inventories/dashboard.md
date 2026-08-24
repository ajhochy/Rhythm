# Dashboard behavior inventory — issue 2001

## Source resolution

The paths in the issue under `lib/app/features/dashboard/` do not exist in the current Flutter checkout. The shipping feature is under `lib/features/dashboard/`; citations below use that actual location. Abbreviations:

- `DV`: `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/dashboard/views/dashboard_view.dart`
- `DC`: `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/dashboard/controllers/dashboard_controller.dart`
- `DR`: `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/dashboard/repositories/dashboard_repository.dart`
- `DS`: `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/dashboard/data/dashboard_data_source.dart`
- `TCB`: `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/app/core/ui/rhythm_task_create_bar.dart`
- `QI`: `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart`
- `QA`: `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/agents/views/quick_actions_bar.dart`
- `MC`: `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/lib/features/messages/controllers/messages_controller.dart`

## Shipped data flow

`DashboardView` starts `DashboardController.load()` and workspace-member loading after its first frame (`DV:44-51`). The controller enters loading, clears its prior error, fetches `GET /dashboard/summary`, maps counts/lists/goals/rhythms/projects/unread previews, then enters ready or error (`DC:90-138`; `DS:23-32`). After the summary settles, it separately fetches `GET /project-instances` and synthesizes non-done dated project steps into past-due/today/week task lists; that second request is deliberately non-critical and its failure does not replace ready with error (`DC:140-195`; `DS:72-82`).

The summary owns open/past-due/today/week/unscheduled task counts and lists, goals, rhythm/project progress, total thread count, and unread previews. Defaults for missing JSON fields are explicit in the overview models (`dashboard_overview_models.dart:20-39,57-130`). Handoffs are derived client-side from open shared/collaborative tasks and sorted scheduled-date first, then due date, scheduled order, and creation time (`DC:117-123,316-347`).

One shipped parsing gap materially affects behavior: `DashboardProjectProgress` declares `nextStep` and `nextStepTitle`, but its `fromJson` factory does not populate either field (`dashboard_overview_models.dart:217-275`). The view therefore labels the project Next metric “No open tasks” and disables its Next shortcut even when `onDeckSteps` contains actionable rows; the on-deck rows themselves still work (`DV:815-824,846-899`). The prototype contract relies on those real on-deck rows and does not invent a working project Next shortcut.

`DashboardRepository` also exposes task-list, recurring-rule, project-template, and raw message-thread reads (`DR:18-30`), but `DashboardController.load()` does not call them. They are traced endpoint families, not mounted Dashboard controls.

## Visual composition reference

`../rhythm-dashboard-redesign.html` is specifically the Dashboard composition. Its page order is: Dashboard/artifact tab strip; toolbar with title/subtitle, open-task and thread chips, Refresh; loading/error/ready switch; “Focus for this week” hero containing Today, This week, and Next project progress cards; Quick Actions and Unread Messages context cards; Planning cards for Past Due, Collaborator Handoffs, Today, This Week, and Unscheduled; then the persistent task composer (`rhythm-dashboard-redesign.html:1366-1549`). The React page should preserve that section order and mineral dark blue-green visual language. Artifact-tab behavior belongs to the shared shell/live-artifact owner, not this page module.

Flutter’s newer wording differs slightly: its hero eyebrow is “At a glance,” headline is “Move the week forward,” and it can show up to two active project cards (`DV:360-388,846-933`). For issue 2001, the HTML’s “Focus for this week” section title is the visual-composition anchor while Flutter remains the behavior authority.

## Visible controls and outcomes

| Surface/control | Type and precondition | Trigger and visible outcome | Endpoint / failure behavior | Flutter evidence |
|---|---|---|---|---|
| Refresh | Icon button; ready page | Re-enters loading, then re-renders all summary counts/lists or the error panel | `GET /dashboard/summary` then non-critical `GET /project-instances`; summary failure shows “Dashboard could not load” | `DV:65-85,246-279`; `DC:90-198` |
| Retry | Error-state button | Repeats the same load without application reload | Same reads; repeated summary failure remains error | `DV:97-115`; `DC:198` |
| Today progress card / Next metric | Clickable card; Next is disabled when no today task | Opens Planner; a populated Next metric opens the first task inspector | Navigation is client-side; task inspection itself initially has no read call because the summary task is passed in | `DV:301-322` |
| This Week progress card / Tomorrow metric | Clickable card; Tomorrow is disabled when empty | Opens Planner; populated Tomorrow opens its task inspector | client-side | `DV:324-345` |
| Active project card / Next step / on-deck checks | Up to two cards; step controls require an active project/step | Card opens Projects; row opens project-step inspector; checkbox toggles only that step then refreshes summary | `PATCH /project-instances/steps/:stepId {status}` → 200, followed by dashboard reads; failures remain visible through controller error text without discarding current content | `DV:846-933`; `DC:271-313`; `DS:165-200` |
| Goal rollup | Read-only progress cards, only when goals exist | Inspection only; no control | no endpoint beyond summary | `DV:200-203,941-1019` |
| Quick Actions: Help me finish this, Draft next steps, Summarize, Create follow-up tasks | Four buttons only when a next actionable task exists (first today, otherwise first this week); one runs at a time and disables peers | Flutter creates an agent session, sends a preset, gives visible feedback, then navigates to that session. Follow-up additionally creates a task | Production behavior uses agent/task APIs, but this fixture-only prototype must render an explicit local handoff state and must not fake a receipt or contact a service | `DV:177-189,506-514,1164-1215`; `QA:47-72,95-129,164-206,208-285,301-330` |
| Unread Messages header | Only shown when unread previews exist | Opens Messages | client-side navigation | `DV:191-199,1217-1269` |
| Unread thread preview | One button per summary preview | Optimistically selects/marks the thread read, loads messages and threads, then opens Messages with the selected thread | Flutter sequence: `POST /message-threads/:id/read` → 204, `GET /message-threads/:id/messages` → 200, `GET /message-threads` → 200. Errors set Messages error state | `DV:497-504`; `MC:98-114`; `messages_data_source.dart:18-28,62-71,84-92` |
| Past Due card header and rows | Card exists only when task/project-step items exist | Header opens Planner; row opens the correct task or project-step inspector | client-side until a mutation occurs | `DV:408-434,516-554` |
| Collaborator Handoffs header and rows | Always present; list may be empty | Header opens Planner; task row opens task inspector | client-side until a mutation occurs | `DV:440-448`; `DC:117-123` |
| Today / This Week list headers and rows | Always present with explicit empty copy | Header opens Planner; row dispatches to task or project-step inspector | client-side until a mutation occurs | `DV:450-474,1272-1341` |
| Unscheduled list header and rows | Always present with explicit empty copy | Header opens Planner; row opens task inspector | client-side until a mutation occurs | `DV:476-487` |
| Task completion checkbox/status icon | Editable task only; calendar/prod-mirror sources are read-only | Toggles open/done, refreshes all summary data, and shows the completion affirmation when moving to done | `PATCH /tasks/:id {status}` → 200; failure retains page and exposes controller error | `DV:675-696`; `DC:220-233`; `DS:123-132`; `QI:455-517` |
| Task row inspector | Editable unless source is `calendar_shadow_event` or `prod_mirror` | Opens focused inspector. Title, notes, scheduled date, due date, preferred agent, energy, Save, Cancel, Close, collaborator add/remove, and completion are available; Escape/dialog close behavior is inherited from Flutter dialog semantics | Save: `PATCH /tasks/:id {title,notes,dueDate,scheduledDate,preferredAgent,energy}` → 200. Collaborators: `GET/POST /tasks/:id/collaborators`, `DELETE /tasks/:id/collaborators/:userId` | `DV:556-590`; `QI:455-590,595-811`; `collaborators_data_source.dart:17-48` |
| Project-step inspector | Project step row | Title, notes, scheduled/due dates, assignee, Save, Cancel, Close | `PATCH /project-instances/steps/:stepId {title,notes,dueDate,scheduledDate,assigneeId}` → 200 | `DV:593-632`; `QI:1052-1088,1093-1201,1277-1296` |
| New task title | Text input | Trimmed title is required. Flutter silently ignores empty submit; the HTML visual reference exposes inline `aria-invalid` error and focuses the field, which is the accessible prototype requirement | client-side validation | `TCB:50-65,123-133`; HTML `1543-1548,1900-1918` |
| New task notes | Text input | Optional context included when non-empty | Included in task POST | `TCB:55,169-183,201-213`; `DS:96-112` |
| Collaborator picker | Button/dialog; workspace members must be available | Selects one member and shows their name; selection clears after submit | After task creation: `POST /tasks/:newId/collaborators {userId}` → 201. This is intentionally a second request | `TCB:97-116`; `DR:32-47`; `DS:114-121` |
| Scheduled date | Date button/dialog | Select/clear a scheduled date; selection clears after submit | Included as `scheduledDate` in task POST | `TCB:135-150`; `DS:96-112` |
| Add task | Button or title submit; non-empty title | Creates task, clears composer, refreshes counts/lists. The prototype must visibly surface validation and receipts | `POST /tasks {title,notes?,scheduledDate?}` → 201, optional collaborator POST, then dashboard reads; errors remain on the page | `DV:226-235`; `TCB:50-65,152-157`; `DC:200-218`; `DR:32-47` |

## Route/deep-link inventory

Flutter is index-based rather than URL-based. `AppShell` starts at index `0`, and index `0` is Dashboard, so Dashboard is Flutter’s home screen (`app_shell.dart:69-83`; `app_constants.dart:5-15`). Dashboard callbacks target Weekly Planner, Projects, and Messages indices (`app_shell.dart:329-336`). The React route requested by the issue is `#/dashboard`; the existing web shell’s destination keys establish `#/planner`, `#/projects`, and `#/messages`. The fixture unread thread deep link is `#/messages/thread-weekend-team`; Flutter retains a numeric selected thread rather than exposing a URL (`DV:497-504`; `MC:98-114`).

The current React prototype maps bare `/` to Agents, unlike Flutter home. Whether `/` should be changed to Dashboard is a lead-owned compatibility decision; issue 2001’s page contract only requires `/dashboard`.

## State inventory and deterministic matrix

Flutter directly implements only `loading`, `ready`, and `error`; Retry calls refresh (`DC:8,90-138,198`; `DV:65-85,97-115`). Ready contains section-local empties: quick actions disappear without a next task, unread disappears without previews, goals disappear without goals, active project cards disappear without projects, Past Due disappears without items, and the other planning lists show explicit empty copy (`DV:177-204,420-487,510-514,851-854,1272-1341`). Project-step enrichment failure is swallowed as non-critical (`DC:193-195`). Task/project mutation failures set an error message but do not change `DashboardStatus` to error (`DC:214-217,229-232,265-268,278-281,310-313`).

The shared redesign matrix expands the URL-driven fixture surface:

- `ready` (default): deterministic populated summary plus section-level empties where fixtures say empty.
- `loading`: `page-state-loading`, status semantics, no mutation controls.
- `empty`: `page-state-empty` and a primary escape hatch that focuses the task title.
- `server-error`: `page-state-server-error` alert plus `page-retry`, which restores ready without reload.
- `forbidden`: names workspace permission as prerequisite.
- `unavailable`: names planning-data availability as prerequisite.
- `readonly`: preserves inspection/navigation and natively disables every mutation inside a disabled fieldset while naming the prerequisite.

Query-state changes must use `history.replaceState`, so reload reproduces the chosen state.

## Endpoint-family trace

- Used by Dashboard load: `GET /dashboard/summary`, `GET /project-instances` (`DS:23-32,72-82`).
- Used by Dashboard mutation: `POST /tasks`, optional `POST /tasks/:id/collaborators`, `PATCH /tasks/:id`, `PATCH /project-instances/steps/:stepId` (`DS:96-200`).
- Used by the task inspector: `GET/POST /tasks/:id/collaborators`, `DELETE /tasks/:id/collaborators/:userId` (`collaborators_data_source.dart:17-48`).
- Used by unread-thread selection before Messages opens: `POST /message-threads/:id/read`, `GET /message-threads/:id/messages`, `GET /message-threads` (`MC:98-114`; `messages_data_source.dart:18-28,62-92`).
- Present but not called by Dashboard controller: `GET /tasks`, `GET /recurring-rules`, `GET /project-templates`, `GET /message-threads`, and `GET /message-threads/:id/messages` through `DashboardRepository` (`DR:18-30`; `DS:34-94,203-213`). Recurring-rule creation/update/collaborator endpoints and project-template/instance creation are not Dashboard controls and must not be represented here.
- API route mounts confirm `/dashboard`, `/tasks`, `/project-templates`, `/recurring-rules`, `/project-instances`, and `/message-threads` (`api_server/src/app.ts:123-137`); task and project-step mutations are registered in `tasks_routes.ts:9-16` and `project_instances_routes.ts:10-21`.

## Open questions

1. Should the lead change bare `#/` from the prototype’s current Agents fallback to Dashboard to match Flutter’s index-0 home, or preserve the existing Agents compatibility route?
2. Flutter’s task-create bar silently ignores an empty title, while the visual reference has an explicit inline error. The contract chooses the accessible visible error; confirm this is the intended behavior correction.
3. Thread selection performs mark-read and hydration before Flutter navigates. The page contract uses the exact web deep link `#/messages/thread-weekend-team`; the Messages owner should confirm the same slug and whether receipts transfer across the route boundary.
4. Quick Actions are real agent/task operations in Flutter, but fixture isolation prohibits those calls. The contract requires a local handoff panel with one selected action; the Agents owner should define whether a later implementation consumes that handoff via query or shared state.
5. Should the redesign preserve the shipped project Next parsing gap (disabled “No open tasks”) or repair it by deriving Next from the first `onDeckSteps` item? Issue 2001 does not contract that shortcut.
