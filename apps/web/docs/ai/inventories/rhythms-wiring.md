# Rhythms integration wiring — issue 2004

## Route registration ask

In lead-owned `src/App.tsx`, import `RhythmsPage` from `./pages/rhythms` and route every Rhythms path to it:

```tsx
else if (route === '/rhythms' || route.startsWith('/rhythms/')) content = <RhythmsPage route={route} />;
```

Recommended page-owned routes:

- `#/rhythms` — canonical collection.
- `#/rhythms/rule/:ruleId` — collection plus selected-rule detail.
- `#/rhythms/rule/:ruleId/edit` — selected rule with the edit dialog open.
- Query state follows the hash path, e.g. `#/rhythms/rule/rhythm-weekend-service?state=readonly`. `RhythmsPage` owns sub-path and query parsing plus `history.replaceState` for state changes.

Flutter has only shell index 3 and in-place edit dialogs, so these web deep links are deterministic selection/accessibility adaptations (`app/core/constants/app_constants.dart:5-15`; `app/core/layout/app_shell.dart:322-345`; `features/rhythms/views/rhythms_view.dart:197-305`). Selection should use the already-loaded collection and must not fabricate a `GET /recurring-rules/:id` receipt.

## `EndpointContract` additions

These objects are ready to append to lead-owned `src/endpointMap.ts`:

```ts
{ id: 'rhythms-list', control: 'Rhythms page load / Retry', method: 'GET', route: '/recurring-rules', handler: 'getAll', flutterSource: 'features/rhythms/data/rhythms_data_source.dart:15-25', test: 'issue-2004-c1,issue-2004-c11' },
{ id: 'rhythms-workspace-members', control: 'Workflow-step assignee / collaborator candidates', method: 'GET', route: '/workspaces/me/members', handler: 'listMembers', flutterSource: 'app/core/workspace/workspace_data_source.dart:41-51', test: 'issue-2004-c4,issue-2004-c7,issue-2004-c11' },
{ id: 'rhythms-create', control: 'New rule / Create', method: 'POST', route: '/recurring-rules', handler: 'create', flutterSource: 'features/rhythms/data/rhythms_data_source.dart:39-65', test: 'issue-2004-c4', payload: '{title,frequency,dayOfWeek?,dayOfMonth?,month?,sequential,steps}' },
{ id: 'rhythms-update', control: 'Edit rule / Enable / Pause', method: 'PATCH', route: '/recurring-rules/:id', handler: 'update', flutterSource: 'features/rhythms/data/rhythms_data_source.dart:67-96', test: 'issue-2004-c5,issue-2004-c6', payload: '{title?,frequency?,dayOfWeek?,dayOfMonth?,month?,enabled?,sequential?,steps?}' },
{ id: 'rhythms-delete', control: 'Delete rule confirmation', method: 'DELETE', route: '/recurring-rules/:id', handler: 'remove', flutterSource: 'features/rhythms/data/rhythms_data_source.dart:98-104', test: 'issue-2004-c8' },
{ id: 'rhythms-collaborator-add', control: 'Selected rule Add collaborator (issue-seed addition)', method: 'POST', route: '/recurring-rules/:id/collaborators', handler: 'addCollaborator', flutterSource: 'features/rhythms/data/rhythms_data_source.dart:106-113', test: 'issue-2004-c7', payload: '{userId}' },
{ id: 'rhythms-collaborator-remove', control: 'Selected rule Remove collaborator (issue-seed addition)', method: 'DELETE', route: '/recurring-rules/:id/collaborators/:userId', handler: 'removeCollaborator', flutterSource: 'features/rhythms/data/rhythms_data_source.dart:115-121', test: 'issue-2004-c7' },
```

Do not add page contracts for these registered-but-unused routes:

