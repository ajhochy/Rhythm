# Dashboard wiring note — issue 2001

## Route registration ask

Register `DashboardPage` for exact route `/dashboard` in `src/App.tsx` and pass the current route:

```tsx
if (route === '/dashboard') content = <DashboardPage route={route} />;
```

The shipping Flutter shell starts on Dashboard because `_selectedIndex` is `0` and `navDashboard` is `0` (`app_shell.dart:77`; `app_constants.dart:6`). The current prototype intentionally routes bare `/` to Agents. Preserve that compatibility baseline: Dashboard is registered at `/dashboard` only, with no redirect or bare-route change.

Dashboard shortcuts must use the shell’s established hash routes: Planner `/planner`, Projects `/projects`, Messages `/messages`, and fixture thread `/messages/thread-weekend-team`. Coordinate the last slug with the Messages owner.

## `EndpointContract` additions

Ready-to-merge objects for `src/endpointMap.ts` (lead-owned). These are the endpoints represented by Dashboard load/mutation controls and its imported task/message interactions:

```ts
{ id: 'dashboard-summary', control: 'Dashboard initial load / Refresh / Retry', method: 'GET', route: '/dashboard/summary', handler: 'getDashboardSummary', flutterSource: 'dashboard_data_source.dart:fetchSummary', test: 'issue-2001-c3: refresh and deterministic state matrix recover without reload' },
{ id: 'dashboard-project-instances', control: 'Dashboard project-step enrichment / Refresh', method: 'GET', route: '/project-instances', handler: 'listProjectInstances', flutterSource: 'dashboard_data_source.dart:fetchProjectInstances', test: 'issue-2001-c3: refresh and deterministic state matrix recover without reload' },
{ id: 'dashboard-create-task', control: 'Dashboard Add task', method: 'POST', route: '/tasks', handler: 'createDashboardTask', flutterSource: 'dashboard_data_source.dart:createTask', test: 'issue-2001-c5: add task validates and applies scheduling and collaborator selections', payload: '{title,notes?,scheduledDate?}' },
{ id: 'dashboard-task-collaborators-list', control: 'Dashboard task inspector collaborators', method: 'GET', route: '/tasks/:id/collaborators', handler: 'listDashboardTaskCollaborators', flutterSource: 'collaborators_data_source.dart:fetchForTask', test: 'issue-2001-c4: every enabled Dashboard control has an outcome and dialogs restore focus' },
{ id: 'dashboard-task-collaborator-add', control: 'Dashboard create bar / task inspector Add collaborator', method: 'POST', route: '/tasks/:id/collaborators', handler: 'addDashboardTaskCollaborator', flutterSource: 'dashboard_data_source.dart:addCollaboratorToTask', test: 'issue-2001-c5: add task validates and applies scheduling and collaborator selections', payload: '{userId}' },
{ id: 'dashboard-task-collaborator-remove', control: 'Dashboard task inspector Remove collaborator', method: 'DELETE', route: '/tasks/:id/collaborators/:userId', handler: 'removeDashboardTaskCollaborator', flutterSource: 'collaborators_data_source.dart:removeFromTask', test: 'issue-2001-c4: every enabled Dashboard control has an outcome and dialogs restore focus' },
{ id: 'dashboard-update-task', control: 'Dashboard task completion / Save changes', method: 'PATCH', route: '/tasks/:id', handler: 'updateDashboardTask', flutterSource: 'dashboard_data_source.dart:updateTask', test: 'issue-2001-c6: task completion updates the row and summary with the exact PATCH receipt', payload: '{status?}|{title?,notes?,dueDate?,scheduledDate?,preferredAgent?,energy?}' },
{ id: 'dashboard-update-project-step', control: 'Dashboard project-step completion / Save changes', method: 'PATCH', route: '/project-instances/steps/:stepId', handler: 'updateDashboardProjectStep', flutterSource: 'dashboard_data_source.dart:updateProjectInstanceStep', test: 'issue-2001-c7: project-step completion updates only its project and summary', payload: '{status?}|{title?,notes?,dueDate?,scheduledDate?,assigneeId?}' },
{ id: 'dashboard-thread-mark-read', control: 'Dashboard unread thread shortcut', method: 'POST', route: '/message-threads/:id/read', handler: 'markDashboardThreadRead', flutterSource: 'messages_data_source.dart:markRead', test: 'issue-2001-c8: Planner Projects Messages and thread shortcuts use exact routes' },
{ id: 'dashboard-thread-messages', control: 'Dashboard unread thread shortcut', method: 'GET', route: '/message-threads/:id/messages', handler: 'loadDashboardThreadMessages', flutterSource: 'messages_data_source.dart:getMessages', test: 'issue-2001-c8: Planner Projects Messages and thread shortcuts use exact routes' },
{ id: 'dashboard-thread-list-refresh', control: 'Dashboard unread thread shortcut', method: 'GET', route: '/message-threads', handler: 'refreshDashboardMessageThreads', flutterSource: 'messages_data_source.dart:getThreads', test: 'issue-2001-c8: Planner Projects Messages and thread shortcuts use exact routes' },
```

Expected receipts use `→ 200` for reads/patches, `POST /tasks → 201`, `POST /tasks/:id/collaborators → 201`, `DELETE /tasks/:id/collaborators/:userId → 204`, and `POST /message-threads/:id/read → 204`. The page ledger remains fixture-only and never performs these requests.

Do not add Dashboard contracts for recurring rules, project templates, project creation, raw task listing, or raw thread listing solely because `DashboardRepository` exposes them. `DashboardController.load()` uses summary plus project instances; those other methods are not mounted controls (`dashboard_repository.dart:16-30`; `dashboard_controller.dart:90-143`).

Quick Actions are a special fixture boundary. Flutter launches agent sessions and, for Follow-up, creates a task (`quick_actions_bar.dart:164-269`), but issue 2001 requires a client-side handoff. Record it as `client-side` in the page UI, not as a synthetic endpoint receipt. Existing Agents endpoint contracts remain authoritative if the lead later wires handoff consumption.

The fixture intentionally populates `DashboardProjectProgress.nextStep` and gives the Next shortcut a working inspector outcome. Flutter declares `nextStep`/`nextStepTitle` but omits them from `DashboardProjectProgress.fromJson` (`dashboard_overview_models.dart:217-275`); that parser gap is a shipping defect, not intended behavior for the prototype.

## Cross-page consistency

- Keep the Dashboard unread fixtures consistent with the shell badge: six unread threads/count in aggregate. The ready Dashboard may preview only the newest subset, matching Flutter’s preview behavior.
- Use `/messages/thread-weekend-team` for the seeded Weekend Team preview in both Dashboard and Messages, or update both owners/contracts together.
- Planner rows and progress cards navigate to `/planner`; the Flutter name is “Weekly Planner,” while the web shell route key is `planner`.
- Projects owns project detail routing; Dashboard only requires `/projects` from the progress card.
- The visual reference contains shared live-artifact tabs. Do not duplicate them inside `DashboardPage`; the shared shell/artifact owner controls that surface.

## Shared style/icon asks

None required. Keep Dashboard CSS page-local under `.pg-dashboard` and reuse existing buttons, badges, state-panel, tokens, and focus styles. If an icon is unavailable, use text or an existing icon rather than editing `src/icons.tsx`.
