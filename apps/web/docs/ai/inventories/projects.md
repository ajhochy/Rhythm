# Projects behavior inventory — issue 2005

## Scope and source map

This inventory covers the recurring-work Projects destination mounted by Flutter as shell index 4 (`app/core/layout/app_shell.dart:259-263,322-345`). It is not the agent-workspace/VCS feature served by API `/projects`; the page uses project templates, generated project instances, their steps, collaborators, and milestones.

Primary behavior sources:

- `features/projects/views/projects_view.dart`
- `features/projects/controllers/project_template_controller.dart`
- `features/projects/controllers/project_milestones_controller.dart`
- `features/projects/repositories/projects_repository.dart`
- `features/projects/repositories/project_milestones_repository.dart`
- `features/projects/data/projects_local_data_source.dart`
- `features/projects/data/project_milestones_data_source.dart`
- `features/projects/services/project_generation_service.dart`
- `features/projects/models/project_template.dart`, `project_template_step.dart`, and `project_instance.dart`
- `features/tasks/data/collaborators_data_source.dart`
- `shared/widgets/collaborators_row.dart`
- `app/core/ui/rhythm_inspector.dart`

The prompt refers to separate instance/step/collaborator data sources in the Projects feature directory. In the checked-out Flutter tree, instance load/update/delete/generate calls are made directly in `projects_view.dart`; collaborator calls are shared from the Tasks feature; only milestones have a Projects-specific controller/repository/data-source chain (`projects_view.dart:218-326,566-667,1179-1212,1236-1244,1341-1358`; `features/tasks/data/collaborators_data_source.dart:50-81`).

## Routes, modes, and selection

Flutter provides one shell destination, not URL routes. It defaults to Active Projects and has a top segmented control for `Templates` versus `Active Projects`; selecting Active Projects lazily loads all owned instances (`projects_view.dart:29-33,133-164,169-209,218-248`). Within Templates, selecting a template opens its detail, and the detail has `Template Steps` and template-scoped `Active Projects` tabs; changing templates clears and conditionally reloads the scoped instance list (`projects_view.dart:185-205,444-480,529-557,762-838`).

Web route additions required for deterministic deep linking:

- `/projects` — canonical Projects destination; defaults to Active Projects like Flutter.
- `/projects/templates` — template list and selected-detail empty prompt.
- `/projects/templates/:templateId` — selected template on Template Steps.
- `/projects/templates/:templateId/instances` — selected template's Active Projects tab.
- `/projects/instances/:instanceId` — global Active Projects with the named instance expanded/selected.

These paths are accessibility/navigation adaptations; Flutter itself keeps mode, selection, expansion, and completion filtering only in widget state.

## Loading and data ownership

- Mount loads templates and workspace members. The top-level Active Projects list is not automatically loaded despite being the default segment; it first shows a `Load active projects` escape hatch (`projects_view.dart:35-41,170-180,1001-1020`).
- Templates load with `GET /project-templates`; controller states are `idle`, `loading`, and `error`. Load clears prior error, replaces templates, and notifies; mutations store errors in the same controller (`projects_local_data_source.dart:15-25`; `project_template_controller.dart:5,20-44,47-139`).
- All-instance load calls `GET /project-instances`; template-scoped load calls `GET /project-instances?templateId=:templateId`. The global result is sorted by ascending anchor date in Flutter; the scoped result preserves API order, which is descending anchor date (`projects_view.dart:218-241,566-585`; API repository `project_instances_repository.ts:344-362,405-426`).
- Instance JSON carries steps, milestones, owner, collaborators, and derived status; step order from the API is due-date ascending and milestone order is `sortOrder` ascending (`project_instance.dart:33-128`; API repository `project_instances_repository.ts:170-183`; `projects_view.dart:1218-1224`).

## Visible controls — page and templates

