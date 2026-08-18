# Tasks behavior inventory — issue 2003

## Scope and source resolution

This inventory covers the Tasks list, Kanban board, inline create bar, task inspector, collaborator picker, and the inspector's task quick actions. `automation_rules_view.dart` is explicitly excluded for issue 2008.

The paths in the swarm assignment include a stale `lib/app/features/tasks/` segment. The files currently live at `apps/desktop_flutter/lib/features/tasks/`; citations below use the checked-out paths that exist. The desktop shell mounts `TasksView` as navigation index 2 rather than a URL route (`app/core/layout/app_shell.dart:259-263,322-345`).

Primary sources:

- `features/tasks/views/tasks_view.dart`
- `features/tasks/views/tasks_kanban_view.dart`
- `features/tasks/controllers/tasks_controller.dart`
- `features/tasks/repositories/tasks_repository.dart`
- `features/tasks/data/tasks_local_data_source.dart`
- `features/tasks/data/collaborators_data_source.dart`
- `app/core/ui/rhythm_task_create_bar.dart`
- `app/core/ui/rhythm_inspector.dart`
- `features/agents/views/quick_actions_bar.dart`

## Routes and selection

Flutter exposes a shell tab only; `TasksView` has no router or selected-task parameter (`app/core/layout/app_shell.dart:259-263,322-345`; `features/tasks/views/tasks_view.dart:15-20`). A row tap opens an in-place modal inspector (`tasks_view.dart:650-652,814-849`). Board cards are draggable but have no tap/inspector handler (`tasks_kanban_view.dart:206-222,258-340`). Therefore `/tasks`, list/board deep links, and selected-task deep links are web routing additions, not Flutter route parity. The wiring note proposes the minimum deterministic routes and flags selected-task parity as an open question.

## Loading and data ownership

- On mount, the view loads tasks and workspace members (`tasks_view.dart:62-68`). Tasks load through `GET /tasks`; the local source decodes the response as a task list (`tasks_local_data_source.dart:14-24`).
- The controller has `idle`, `loading`, and `error`; load clears the prior error, replaces the task list on success, and preserves an error message on failure (`tasks_controller.dart:5,27-39`).
- Create, update, status change, and delete mutate the controller list after their repository operation. Status change is optimistic and rolls back on failure; the other mutations are applied only after success (`tasks_controller.dart:41-63,65-121,130-176`).
- The API returns tasks owned by or shared with the authenticated user, and attaches collaborators (`api_server/src/repositories/tasks_repository.ts:143-181,222-230,459-503`). This is visibility logic, not an owner filter control.

## Visible controls

### Toolbar and organization controls

| Control | Type and precondition | Trigger and visible outcome | Wire behavior | Loading/failure |
|---|---|---|---|---|
| Search tasks | Text search, always available | Case-insensitive substring match across title, notes, and source name; visible count and groups update (`tasks_view.dart:189-205,230-235,382-386`) | Client-side | No separate loading/error state |
| Tag / All tags | Popup populated from task tags | Exact tag membership filter; tag label changes (`tasks_view.dart:237-255,206-210`) | Client-side | Empty result uses `Nothing to show` unless search is also active (`tasks_view.dart:404-424`) |
| Priority / Any priority / P1+–P3+ | Popup | Minimum numeric priority filter; missing priority behaves as zero (`tasks_view.dart:256-273,206-210`) | Client-side | Same empty behavior as tag |
| Open / All | Segmented control | List defaults to hiding `done`; All includes completed. Kanban always includes all statuses regardless of this toggle (`tasks_view.dart:54,189-194,274-290`) | Client-side | Completed-only recovery text tells the user to turn completed tasks back on (`tasks_view.dart:414-420`) |
| All / Today / This Week / This Month | Segmented time-window control | Filters the already-grouped list to the matching group and can toggle the active window off (`tasks_view.dart:291-319,579-586`) | Client-side | A window with no rows shows `No tasks due …` and an all-caught-up message (`tasks_view.dart:427-446`) |
| Color legend | Non-interactive legend | Explains past due, past deadline, today, rhythm, project, automation, and Planning Center tones (`tasks_view.dart:320-330`) | Client-side display | N/A |
| List / Board | Segmented control | Switches presentation while reusing the same `visibleTasks` result (`tasks_view.dart:113-147,175,333-350`; contract evidence in `test/contract/issue_1244_task_organization_test.dart:7-32`) | Client-side | Flutter retains search/tag/priority/time fields because they live in the parent state, but it has no selected board task |
| Sort | List-only popup | Ascending due date (falling back to scheduled date), created date, status enum order, or case-insensitive title; null dates remain last (`tasks_view.dart:22-49,59,211-212,351-381`) | Client-side | Hidden in Board view |
| Visible task count | Read-only badge | Shows count after the shared visibility filters (`tasks_view.dart:382-386`) | Client-side display | N/A |

