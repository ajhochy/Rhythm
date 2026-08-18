# Tasks integration wiring — issue 2003

## Route registration ask

In `src/App.tsx`, import `TasksPage` from `./pages/tasks` and route every Tasks path to it:

```tsx
else if (route === '/tasks' || route.startsWith('/tasks/')) content = <TasksPage route={route} />;
```

Approved page-owned deep links:

- `#/tasks` — canonical list view.
- `#/tasks/list` and `#/tasks/board` — explicit presentation links.
- `#/tasks/task/:taskId` — list plus selected task inspector.
- `#/tasks/board/task/:taskId` — board plus the same selected task inspector.
- Query state remains after the hash path, for example `#/tasks/board/task/task-service-handoff?state=ready&tag=worship&priority=3`. The page owns parsing and `history.replaceState`; Shell only receives the path.

The lead approved the path-based scheme above. The page parses selection and presentation from its `route` prop and keeps filters in query parameters; do not add the alternative query-only canonical format.

## EndpointContract additions

These objects are ready to append to `endpointContracts`. `flutterSource` uses the actual checked-out Flutter path (the task prompt's `lib/app/features/tasks` path is stale).

```ts
{ id: 'tasks-list', control: 'Tasks page load / Retry', method: 'GET', route: '/tasks', handler: 'getAll', flutterSource: 'features/tasks/data/tasks_local_data_source.dart:14-24', test: 'issue-2003-c1' },
{ id: 'tasks-create', control: 'Add task / Create follow-up task', method: 'POST', route: '/tasks', handler: 'create', flutterSource: 'features/tasks/data/tasks_local_data_source.dart:26-55', test: 'issue-2003-c4', payload: '{title,notes?,scheduledDate?,preferredAgent:null}' },
{ id: 'tasks-update', control: 'Save task / Complete / Reopen / Move board card', method: 'PATCH', route: '/tasks/:id', handler: 'update', flutterSource: 'features/tasks/data/tasks_local_data_source.dart:58-100', test: 'issue-2003-c3,c5,c6', payload: '{title?,notes?,dueDate?,scheduledDate?,status?,preferredAgent?,energy?}' },
{ id: 'tasks-delete', control: 'Delete task', method: 'DELETE', route: '/tasks/:id', handler: 'remove', flutterSource: 'features/tasks/data/tasks_local_data_source.dart:112-118', test: 'issue-2003-c8' },
{ id: 'task-collaborators-list', control: 'Task collaborator refresh after remove', method: 'GET', route: '/tasks/:id/collaborators', handler: 'getCollaborators', flutterSource: 'features/tasks/data/collaborators_data_source.dart:17-27', test: 'issue-2003-c7' },
{ id: 'task-collaborators-add', control: 'Create with collaborator / Add collaborator', method: 'POST', route: '/tasks/:id/collaborators', handler: 'addCollaborator', flutterSource: 'features/tasks/data/collaborators_data_source.dart:29-40', test: 'issue-2003-c7', payload: '{userId}' },
{ id: 'task-collaborators-remove', control: 'Remove task collaborator', method: 'DELETE', route: '/tasks/:id/collaborators/:userId', handler: 'removeCollaborator', flutterSource: 'features/tasks/data/collaborators_data_source.dart:42-48', test: 'issue-2003-c7' },
{ id: 'project-instance-collaborators-list', control: 'Project inspector collaborator list (cross-page; not a Tasks control)', method: 'GET', route: '/project-instances/:id/collaborators', handler: 'getCollaborators', flutterSource: 'features/tasks/data/collaborators_data_source.dart:50-62', test: 'projects:collaborators' },
{ id: 'project-instance-collaborators-add', control: 'Project inspector add collaborator (cross-page; not a Tasks control)', method: 'POST', route: '/project-instances/:id/collaborators', handler: 'addCollaborator', flutterSource: 'features/tasks/data/collaborators_data_source.dart:64-71', test: 'projects:collaborators', payload: '{userId}' },
{ id: 'project-instance-collaborators-remove', control: 'Project inspector remove collaborator (cross-page; not a Tasks control)', method: 'DELETE', route: '/project-instances/:id/collaborators/:userId', handler: 'removeCollaborator', flutterSource: 'features/tasks/data/collaborators_data_source.dart:73-81', test: 'projects:collaborators' },
```

Do not add `GET /tasks/:id` for the Tasks page unless the selected-task deep link is changed to hydrate directly. Flutter Tasks loads the collection once and opens the selected object from controller state. Do not add API query routes to client-side search/filter/sort receipts: Flutter performs those operations locally.

## Exact visible receipts

The page ledger (`data-testid="page-trace"`) must append, not replace, receipts. Expected status codes are verified by the API controllers.

- Load/Retry: `GET /tasks -> 200`.
- Create: `POST /tasks {title,notes,scheduledDate,preferredAgent} -> 201` (omit optional keys when absent; `preferredAgent` is null on the Flutter create path).
- Create with collaborator: append `POST /tasks/:id/collaborators {userId} -> 201` after the create receipt.
- Edit: `PATCH /tasks/:id {title,notes,dueDate,scheduledDate,preferredAgent,energy} -> 200`.
- Complete/reopen/Board move: `PATCH /tasks/:id {status} -> 200`.
- Add collaborator: `POST /tasks/:id/collaborators {userId} -> 201`.
- Remove collaborator: `DELETE /tasks/:id/collaborators/:userId -> 204`, then `GET /tasks/:id/collaborators -> 200`.
- Delete: `DELETE /tasks/:id -> 204`.

Client-only controls—search, tag, minimum priority, Open/All, time window, List/Board, sort, modal open/close/cancel, and date-picker opening—must never append fake endpoint receipts.

## Cross-page consistency

- Projects owns project-instance collaborator UI. Tasks may show a project source/feed but must not call project collaborator routes for a task record.
- Inspector quick actions reuse the existing `create-session` endpoint contract and navigate to `#/agents`; do not duplicate the Agents contract. The fixture implementation calls the shared store's `createSession`, records `POST /agent-sessions {cwd,name,agentId,mcpRole,taskId} → 201`, then navigates. `Create follow-up tasks` additionally uses the `tasks-create` contract.
- A project/recurring source name is display-only on Tasks. No editable Project, Goal, Owner, or Assignee field should be added without a separate approved behavior change.
- The Shell Tasks tab already navigates to `/tasks`; no Shell edit should be necessary.
- Keep all fixtures page-local. Use stable IDs such as `task-service-handoff`, `task-livestream-fallback`, and collaborator user id `7` so receipts and deep links remain deterministic.

## Shared UI asks

None. Use existing buttons, menus, search, dialog, state-panel, trace, token, and focus patterns. Any Tasks-specific responsive Kanban or inspector styling stays in `src/pages/tasks/styles.css`.

## Approved web adaptations and permission semantics

1. **Intentional accessibility adaptation:** Board cards are selectable and keyboard-operable with Enter/Space in addition to retaining drag status movement. Flutter Board is drag-only (`features/tasks/views/tasks_kanban_view.dart:206-222,258-340`); the web adaptation provides an inspector path and preserves selected-task continuity across List and Board.
2. **Real API permissions:** collaborators may edit and complete shared tasks. Delete and collaborator add/remove remain owner-only (`api_server/src/controllers/tasks_controller.ts:287-345,351-430`). The seed includes `task-shared-with-me`, owned by Morgan Lee, with delete and collaborator-management controls natively disabled and tied to visible owner-prerequisite copy.
3. **Filter correction confirmed:** Flutter's tag, minimum-priority, Open/All, and date-window controls supersede the seed owner filter. No owner filter is implemented.