| Control | Preconditions | Trigger and visible outcome | Endpoint / payload | Loading, success, failure |
|---|---|---|---|---|
| Templates / Active Projects | Always | Switches distinct surfaces; first Active selection loads instances (`projects_view.dart:133-164`) | Client-side mode switch; Active load is `GET /project-instances` | Active panel exposes Load, Retry, and empty states (`projects_view.dart:1004-1028`) |
| Select template | Templates non-empty | Highlights row and opens name, description, anchor type, steps, and scoped instances (`projects_view.dart:425-480,691-730`) | Client-side | Selection is cleared if its template is deleted (`projects_view.dart:61-71`) |
| New template | Templates mode | Opens Name + optional Description dialog (`projects_view.dart:387-391,490-497,1821-1885`) | `POST /project-templates {name,description?} -> 201` (`projects_local_data_source.dart:27-45`; API controller `project_templates_controller.ts:24-39`) | Whitespace-only name does nothing; saving disables actions; controller appends only after success, but the dialog closes even when controller captured an error (`projects_view.dart:1888-1899`; `project_template_controller.dart:35-44`) |
| Edit template | Selected template | Opens prefilled Name/Description; successful response replaces the template in place (`projects_view.dart:739-743,854-861,1590-1680`; `project_template_controller.dart:59-76`) | `PATCH /project-templates/:id {name,description} -> 200` | Blank name does nothing; dialog closes after controller returns even on captured failure |
| Delete template | Any template row | Destructive confirmation names the template and warns all associated data is removed; confirm removes template and any generated instances (`projects_view.dart:475-512`; API repository `project_templates_repository.ts:287-331`) | `DELETE /project-templates/:id -> 204` | Cancel preserves it; success removes and deselects; controller error remains visible (`project_template_controller.dart:47-56`) |
| Template Steps / Active Projects tabs | Selected template | Switches between chronological steps and template-scoped generated instances (`projects_view.dart:762-838`) | Client-side; first scoped instance open uses `GET /project-instances?templateId=:templateId -> 200` | Scoped instance error has Retry (`projects_view.dart:566-589,1004-1011`) |
| Start Project | Selected template | Opens name/date form, chronological resolved-date preview, and success receipt view (`projects_view.dart:744-748,864-870,2030-2165,2168-2285`) | `POST /project-templates/:id/generate {anchorDate,name?} -> 201` | Anchor date is required and Start stays disabled until selected; server error stays in dialog; success shows name, anchor, and generated steps (`projects_view.dart:2082-2105,2119-2164,2250-2285`) |

Template creation does not expose `anchorType`, although the data source/API accept it. Existing anchor type is display-only (`projects_local_data_source.dart:27-39`; `projects_view.dart:723-729,1821-1899`). Do not invent an anchor-type editor.

## Visible controls — template steps

Template steps render sorted by `offsetDays`, while each row also displays the server-owned `sortOrder`. Adding uses `sortOrder = template.steps.length`; editing does not change sort order (`projects_view.dart:672-674,1484-1550,2011-2025`; `projects_local_data_source.dart:47-70,91-113`). This distinction must be preserved: chronological display order is not a reorder control.

| Control | Validation / trigger | Visible outcome | Exact endpoint | Failure |
|---|---|---|---|---|
| Add Step | Selected template | Dialog exposes title, signed offset days, assignee, optional offset description (`projects_view.dart:792-796,1910-2008`) | `POST /project-templates/:templateId/steps {title,offsetDays,offsetDescription?,sortOrder,assigneeId} -> 201` | Blank title does nothing; invalid offset falls back to `0`; reloads templates after success (`projects_view.dart:2011-2026`; `project_template_controller.dart:115-139`) |
| Edit step | Existing step | Prefilled title/offset/assignee/description; updated chronology and labels appear after reload (`projects_view.dart:1551-1561,1682-1818`) | `PATCH /project-templates/:templateId/steps/:stepId {title,offsetDays,offsetDescription,assigneeId} -> 200` | Blank title does nothing; invalid offset retains old value (`projects_view.dart:1801-1818`) |
| Delete step | Existing step | Confirmation names the step; confirm reloads template without it (`projects_view.dart:1563-1583`) | `DELETE /project-templates/:templateId/steps/:stepId -> 204` | Cancel preserves it; controller error is rendered in template rail |

## Visible controls — project instances and steps

| Control | Preconditions | Trigger and visible outcome | Endpoint / payload | Loading, success, failure |
|---|---|---|---|---|
| Load / Retry active projects | Active surface unhydrated/error | Replaces the panel with owned project cards (`projects_view.dart:1004-1020`) | `GET /project-instances -> 200` or scoped query | Failure renders `Could not load active projects` plus Retry (`projects_view.dart:1004-1011`) |
| Show completed / Hide completed | Loaded instances | Defaults to instances not done with at least one non-done step; toggle also reveals done instances/steps (`projects_view.dart:1078-1144,1291-1299`) | Client-side | Filtered empty says `No incomplete active projects` and points to Show completed (`projects_view.dart:1121-1130`) |
| Expand instance | Visible card | Reveals milestone controls, owner-gated collaborators, and grouped steps (`projects_view.dart:1291-1364`) | Client-side | N/A |
| Complete / reopen step | Expanded instance | Checkbox toggles `open`/`done`, reloads list, hides completed step by default, and can change derived instance status (`projects_view.dart:1394-1415`; API repository `project_instances_repository.ts:185-200,317-329,861-871`) | `PATCH /project-instances/steps/:stepId {status,assigneeId} -> 200` | Flutter swallows exceptions and non-2xx responses; web must surface failure without pretending success (`projects_view.dart:250-281,591-622`) |
| Inspect/edit instance step | Step row or edit icon | Shared inspector shows title, notes, scheduled/due date, assignment, project/owner/collaborator metadata; Edit details saves and closes (`projects_view.dart:284-311,625-653,1404-1476`; `rhythm_inspector.dart:1010-1255,1277-1296`) | `PATCH /project-instances/steps/:stepId {title,notes,dueDate,scheduledDate,assigneeId} -> 200` | Empty title does nothing; scheduled-after-due gives a non-blocking warning (`rhythm_inspector.dart:1163-1166,1277-1296`) |
| Delete active project | Instance card | Removes the instance and reloads (`projects_view.dart:1324-1328,314-325,655-666`) | `DELETE /project-instances/:id -> 204` | Flutter has **no confirmation** and silently ignores failure; do not claim a direct archive or status control |