Important correction to the seed outcomes: Flutter has no owner filter and no selectable grouping control. The real filters are Open/All, time window, tag, and minimum priority; grouping is fixed to time buckets. API query support for `status`, dates, overdue, search, tag, and minimum priority does not create extra Flutter controls (`api_server/src/controllers/tasks_controller.ts:38-132`).

### Inline create bar

The create bar is present in both List and Board and stacks below 900 px (`tasks_view.dart:108-174`; `rhythm_task_create_bar.dart:118-227`).

| Control | Validation / trigger | Visible outcome | Exact endpoint and payload | Failure |
|---|---|---|---|---|
| New task title | Required by behavior; whitespace is trimmed | Empty submission does nothing; successful submission clears the create fields (`rhythm_task_create_bar.dart:50-64,123-133`) | Part of create | Controller error state/banner |
| Note/context | Optional single-line text | Cleared after submission (`rhythm_task_create_bar.dart:169-183,200-213`) | `notes` is omitted by the data source when empty (`tasks_local_data_source.dart:41-52`) | Controller error state/banner |
| Collaborator | Optional workspace-member dialog | Selected member name replaces `Collaborator` (`rhythm_task_create_bar.dart:97-115,159-160`) | After task creation, `POST /tasks/:id/collaborators {userId}` (`tasks_repository.dart:24-39`; `tasks_local_data_source.dart:103-110`) | Create controller reports an error; note the repository can create the task before collaborator attachment fails |
| Scheduled | Optional date picker with clear | Selected date appears on the control (`rhythm_task_create_bar.dart:135-150`) | `scheduledDate` in create payload | Controller error state/banner |
| Add task | Submit button / Enter from title | Inserts returned task at the end of controller state (`tasks_controller.dart:41-57`) | `POST /tasks {title,notes?,scheduledDate?,preferredAgent:null} -> 201` (`tasks_local_data_source.dart:26-55`; API validation/status `api_server/src/controllers/tasks_controller.ts:228-254`) | Error stored and rendered; fields are cleared immediately by the bar, so failed-create restoration is ambiguous |

The create bar does **not** expose due date, status, priority, tags, energy, owner, goal/project, or preferred agent controls (`rhythm_task_create_bar.dart:10-31,37-42,118-227`).

### List rows

| Control | Trigger and outcome | Exact endpoint | Success/failure |
|---|---|---|---|
| Row | Tap | Opens task inspector (`tasks_view.dart:626-652`) | Client-side | N/A |
| Completion checkbox | Toggle open/done | `PATCH /tasks/:id {status:"done"|"open"}` (`tasks_controller.dart:123-155`; `tasks_local_data_source.dart:81-100`) | Optimistic list update; rollback plus error on failure. Completing (not reopening) shows exact affirmation `Nice work — one less thing carrying weight.` after server success (`tasks_controller.dart:153-160`; `tasks_view.dart:851-866`) |
| Inspect menu action | Select | Opens same inspector (`tasks_view.dart:773-795`) | Client-side | N/A |
| Delete menu action | Select, then destructive confirmation | Dialog names the task and says it cannot be undone (`tasks_view.dart:803-812`) | `DELETE /tasks/:id -> 204` (`tasks_local_data_source.dart:112-118`; API owner-only permission/status `api_server/src/controllers/tasks_controller.ts:351-363`) | Row/count update only after success; error banner on failure (`tasks_controller.dart:165-176`) |