- `GET /users`: `RhythmsDataSource.fetchUsers` and `RhythmsRepository.getUsers` are not called; `RhythmsView` loads workspace members instead (`features/rhythms/data/rhythms_data_source.dart:27-37`; `features/rhythms/repositories/rhythms_repository.dart:10-13`; `features/rhythms/views/rhythms_view.dart:24-30`).
- `GET /recurring-rules/:id`: selected detail is derived from the loaded collection.
- `GET /recurring-rules/:id/collaborators`: the decorated rule already contains collaborators, and Flutter has no collaborator fetch method.
- `POST /recurring-rules/:id/steps`: Flutter create/edit submits the full `steps` array through POST/PATCH instead.

If the lead intentionally adds a collaborator refresh action later, add a separate GET contract then; do not emit a fake GET receipt after remove in issue 2004.

## Exact visible receipts

The page ledger (`data-testid="page-trace"`) appends exact fixture receipts:

- Initial load / Retry: `GET /recurring-rules → 200`.
- Workspace people load: `GET /workspaces/me/members → 200`.
- Create: `POST /recurring-rules {title,frequency,<active schedule>,sequential,steps} → 201`.
- Edit: `PATCH /recurring-rules/:id {title,frequency,<active schedule>,sequential,steps} → 200`.
- Enable/pause: `PATCH /recurring-rules/:id {enabled:false|true} → 200`.
- Add collaborator: `POST /recurring-rules/:id/collaborators {userId} → 200` (the API controller does **not** return 201).
- Remove collaborator: `DELETE /recurring-rules/:id/collaborators/:userId → 204`.
- Delete: `DELETE /recurring-rules/:id → 204`.

Card selection, deep-link parsing, dialog/menu open/close/cancel, unsaved step changes, and client validation never append receipts. There are no Flutter search/filter/sort controls, so do not add either controls or fake query receipts.

## Cross-page consistency

- Dashboard’s Rhythms shortcut remains `/rhythms`. If Dashboard later deep-links a specific rhythm, use `/rhythms/rule/:ruleId` and coordinate the same deterministic rule id.
- Generated tasks must use `sourceType: "recurring_rule"` and `sourceId` equal to the rule id or prefixed with `<ruleId>:` for a step. Coordinate those ids with Tasks and Planner fixtures so generated counts/next due do not contradict their visible rows (`api_server/src/controllers/recurring_rules_controller.ts:315-318`).
- Deleting a rule must not remove already-generated task fixtures; the Flutter confirmation promises that explicitly (`features/rhythms/views/rhythms_view.dart:307-316`). Pausing/editing may deterministically recompute future-open counts because the API deletes/rebuilds that lookahead (`api_server/src/controllers/recurring_rules_controller.ts:122-131`).
- Step assignees and collaborator candidates use the shared workspace-member identity set. Settings owns membership/roles; Rhythms only selects existing members.
- Goal linkage exists in the server model but is not exposed by Flutter Rhythms create/edit. Projects/Goals owners should not add a Goal selector to this page without a separate approved behavior change.
- Shared-rule collaborator management is owner-only. Per lead review, collaborator-visible non-owners are inspect-only in the prototype: Edit, Enable/Pause, Delete, and collaborator mutations are disabled with an accessible owner prerequisite. The API currently allows collaborator-visible users to PATCH/DELETE a rule; that is a documented permission defect and is deliberately not replicated.

## Shared style / icon asks

None. Keep all Rhythms styles page-local under `.pg-rhythms`, reuse existing mineral tokens/button/searchless list/dialog/state/trace patterns, and use existing icons or text rather than editing `src/icons.tsx` or `src/styles.css`.

## Lead decisions resolved for implementation

1. Owner-only collaborator add/remove is approved as an issue-seed addition. This remains a prominent Flutter parity gap: the shipping view/controller/repository do not expose the controls, although the model, data source, and API support them.
2. Generated count, completion detail, waiting person, and next due are approved for selected detail; they are returned by the API but not rendered by shipping Flutter.
3. Shared collaborators are inspect-only. The API's looser PATCH/DELETE permission is treated as a defect, not UI behavior to copy.
4. `/rhythms/rule/:id[/edit]` is canonical. Unknown ids render an in-page not-found state with a Back to rhythms escape.
5. The orphaned `GET /users` and unused rule-detail, collaborator-list, and step routes remain omitted from `EndpointContract` additions.