There is no explicit instance edit/status action in Flutter. Instance `status` becomes `done` only when all steps are done and returns to `active` when any step reopens (API repository citations above). API `PATCH /project-instances/:id` only assigns `goalId`, and Flutter Projects does not expose it (`project_instances_routes.ts:12`; `project_generation_controller.ts:126-133`).

## Collaborators

Collaborators render only when an instance has an owner. The owner sees Add and can long-press an avatar to remove; non-owners see avatars only, and an empty collaborator row is hidden (`projects_view.dart:1338-1359`; `shared/widgets/collaborators_row.dart:34-81`). The picker excludes owner and existing collaborators; no candidates produces `No other workspace members to add` (`collaborators_row.dart:95-137`).

- Add: `POST /project-instances/:id/collaborators {userId} -> 201`, then reload (`collaborators_data_source.dart:64-71`; `projects_view.dart:1345-1351`).
- Remove: `DELETE /project-instances/:id/collaborators/:userId -> 204`, then reload (`collaborators_data_source.dart:73-81`; `projects_view.dart:1352-1358`).
- Flutter does not separately call `GET /project-instances/:id/collaborators`; collaborators arrive embedded in instance loads, although the shared data source defines the GET method (`collaborators_data_source.dart:50-62`; `project_instance.dart:110-114`).
- API add/remove is owner-only with exact forbidden messages; it returns 201/204 (`project_generation_controller.ts:288-329`).

## Milestones

| Control | Validation / outcome | Exact endpoint | Failure |
|---|---|---|---|
| Add milestone | Expanded instance; title-only dialog; blank/cancel is a no-op; sends current milestone count as order and reloads (`projects_view.dart:1179-1212`) | `POST /project-instances/:id/milestones {title,sortOrder} -> 201` (`project_milestones_data_source.dart:16-37`) | Controller returns false and retains `errorMessage`; Flutter shows no visible error (`project_milestones_controller.dart:11-25`) |
| Delete milestone | Existing milestone; no confirmation; deleted milestone's steps become Ungrouped in API transaction (`projects_view.dart:1236-1244`; API repository `project_instances_repository.ts:765-798`) | `DELETE /project-instances/:id/milestones/:milestoneId -> 204` | Reload only on controller success |
| Assign milestone / Ungrouped | Per-step popup | Moves the step to chosen milestone group or Ungrouped and reloads (`projects_view.dart:1451-1471`) | `PATCH /project-instances/steps/:stepId {milestoneId} -> 200` (`project_milestones_data_source.dart:49-56`) | Popup offers only milestones belonging to this instance; API rejects cross-instance IDs (`project_instances_repository.ts:835-842,899-906`) |

Flutter has API support for milestone due date, color, and updates, but its Projects UI exposes none of those controls (`project_milestones_data_source.dart:16-31`; `project_instances_routes.ts:14-17`; `projects_view.dart:1179-1212`).

## Exact endpoint and permission matrix

All template/instance routes require authentication (`project_templates_routes.ts:10-20`; `project_instances_routes.ts:8-21`) and are mounted at `/project-templates` and `/project-instances` (`api_server/src/app.ts:132-134`).

