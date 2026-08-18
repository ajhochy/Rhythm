# Projects integration wiring — issue 2005

## Route registration ask

In `src/App.tsx`, import `ProjectsPage` from `./pages/projects` and route all Projects paths to it:

```tsx
else if (route === '/projects' || route.startsWith('/projects/')) content = <ProjectsPage route={route} />;
```

Recommended canonical page-owned routes:

- `#/projects` — default Active Projects surface.
- `#/projects/templates` — template rail with selection prompt.
- `#/projects/templates/:templateId` — selected template and Template Steps.
- `#/projects/templates/:templateId/instances` — selected template's Active Projects.
- `#/projects/instances/:instanceId` — global Active Projects with that instance expanded.

Query state follows the hash path, for example `#/projects/templates/template-sunday-service?state=ready`. The page parses subpaths itself and owns query updates with `history.replaceState`.

## EndpointContract additions

Append these exact objects to `endpointContracts`. Do not add `/projects` agent-workspace/VCS endpoints; that is a different Flutter feature.

```ts
{ id: 'project-templates-list', control: 'Projects templates load / Retry / post-step refresh', method: 'GET', route: '/project-templates', handler: 'getAll', flutterSource: 'features/projects/data/projects_local_data_source.dart:15-25', test: 'issue-2005-c1,c3' },
{ id: 'project-template-create', control: 'New template', method: 'POST', route: '/project-templates', handler: 'create', flutterSource: 'features/projects/data/projects_local_data_source.dart:27-45', test: 'issue-2005-c2', payload: '{name,description?}' },
{ id: 'project-template-update', control: 'Edit template', method: 'PATCH', route: '/project-templates/:id', handler: 'update', flutterSource: 'features/projects/data/projects_local_data_source.dart:72-89', test: 'issue-2005-c2', payload: '{name?,description?}' },
{ id: 'project-template-delete', control: 'Delete template', method: 'DELETE', route: '/project-templates/:id', handler: 'remove', flutterSource: 'features/projects/data/projects_local_data_source.dart:123-129', test: 'issue-2005-c2' },
{ id: 'project-template-step-create', control: 'Add template step', method: 'POST', route: '/project-templates/:id/steps', handler: 'addStep', flutterSource: 'features/projects/data/projects_local_data_source.dart:47-70', test: 'issue-2005-c3', payload: '{title,offsetDays,offsetDescription?,sortOrder,assigneeId}' },
{ id: 'project-template-step-update', control: 'Edit template step', method: 'PATCH', route: '/project-templates/:id/steps/:stepId', handler: 'updateStep', flutterSource: 'features/projects/data/projects_local_data_source.dart:91-113', test: 'issue-2005-c3', payload: '{title?,offsetDays?,offsetDescription?,assigneeId}' },
{ id: 'project-template-step-delete', control: 'Delete template step', method: 'DELETE', route: '/project-templates/:id/steps/:stepId', handler: 'removeStep', flutterSource: 'features/projects/data/projects_local_data_source.dart:115-121', test: 'issue-2005-c3' },
{ id: 'project-instance-generate', control: 'Start Project', method: 'POST', route: '/project-templates/:id/generate', handler: 'generate', flutterSource: 'features/projects/views/projects_view.dart:2119-2165', test: 'issue-2005-c4', payload: '{anchorDate,name?}' },
{ id: 'project-instances-list', control: 'Active Projects load / Retry', method: 'GET', route: '/project-instances', handler: 'getAllInstances', flutterSource: 'features/projects/views/projects_view.dart:218-248', test: 'issue-2005-c1,c5' },
{ id: 'project-template-instances-list', control: 'Selected template Active Projects tab', method: 'GET', route: '/project-instances?templateId=:templateId', handler: 'getAllInstances', flutterSource: 'features/projects/views/projects_view.dart:566-589', test: 'issue-2005-c1,c5' },
{ id: 'project-instance-step-update', control: 'Edit / Complete / Reopen / Assign milestone', method: 'PATCH', route: '/project-instances/steps/:stepId', handler: 'updateInstanceStep', flutterSource: 'features/projects/views/projects_view.dart:250-281,591-622', test: 'issue-2005-c5,c6,c8', payload: '{title?,dueDate?,scheduledDate?,status?,notes?,assigneeId?,milestoneId?}' },
{ id: 'project-instance-delete', control: 'Delete active project', method: 'DELETE', route: '/project-instances/:id', handler: 'deleteInstance', flutterSource: 'features/projects/views/projects_view.dart:314-325,655-666', test: 'issue-2005-c9' },
{ id: 'project-instance-collaborator-add', control: 'Add project collaborator', method: 'POST', route: '/project-instances/:id/collaborators', handler: 'addCollaborator', flutterSource: 'features/tasks/data/collaborators_data_source.dart:64-71', test: 'issue-2005-c7', payload: '{userId}' },
{ id: 'project-instance-collaborator-remove', control: 'Remove project collaborator', method: 'DELETE', route: '/project-instances/:id/collaborators/:userId', handler: 'removeCollaborator', flutterSource: 'features/tasks/data/collaborators_data_source.dart:73-81', test: 'issue-2005-c7' },
{ id: 'project-milestone-create', control: 'Add milestone', method: 'POST', route: '/project-instances/:id/milestones', handler: 'createMilestone', flutterSource: 'features/projects/data/project_milestones_data_source.dart:16-37', test: 'issue-2005-c8', payload: '{title,sortOrder}' },
{ id: 'project-milestone-delete', control: 'Delete milestone', method: 'DELETE', route: '/project-instances/:id/milestones/:milestoneId', handler: 'deleteMilestone', flutterSource: 'features/projects/data/project_milestones_data_source.dart:39-47', test: 'issue-2005-c8' },
```

