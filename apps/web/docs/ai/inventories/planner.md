# Planner behavior inventory — issue 2002

## Source map and scope

The paths in the issue under `lib/app/features/weekly_planner/` have moved. The live Flutter feature is under `lib/features/weekly_planner/`; all citations below use that real location. This inventory describes reachable behavior only. In particular, `_DetailPane` in `weekly_planner_view.dart:1192-1681` is never constructed, so its owner picker, Save/Discard, and Move earlier/later buttons are dead source and are not Planner controls.

Short source names used below:

- `planner_view`: `apps/desktop_flutter/lib/features/weekly_planner/views/weekly_planner_view.dart`
- `planner_controller`: `apps/desktop_flutter/lib/features/weekly_planner/controllers/weekly_planner_controller.dart`
- `planner_data`: `apps/desktop_flutter/lib/features/weekly_planner/data/weekly_plan_data_source.dart`
- `planner_model`: `apps/desktop_flutter/lib/features/weekly_planner/models/weekly_plan.dart`
- `task_inspector`: `apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart`
- `tasks_data`: `apps/desktop_flutter/lib/features/tasks/data/tasks_local_data_source.dart`
- `collaborators_data`: `apps/desktop_flutter/lib/features/tasks/data/collaborators_data_source.dart`

## Route and shell inventory

- Flutter exposes Planner as the primary `Planner` / tooltip `Weekly Planner` shell destination (`navigation_sidebar.dart:22-43`) and mounts `WeeklyPlannerView` at shell index 1 (`app_shell.dart:322-345`). The web integration route is `#/planner`.
- Flutter has no URL/deep-link representation for a week. The controller owns an ISO week label, initializes it from the current date, and changes it in seven-day increments (`planner_controller:26-28,53,69-82,298-332`). For deterministic web reload/share behavior, the minimal web-only representation should be `#/planner?week=YYYY-WNN`, not a second path hierarchy.
- Fixed now is Wednesday 2026-08-12 15:48 America/Los_Angeles. Its ISO week is `2026-W33`, Monday 2026-08-10 through Sunday 2026-08-16. The visible Flutter header formats that as `Week of Aug 10, 2026` (`planner_view:251-274`), and the Wednesday column is marked Today (`planner_view:753-767,850-889`).
- The page loads the plan and workspace members after first paint (`planner_view:29-37`). Planner's controller is wired to `WeeklyPlanDataSource` and `TasksLocalDataSource` in the application provider tree (`main.dart:363-367`).

## Data composition and ordering

- `GET /weekly-plan?week=YYYY-WNN` returns `weekLabel`, `weekStart`, seven day buckets, and `backlog` (`planner_data:16-24`; `planner_model:19-45`). The API validates the label and returns the assembled plan (`weekly_plan_controller.ts:18-29,63-66`).
- Normal tasks use `scheduledDate` before `dueDate` for day placement (`planner_model:47-53`; API `weekly_planning_service.ts:93-102`). Project steps are converted into task-shaped records and placed by `dueDate` (`weekly_planning_service.ts:104-115`).
- Backlog contains undated normal tasks plus open project steps with no due date and open project steps before the week start (`weekly_planning_service.ts:168-176`). This means “backlog” is broader than only undated work, despite the Flutter model comment at `planner_model:44-45`.
- Calendar shadow events are locked, task-shaped, read-only records (`weekly_planning_service.ts:117-165`). All-day and timed events are separated from regular tasks and rendered in an events bar, timed items sorted by start time (`planner_view:893-943`). Multi-day events appear on each spanned day, with exclusive end dates for all-day events (`planner_model:55-65`), and continuation pills gain a leading arrow (`planner_view:1794-1816`).
- Regular task order is explicit `scheduledOrder`, then energy (`🔥`, `⚡`, `🌱`), then case-insensitive title in Flutter (`planner_controller:9-23`). The API assembly order differs slightly: after explicit order it considers calendar time and energy but has no title tie-break (`weekly_planning_service.ts:178-181,187-210`). The browser fixture should be explicitly ordered so this difference is deterministic.
- Open mode hides completed tasks in both backlog and days; All mode includes them (`planner_view:178-195,381-384,462-464,769-775`). Backlog has a visible count badge when non-empty (`planner_view:473-493`).
- Flutter has no top-level open/done summary; its only live counts are backlog size and selected records (`planner_view:488-492,225-229`). The issue seed explicitly requires summaries to update, so the browser contract defines three derived, display-only values rather than a new control: scheduled open work (excluding calendar context and backlog), completed work, and unscheduled/backlog work. The ready fixture starts at 3 scheduled open, 1 done, and 2 backlog; these are client-derived and produce no receipt.