| Method/path | Page use | Response / permission truth |
|---|---|---|
| `GET /project-templates` | Initial templates / post-step reload | `200`; only actor-owned templates (`project_templates_controller.ts:8-14`; `project_templates_repository.ts:87-112`) |
| `POST /project-templates` | Create | `201`; name string required (`project_templates_controller.ts:24-39`) |
| `PATCH /project-templates/:id` | Edit | `200`; owned template lookup (`project_templates_controller.ts:42-59`) |
| `DELETE /project-templates/:id` | Delete template and its instances | `204`; owned template lookup (`project_templates_controller.ts:61-68`; `project_templates_repository.ts:287-331`) |
| `POST /project-templates/:id/steps` | Add step | `201`; title and numeric offsetDays required (`project_templates_controller.ts:70-95`) |
| `PATCH /project-templates/:id/steps/:stepId` | Edit step | `200`; owner-resolved step (`project_templates_controller.ts:97-108`; `project_templates_repository.ts:448-495`) |
| `DELETE /project-templates/:id/steps/:stepId` | Delete step | `204`; owner-resolved step (`project_templates_controller.ts:110-117`; `project_templates_repository.ts:498-535`) |
| `POST /project-templates/:id/generate` | Start Project | `201`; `anchorDate` YYYY-MM-DD required; optional `name` (`project_generation_controller.ts:60-80`) |
| `GET /project-instances[?templateId=:id]` | Global/scoped active runs and reload | `200`; owned instances only (`project_generation_controller.ts:108-124`; `project_instances_repository.ts:331-363,392-426`) |
| `PATCH /project-instances/steps/:stepId` | Step edit/status/milestone assignment | `200`; owner-resolved step; recalculates instance status (`project_generation_controller.ts:135-202`; `project_instances_repository.ts:874-936`) |
| `DELETE /project-instances/:id` | Delete instance | `204`; owned instance (`project_generation_controller.ts:270-277`) |
| `POST /project-instances/:id/collaborators` | Add collaborator | `201`; owner only (`project_generation_controller.ts:288-311`) |
| `DELETE /project-instances/:id/collaborators/:userId` | Remove collaborator | `204`; owner only (`project_generation_controller.ts:313-329`) |
| `POST /project-instances/:id/milestones` | Add milestone | `201`; nonblank title and integer order (`project_generation_controller.ts:217-234`) |
| `DELETE /project-instances/:id/milestones/:milestoneId` | Delete milestone | `204`; owned instance (`project_generation_controller.ts:257-268`) |

## Deterministic web state matrix

| `?state=` | Flutter/API basis | Required Projects behavior |
|---|---|---|
| `ready` | Normal controller/list state | Correct surface and selection; initial template and relevant instance receipts are visible |
| `loading` | Template loading and unhydrated instance panels (`project_template_controller.dart:20-33`; `projects_view.dart:404-409,1013-1020`) | `page-state-loading`; no mutation |
| `empty` on Templates | Empty templates (`projects_view.dart:416-424`) | `No templates yet`; primary escape opens New Template |
| `empty` on Active Projects | Loaded empty instances (`projects_view.dart:1022-1028`) | `No active projects yet`; navigate to Templates/Start Project |
| ready + empty selected template | Template has no steps (`projects_view.dart:800-807`) | `No steps yet`; Add Step escape hatch |
| ready + partial completion | Open/done steps and derived active status | Completed hidden by default; Show completed restores them |
| `server-error` | Template or instance load error (`project_template_controller.dart:28-31`; `projects_view.dart:1004-1011`) | `page-state-server-error`; `page-retry` recovers to ready without reload and records reload receipts |
| `forbidden` | Owner-only collaborator mutation and owner-scoped resources | Name project-owner prerequisite; inspection remains possible; owner-only controls disabled |
| `unavailable` | Flutter catches server/transport failures | Name project service/session prerequisite and expose deterministic recovery |
| `readonly` | No first-class Flutter enum; required by shared contract for a source/permission that can be inspected but not mutated | Name ownership/source prerequisite; native disabled fieldset covers every mutation while links, mode changes, and inspection remain enabled |

## No-dead-control and receipt classification

API-backed controls must append the exact receipt to `page-trace` only after their fixture outcome. Client-only controls must not fabricate receipts: mode/tabs, template/instance selection, expansion, Show completed, dialog open/cancel/close, date-picker open, and local generation preview. Unsupported API routes—milestone update, goal assignment, direct instance creation, and `/projects` VCS controls—must not appear as enabled Projects controls.

## Open questions and behavioral ambiguities

1. Flutter renders template steps chronologically by `offsetDays` while showing a separate `sortOrder`, and add uses list length for `sortOrder`. Should web describe this as chronological ordering (recommended) or expose a reorder affordance that Flutter lacks?
2. API instance list/find/update paths are owner-only even though project collaborators exist; collaborators can see project steps in Planner queries but cannot load the Projects instance collection. Should `/projects/instances/:id` remain owner-only, or should collaborator-visible inspection be added server-side later?
3. Instance and milestone deletion are immediate and failures are silently swallowed/hidden in Flutter. The contract keeps the controls Flutter-parity (no invented confirmation) but requires an observable fixture receipt/error. Confirm whether the implementation turn should harden these destructive actions with confirmation as a separately approved enhancement.
4. Flutter's default mode is Active Projects but does not automatically load it, producing a Load panel on first visit. The proposed web ready fixture is hydrated and records `GET /project-instances -> 200`; confirm whether literal first-load gating is desired instead.
5. Direct instance status actions do not exist. Status is derived from step completion; `PATCH /project-instances/:id` only updates `goalId`, which is not a Flutter control. The seed phrase “instance status actions” should therefore mean complete/reopen steps and observe the derived instance status.