Rows display title, optional source name, P-level and up to three tags, in-progress/waiting status, scheduled-or-due date, a distinct due hint, and overdue treatment (`tasks_view.dart:626-648,681-772`). Fixed groups are Past Due, Today, This Week, This Month, No Due Date, and Completed; scheduled date takes precedence over due date (`tasks_view.dart:478-586`).

### Kanban board

- Four horizontally arranged columns are Open, In progress, Waiting for reply, and Done, each with a count and quiet empty copy (`tasks_kanban_view.dart:18-27,48-72,130-255`).
- A long-press drag to a different column calls the same `PATCH /tasks/:id {status}` path (`tasks_kanban_view.dart:63-65,145-152,206-222`). The controller applies an optimistic update and rollback on failure (`tasks_controller.dart:130-162`).
- Cards sort by `scheduledOrder`, then due date, then title; null values sort last (`tasks_kanban_view.dart:93-128`). Cards display title, due date, preferred agent, priority, and up to three tags (`tasks_kanban_view.dart:258-340`).
- Initial loading replaces the board. Initial error shows `Unable to load tasks` with Retry; an error with stale tasks shows an error banner above the still-inspectable board (`tasks_kanban_view.dart:29-46,73-90`).
- Board cards do not open the inspector in current Flutter (`tasks_kanban_view.dart:206-222`). This conflicts with the seed request to preserve a selected task across presentations.

### Task inspector

The list opens the inspector in edit mode and supplies current workspace members plus collaborator callbacks (`tasks_view.dart:814-849`; `rhythm_inspector.dart:72-94,418-476`).

| Control | Preconditions / visible outcome | Exact endpoint | Failure |
|---|---|---|---|
| Title | Editable unless source is read-only | `PATCH /tasks/:id` | Empty save is ignored (`rhythm_inspector.dart:529-541,937-955`) |
| Notes | Editable multiline field | `notes` patch key | Save shows `Saving...`; modal closes after success (`rhythm_inspector.dart:595-611,937-956`) |
| Energy | None / 🔥 / ⚡ / 🌱 | `energy` patch key (`rhythm_inspector.dart:614-637`) | Controller error/banner after modal closes is a risk because `_save` does not inspect controller error |
| Scheduled date | Date picker/clear | `scheduledDate` patch key | A scheduled-after-due warning appears when applicable (`rhythm_inspector.dart:639-718`) |
| Due date | Date picker/clear | `dueDate` patch key | Same |
| Default agent | None / Claude Code / Codex | `preferredAgent` patch key (`rhythm_inspector.dart:777-810`) | API restricts values to `claude-code`, `codex`, or null (`api_server/src/controllers/tasks_controller.ts:135-146,268-285`) |
| Add collaborator | Editable, non-read-only, callback present, members available | `POST /tasks/:id/collaborators {userId} -> 201` | Button becomes `Updating...`; exact server error is shown in a snackbar (`rhythm_inspector.dart:758-772,885-918`) |
| Remove collaborator | Editable chip delete | `DELETE /tasks/:id/collaborators/:userId -> 204`, followed by `GET /tasks/:id/collaborators -> 200` to refresh (`tasks_view.dart:842-846`; `collaborators_data_source.dart:17-48`) | Exact server error shown and loading clears (`rhythm_inspector.dart:920-935`) |
| Toggle complete icon | Non-read-only existing task | Same status PATCH; closes inspector (`rhythm_inspector.dart:497-517`) | Controller rollback/error behavior |
| Cancel | Editing only | Reverts every local field to the task snapshot; create-mode Cancel discards (`rhythm_inspector.dart:551-574`) | Client-side |
| Save changes | Editing only | `PATCH /tasks/:id {title,notes,dueDate,scheduledDate,preferredAgent,energy} -> 200` via TasksView callback (`tasks_view.dart:822-835`; `tasks_local_data_source.dart:58-100`) | Saving disabled while active; error surfacing after controller capture is ambiguous |
| Close | Always | Closes modal (`rhythm_inspector.dart:585-590`) | Client-side |