## Visible control inventory

| Control | Type and precondition | Trigger and visible outcome | Endpoint / receipt | Loading, success, failure |
| --- | --- | --- | --- | --- |
| Open / All | Segmented client filter; always inspectable | Toggles completed items in backlog and day columns (`planner_view:178-195,381-384,462-464,769-775`) | client-side; no receipt | Immediate; no network or failure state |
| Previous week | Icon button | Offsets ISO week by -1 and reloads (`planner_view:207-219`; `planner_controller:69-77`) | `GET /weekly-plan?week=<new-week> → 200` | Existing plan remains during reload; full loading state only when no plan exists (`planner_view:361-367`) |
| Next week | Icon button | Offsets ISO week by +1 and reloads (`planner_view:207-219`; `planner_controller:69-77`) | `GET /weekly-plan?week=<new-week> → 200` | Same as Previous |
| Today | Outlined button; disabled when already on current week | Resets to current ISO week and reloads (`planner_view:220-224`; `planner_controller:53,79-82`) | `GET /weekly-plan?week=2026-W33 → 200` | Same as Previous |
| Backlog Add task / Add unscheduled task | Button shown in empty and populated backlog | Opens create inspector with no seeded date (`planner_view:503-515,552-580,586-599`) | On save: `POST /tasks {title,notes?,dueDate?,scheduledDate?,preferredAgent?,energy?} → 201` (`planner_controller:211-230`; `tasks_data:26-55`) | Inspector shows Saving and disables save; success closes and reloads plan; controller surfaces page error on failure (`task_inspector:551-583,937-956`; `planner_controller:220-235`) |
| Add task to Mon…Sun | One button per day | Opens create inspector with that day's `scheduledDate` seeded (`planner_view:776-807,983-996`) | Same `POST /tasks … → 201`, with `scheduledDate:<column-date>` | Same create behavior |
| Task/project-step card | Click/tap | Selects the record and opens the shared task inspector; controller clears selection after it closes (`planner_view:45-63,106-147,1050-1061`) | Selection is client-side; closing triggers `GET /weekly-plan?week=<visible-week> → 200` | Inspector is modal; calendar items open read-only |
| Complete checkbox / inspector status icon | Hidden for calendar shadow events | Toggles `open` ↔ `done`; completing shows “Beautiful — keep the rhythm going.” (`planner_view:1097-1113,1935-1947`; `task_inspector:505-517`) | Normal: `PATCH /tasks/:id {status} → 200`; project step: `PATCH /project-instances/steps/:id {status} → 200` (`planner_controller:136-151`; `planner_data:46-88`) | Reloads plan on success; page error on failure |
| Long-press task selection | Non-calendar tasks only | Adds/removes card from multi-selection (`planner_view:1058-1062`; `planner_controller:89-102`) | client-side; no receipt | Selected styling and count appear immediately |
| Mark complete | Appears with one or more selected records | Sequentially patches each selected normal task/project step to done, clears selection, reloads (`planner_view:225-246`; `planner_controller:187-208`) | One exact task-versus-step PATCH receipt per selected item | No explicit progress indicator; first exception stops the loop and shows page error |
| Clear | Appears with selection | Clears all selected IDs (`planner_view:241-246`; `planner_controller:98-102`) | client-side; no receipt | Immediate |
| Drag task/project step to day column | Draggable for non-calendar records; any day accepts (`planner_view:809-818,1016-1047`) | Moves record to target day and reloads | Already-dated normal task: `PATCH /weekly-plan/tasks/:id {scheduledDate,locked:false,scheduledOrder} → 200`; undated normal task: `PATCH /tasks/:id {dueDate,scheduledDate,scheduledOrder} → 200`; project step: `PATCH /project-instances/steps/:id {dueDate} → 200` (`planner_controller:104-134`; `planner_data:27-43,46-88`) | Accent hover target; error promotes page to error state |
| Drop task before another task | Non-calendar draggable record | Computes midpoint `scheduledOrder`, moves day and reorders (`planner_view:1693-1765`) | Normal: `PATCH /tasks/:id {scheduledDate,scheduledOrder,…} → 200`; project step sends due date but the data source drops `scheduledOrder` (`planner_view:1718-1745`; `planner_data:63-71`) | Accent insertion line; reload on success via controller update |
| Close inspector | Icon button | Closes modal; Planner reloads after close (`task_inspector:585-590`; `planner_view:145-147`) | Reload receipt only: `GET /weekly-plan?week=<visible-week> → 200` | Immediate |
| Task title, notes, energy, scheduled date, due date, preferred agent | Editable fields for non-read-only records; create inspector starts in edit mode (`task_inspector:529-542,595-719,777-810`) | Create saves all supported fields. Existing Planner save visibly closes/reloads, but only notes/due/scheduled are forwarded by Planner (`planner_view:113-122`) | Existing normal: `PATCH /tasks/:id {notes?,dueDate?,scheduledDate?} → 200`; existing project step: `PATCH /project-instances/steps/:id {notes?,dueDate?} → 200`; create: `POST /tasks … → 201` | Empty title makes Save a silent no-op (`task_inspector:937-940`); save shows Saving; exceptions leave dialog mounted after finally |
| Cancel / Save changes / Create task | Inspector actions while editing | Cancel discards (or closes an unsaved create); Save invokes callback once and closes on success (`task_inspector:551-583,937-956`) | Depends on create/update path above | Save disabled while saving |
| Complete icon in inspector | Existing mutable task/project step only | Toggles status and closes (`task_inspector:505-517`) | Exact task-versus-step PATCH as above | Planner reloads; affirmation toast for completion |
| Add collaborator | Existing non-calendar item, members available | Opens member picker, adds selected member, updates chips (`task_inspector:725-775,885-918`) | `POST /tasks/:id/collaborators {userId} → 201` (`planner_view:131-137`; `collaborators_data:29-39`) | Updating disables controls; failure is surfaced in snackbar |
| Remove collaborator | Existing non-calendar collaborator chip | Removes member, then refetches collaborators (`planner_view:138-143`; `task_inspector:920-934`) | `DELETE /tasks/:id/collaborators/:userId → 204`, then `GET /tasks/:id/collaborators → 200` (`collaborators_data:17-47`) | Updating disables controls; failure is surfaced in snackbar |
| Help me finish this / Draft next steps / Summarize | Existing mutable item only | Creates a preconfigured agent session, sends a preset prompt, closes inspector, navigates to Agents (`quick_actions_bar.dart:47-70,164-205`; `planner_view:849-856`) | Reuse existing `POST /agent-sessions` and WS `session.input` contracts; in fixture-only Planner this must become an explicit handoff state and must not call a service | Busy spinner and failure snackbar in Flutter |
| Create follow-up tasks | Existing mutable item only | Creates a follow-up task, then launches an agent session and navigates to it (`quick_actions_bar.dart:208-269`) | Reuse `POST /tasks`, `POST /agent-sessions`, and WS `session.input`; fixture mode must show a deterministic handoff | Distinguishes total from partial failure in Flutter |