Do not add `GET /project-instances/:id`: Flutter hydrates selected instances from the collection response. Do not add `GET /project-instances/:id/collaborators`: Flutter receives collaborators embedded in instance loads and reloads the collection after changes. Do not add milestone `GET`/`PATCH`, direct `POST /project-instances`, or instance `PATCH {goalId}` unless a future approved UI exposes those controls.

## Exact visible receipts

The page ledger (`data-testid="page-trace"`) appends receipts:

- Templates load/reload: `GET /project-templates → 200`.
- Global instances load/reload: `GET /project-instances → 200`.
- Scoped instances load/reload: `GET /project-instances?templateId=:templateId → 200`.
- Create/edit/delete template: `POST /project-templates {name,description} → 201`, `PATCH /project-templates/:id {name,description} → 200`, `DELETE /project-templates/:id → 204`.
- Add/edit/delete template step: exact nested routes above with `201`, `200`, and `204`; controller reload may append `GET /project-templates → 200`.
- Start Project: `POST /project-templates/:id/generate {anchorDate,name} → 201`.
- Complete/reopen: `PATCH /project-instances/steps/:stepId {status,assigneeId} → 200`.
- Inspector save: `PATCH /project-instances/steps/:stepId {title,notes,dueDate,scheduledDate,assigneeId} → 200`.
- Add/remove collaborator: exact `POST ... {userId} → 201` and `DELETE .../:userId → 204`; subsequent collection reload is also visible.
- Add/delete milestone: exact `POST ... {title,sortOrder} → 201` and `DELETE .../:milestoneId → 204`.
- Assign/ungroup step: `PATCH /project-instances/steps/:stepId {milestoneId} → 200`.
- Delete active project: `DELETE /project-instances/:id → 204`.

Client-only mode/tab changes, selection, expansion, Show completed, dialog open/cancel/close, date selection, and preview calculation never append fake receipts.

## Cross-page consistency

- Dashboard project cards navigate to `#/projects/instances/:instanceId` when an id is known; the generic Projects shortcut uses `#/projects`. Dashboard project-step completion and Projects completion share the same `project-instance-step-update` contract and fixture IDs.
- Planner project steps should deep-link to `#/projects/instances/:instanceId` and use the same derived status semantics.
- Tasks may display project-source metadata but must not mutate project collaborators or milestones.
- The API `/projects` family belongs to agent workspace/VCS setup in Agents, not this page. Keep endpoint IDs and fixture types explicitly named `project-template` or `project-instance` to prevent collision.
- Page-local fixtures use stable IDs including `template-sunday-service`, `instance-sunday-service-2026-08-16`, `step-final-run-sheet`, and `milestone-service-ready`. They also include `template-weekend-service`, `instance-weekend-service-2026-08-23`, and completed `step-weekend-volunteer-check-in` context so Dashboard's `project-progress-weekend-service` card and Planner project steps read as one coherent fixture story. The seed includes one long Arabic/CJK/emoji title, owned and collaborator metadata, open/done steps, grouped/ungrouped steps, and a fully done instance.

## Approved web adaptations

- `#/projects` opens a hydrated Active Projects surface and records `GET /project-instances → 200` immediately. This deliberately replaces Flutter's initial manual Load panel (`projects_view.dart:35-41,170-180,1001-1020`) for a web-ready default. `Refresh projects` remains explicit and appends the same exact collection receipt.
- Every entity deletion uses a target-named confirmation. Cancel preserves the template, template step, milestone, or instance; Confirm alone appends its exact DELETE receipt. This hardens Flutter's immediate instance and milestone deletion, while keeping the source routes unchanged (`projects_view.dart:1236-1244,1324-1328,314-325,655-666`). Fixture failures and matrix error states remain visible instead of reproducing Flutter's swallowed failures.
- Instance status is derived only from step completion. No direct instance status or archive control is exposed (`project_instances_repository.ts:185-200,317-329,861-871`; `project_instances_routes.ts:12`).
- Template steps display chronologically by `offsetDays`. Their stored `sortOrder` remains visible as server context but has no reorder affordance (`projects_view.dart:672-674,1484-1550,2011-2025`).
- The readonly mutation fieldset carries both native `disabled` and `aria-disabled="true"`; inspection controls remain outside the gate and enabled.

## Shared UI asks

None. Reuse the existing Shell navigation, button/menu/dialog/state-panel/trace/focus patterns and tokens. Projects-specific timeline, compact rail, and responsive styling stays page-local.

## Lead decisions resolved for implementation

The route scheme is approved. Hydrated Active Projects, confirmation hardening, chronological `offsetDays`, stored-but-unused `sortOrder`, and derived-only instance status are implemented as specified above. The lead only needs to register the route and append the endpoint contracts.