Read-only sources are exactly `calendar_shadow_event` and `prod_mirror`. Their inspector title, notes, dates, collaborators, status toggle, automation, and quick actions cannot mutate; the header and prerequisite copy name calendar synchronization or the production source of truth (`rhythm_inspector.dart:455-475,497-517,529-551,600-617,647-718,749-772,780-837`).

Flutter Tasks does **not** edit owner/assignee, project/goal, priority, or tags in its inspector. It displays `Created by`, source type, and feed/source name only (`rhythm_inspector.dart:725-740,813-829`). The API and controller models support more patch fields, but the page callback intentionally forwards only title, notes, due/scheduled dates, preferred agent, and energy (`tasks_view.dart:822-835`; `tasks_controller.dart:65-105`). Project-step assignee editing belongs to the separate project-step inspector (`rhythm_inspector.dart:51-65,960-999`), not Tasks.

### Inspector quick actions

Non-read-only saved tasks show `Help me finish this`, `Draft next steps`, `Summarize`, and `Create follow-up tasks` (`rhythm_inspector.dart:830-860`; `quick_actions_bar.dart:47-71`). The first three create an agent session with the task id, send a preset prompt, then close the inspector and navigate to Agents (`quick_actions_bar.dart:164-206`; `rhythm_inspector.dart:849-857`). `Create follow-up tasks` first creates `Follow-up: <title>`, then starts an agent session to suggest more (`quick_actions_bar.dart:208-269`). These reuse already-owned Agents endpoint contracts; Tasks wiring must not duplicate them. In fixture mode they must create deterministic fixture sessions/tasks or be natively disabled with a visible fixture prerequisite—never open a real host.

## Endpoint and permission matrix

All task routes require authentication (`api_server/src/routes/tasks_routes.ts:8-16`), mounted at `/tasks` (`api_server/src/app.ts:130`).

| Method/path | Tasks-page use | Payload / response | Permission truth |
|---|---|---|---|
| `GET /tasks` | Initial load and Retry | Query support exists, but Flutter page calls without query; `200` list (`tasks_local_data_source.dart:14-24`) | Only owned or collaborator-visible tasks |
| `POST /tasks` | Create / follow-up create | Page create uses title, optional notes/scheduledDate, and null preferredAgent; `201` (`tasks_local_data_source.dart:26-55`; API `tasks_controller.ts:228-254`) | Authenticated actor becomes owner |
| `PATCH /tasks/:id` | Edit, complete/reopen, Board move | Partial keys; `200` task (`tasks_local_data_source.dart:58-100`; API `tasks_controller.ts:259-349`) | Any user who can resolve the owned/shared task can currently patch it (`api_server/src/repositories/tasks_repository.ts:459-503,1044-1105`) |
| `DELETE /tasks/:id` | Delete | No payload; `204` | Owner only, exact 403 message `Only the task owner can delete this task` (`api_server/src/controllers/tasks_controller.ts:351-363`) |
| `GET /tasks/:id/collaborators` | Refresh after remove | `200` list (`collaborators_data_source.dart:17-27`) | Any user who can resolve task (`api_server/src/controllers/tasks_controller.ts:365-372`) |
| `POST /tasks/:id/collaborators` | Create attachment and inspector add | `{userId}`; `201` list (`collaborators_data_source.dart:29-40`) | Owner only; exact 403 `Only the task owner can add collaborators` (`api_server/src/controllers/tasks_controller.ts:374-415`) |
| `DELETE /tasks/:id/collaborators/:userId` | Inspector remove | No payload; `204` (`collaborators_data_source.dart:42-48`) | Owner only; exact 403 `Only the task owner can remove collaborators` (`api_server/src/controllers/tasks_controller.ts:418-433`) |