Calendar shadow events are deliberately not draggable, have no completion checkbox, have no collaborators or quick actions, and are locked into read-only inspector mode (`planner_view:1016-1020,1054-1062`; `task_inspector:455-475,497-517,837-860`).

## State inventory

| Contract state | Flutter evidence and web expectation |
| --- | --- |
| `ready` | A loaded `WeeklyPlan` renders backlog plus day columns (`planner_view:369-440`). Fixtures anchor to 2026-W33 and include a normal scheduled task, an undated task, a project step, a completed task, timed/all-day calendar context, and mixed source/energy/order values. |
| `loading` | Initial load with no plan shows “Loading this week...” (`planner_view:361-367`). |
| `empty` | Flutter can receive a valid plan with empty arrays; empty days retain their Add task button (`planner_view:926-966`), while empty backlog exposes “Add task” (`planner_view:503-515`). The contract empty state must retain that escape hatch. |
| `server-error` | Controller records exceptions and status error (`planner_controller:55-66`); view shows an error banner with Retry wired to `load` (`planner_view:78-91`). Retry must recover locally in fixture mode. |
| `forbidden` | Auth middleware guards all relevant API routes (`weekly_plan_routes.ts:8-10`, `tasks_routes.ts:8-16`, `project_instances_routes.ts:8-20`). Flutter has no dedicated page, so the fixture panel must name membership/permission as prerequisite. |
| `unavailable` | Network/server exceptions share Flutter's generic error path. The fixture panel must name the local service/data prerequisite and expose no fake success. |
| `readonly` | Flutter has item-level read-only calendar/prod-mirror behavior (`task_inspector:455-475`), but no whole-page readonly status. The deterministic page state should preserve inspection and natively disable all mutation while naming read-only access as the prerequisite. |
| partial data | API normally supplies seven buckets (`weekly_planning_service.ts:85-90`), while individual buckets/backlog can be empty. The fixture variant should keep all seven dates and omit optional fields/items, not inject malformed JSON that Flutter would reject (`planner_model:27-36`). |
| long/international content | Titles are allowed to flow in task cards and truncate only in drag feedback/event pills (`planner_view:1036-1042,1148-1164,1831-1839`). Seed a long RTL/CJK/emoji title and keep controls reachable at 200% text. |

## Endpoint truth and payload caveats

API routes are mounted exactly at `/tasks`, `/project-instances`, and `/weekly-plan` (`api_server/src/app.ts:130-135`). The endpoint families in the issue resolve as follows:

- `GET /weekly-plan?week=YYYY-WNN → 200`: exact Flutter fetch (`planner_data:16-24`); invalid labels are 400 (`weekly_plan_controller.ts:21-27`).
- `PATCH /weekly-plan/tasks/:id {scheduledDate,locked,scheduledOrder?} → 200`: Flutter emits `scheduledOrder` (`planner_data:27-40`), but the API controller currently destructures only `scheduledDate` and `locked`, so order is discarded (`weekly_plan_controller.ts:69-81`).
- `PATCH /tasks/:id → 200`: normal task notes, dates, ordering, status, and owner changes use this family (`planner_data:46-71`; `tasks_data:58-100`; `tasks_controller.ts:259-345`).
- `PATCH /project-instances/steps/:id → 200`: Planner maps project-step notes, due date, and status here (`planner_data:55-88`); the API route names the placeholder `:stepId` and supports more fields than Planner sends (`project_instances_routes.ts:13`; `project_generation_controller.ts:135-175,198`).
- `POST /tasks → 201`: Planner create uses the general tasks data source, not the unused `WeeklyPlanDataSource.createTask` helper (`planner_controller:211-230`; `tasks_data:26-55`; `tasks_controller.ts:228-254`).

Every fixture mutation must append its exact receipt to `page-trace`; Previous/Next/Today loads do too. Open/All, selecting, clearing, dialog open/close, and local handoff/navigation are client-side and must not gain fabricated API receipts.

## Behavioral ambiguities / risks for implementation

1. **Existing-inspector fields overpromise.** Planner opens the shared inspector with editable title, energy, and preferred-agent controls, but `onSaveDetails` forwards only notes and dates (`planner_view:113-122` versus `task_inspector:529-542,614-635,777-810,937-951`). Updating title/energy/agent appears successful but is lost after reload. The contract only promises persisted notes/dates for existing Planner records and records the extra fields as a Flutter defect, not intended behavior.
2. **Scheduling order has two lossy paths.** Flutter sends `scheduledOrder` to `/weekly-plan/tasks/:id`, but the API controller ignores it (`planner_data:33-40`; `weekly_plan_controller.ts:69-81`). For project steps, Flutter computes an order during drop-before but its data source intentionally omits scheduled fields/order (`planner_view:1724-1730`; `planner_data:67-70`). The fixture receipt should truthfully show the emitted client payload, while visual order after reload must remain deterministic without claiming server persistence that is absent.
3. **Project-step collaborator controls target task routes.** Planner only suppresses collaborator callbacks for calendar items, so task-shaped project steps receive `/tasks/:stepId/collaborators` callbacks (`planner_view:131-143`). Project steps originate from the project repository, not the tasks table (`weekly_planning_service.ts:104-115`), making this likely to fail. The prototype should disable these controls for project steps with an accessible source-owned explanation unless the lead explicitly decides to preserve the broken call.
4. **“Summaries” are a redesign requirement, not a Flutter Planner element.** Flutter exposes backlog and selection counts but no open/done totals (`planner_view:225-229,488-492`). The contract uses the narrow derived definitions above so implementation does not invent an ambiguous KPI.

## Open questions for the lead

- Should Planner hide/disable existing-task title, energy, and preferred-agent fields to match what its callback truly persists, or intentionally repair parity by routing those values through `PATCH /tasks/:id`? The recon contract takes the conservative first option for existing items.
- Should project-step collaborator controls be suppressed in the web prototype? This inventory recommends yes because Flutter wires them to task collaborator routes.
- Should `scheduledOrder` appear in the `/weekly-plan/tasks/:id` receipt as the Flutter-emitted payload even though the current API drops it? This inventory says yes, with the caveat documented in wiring.
- Are the contract's derived summaries—scheduled open, completed, and backlog—the intended interpretation of the seed requirement? Flutter itself does not settle this.
- Shared quick actions cross into Agents and cannot call real services in fixture mode. Should the lead prefer a disabled prerequisite state or a deterministic “handoff prepared” panel plus navigation to `#/agents`? The contract permits the latter as the observable fixture behavior.