`CollaboratorsDataSource` also defines `GET`, `POST {userId}`, and `DELETE` for `/project-instances/:id/collaborators`; these are not invoked by TasksView (`collaborators_data_source.dart:50-81`). API add/remove is project-owner-only and returns 201/204 (`api_server/src/routes/project_instances_routes.ts:19-21`; `api_server/src/controllers/project_generation_controller.ts:279-329`). They belong in the requested endpoint wiring as cross-page contracts, not as fake Tasks receipts.

## State matrix and recovery

| Web fixture state | Flutter basis | Required Tasks behavior |
|---|---|---|
| `ready` | Normal idle list/board | Full page, deterministic fixture tasks, initial `GET /tasks -> 200` receipt |
| `loading` | Empty controller while loading (`tasks_view.dart:395-403`; `tasks_kanban_view.dart:31-36`) | `page-state-loading`; inspection copy only, mutations unavailable |
| `empty` | Loaded task list empty (`tasks_view.dart:404-425`) | `No tasks yet`; primary escape hatch focuses the create title |
| no-results (interactive ready substate) | Search/filter result empty (`tasks_view.dart:404-424,427-446`) | Explain the active constraint and allow clearing it without reload |
| `server-error` | Controller error and retry (`tasks_view.dart:91-104`; `tasks_kanban_view.dart:38-45`) | `page-state-server-error`; working `page-retry` recovers to ready and records `GET /tasks -> 200` |
| `forbidden` | Owner-only delete/collaborator failures (API citations above) | Name owner prerequisite; inspection remains possible; owner-only controls disabled |
| `unavailable` | Flutter folds service failures into error rather than a distinct enum | Name desktop task-service connection prerequisite; Retry may remain available |
| `readonly` | Calendar shadow/prod mirror inspector (`rhythm_inspector.dart:455-475,497-517`) | Keep inspection available; native fieldset disables all mutation, with source-of-truth prerequisite visible |

## Empty/error receipts

- `No tasks yet`: `Create a task above and it will settle into this workspace.` (`tasks_view.dart:409-415`).
- Search no-results: `No matching tasks` and advice to clear search (`tasks_view.dart:405-417`).
- Other hidden/filter result: `Nothing to show`; completed recovery copy when Open hides all completed tasks (`tasks_view.dart:418-424`).
- Empty time window: exact Today/Week/Month title and `All caught up! No tasks fall in this time window right now.` (`tasks_view.dart:427-445`).
- Kanban initial error: `Unable to load tasks`, server message, Retry (`tasks_kanban_view.dart:38-45`).

## Open questions / behavioral ambiguities

1. The seed asks an owner filter, but Flutter has none; should the web contract stay at Flutter parity (recommended: tag + minimum priority + Open/All + time), or is owner filtering a separately approved redesign enhancement?
2. The seed asks selected-task continuity across List and Board, but Flutter Board cards cannot open/select an inspector. The contract treats selection/deep links as a web accessibility enhancement; the lead should confirm the canonical URL shape.
3. A failed create can leave a real task inserted before optional collaborator attachment fails, while the create bar clears immediately (`tasks_repository.dart:24-39`; `rhythm_task_create_bar.dart:50-64`). The fixture contract uses two receipts and a truthful partial-failure message; production parity needs a product decision about rollback/restoration.
4. The inspector's save callback captures errors inside `TasksController` instead of throwing, so `_save` closes the modal even when a PATCH fails (`tasks_controller.dart:85-120`; `rhythm_inspector.dart:937-956`). The web should keep the editor open on failure, but that is recovery hardening beyond literal Flutter behavior.
5. API permits collaborators to PATCH shared tasks, while delete/collaborator management is owner-only (`api_server/src/controllers/tasks_controller.ts:287-345,351-430`). Confirm whether shared collaborators may complete/edit all fields or only status.

