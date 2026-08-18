# Planner wiring note — issue 2002

## Route registration ask

Register `PlannerPage` from `src/pages/planner/index.tsx` in lead-owned `src/App.tsx`:

```tsx
else if (route === '/planner') content = <PlannerPage route={route} />;
```

The primary route is `#/planner`. Preserve the selected week as `#/planner?week=2026-W33`; there is no Flutter sub-route, so do not add `/planner/week/...`. Week navigation should use `history.replaceState` for the `week` query and preserve any `state` fixture query. Invalid/missing week values deterministically fall back to the fixed-now week `2026-W33`.

Shell consistency: the existing Planner nav target should resolve to `/planner`, and Dashboard's “Open planner” actions should use the same route. Flutter establishes Planner as a primary shell destination and Dashboard cross-link (`navigation_sidebar.dart:22-43`; `app_shell.dart:329-338`).

## Ready-to-merge `EndpointContract` additions

Add these objects to lead-owned `src/endpointMap.ts`. IDs are Planner-prefixed to avoid colliding with future Tasks/Projects page contracts.

```ts
{ id: 'planner-get-week', control: 'Initial load / Previous week / Next week / Today / Retry', method: 'GET', route: '/weekly-plan?week=:week', handler: 'getWeeklyPlan', flutterSource: 'weekly_plan_data_source.dart:16-24', test: 'planner:week-navigation-state' },
{ id: 'planner-schedule-task', control: 'Drag an already-dated task to a day', method: 'PATCH', route: '/weekly-plan/tasks/:id', handler: 'schedulePlannerTask', flutterSource: 'weekly_plan_data_source.dart:27-43', test: 'planner:schedule-task', payload: '{scheduledDate,locked:false,scheduledOrder?}' },
{ id: 'planner-update-task', control: 'Schedule backlog task / edit notes and dates / complete / reorder', method: 'PATCH', route: '/tasks/:id', handler: 'updatePlannerTask', flutterSource: 'weekly_plan_data_source.dart:46-89', test: 'planner:update-complete-task', payload: '{notes?,status?,dueDate?,scheduledDate?,scheduledOrder?}' },
{ id: 'planner-update-project-step', control: 'Schedule / edit / complete project step', method: 'PATCH', route: '/project-instances/steps/:id', handler: 'updatePlannerProjectStep', flutterSource: 'weekly_plan_data_source.dart:55-88', test: 'planner:project-step-receipt', payload: '{notes?,status?,dueDate?}' },
{ id: 'planner-create-task', control: 'Add unscheduled task / Add task to day / Create follow-up task', method: 'POST', route: '/tasks', handler: 'createPlannerTask', flutterSource: 'tasks_local_data_source.dart:26-55', test: 'planner:create-task', payload: '{title,notes?,dueDate?,scheduledDate?,preferredAgent?,energy?}' },
{ id: 'planner-list-task-collaborators', control: 'Refresh collaborators after removal', method: 'GET', route: '/tasks/:id/collaborators', handler: 'listPlannerTaskCollaborators', flutterSource: 'collaborators_data_source.dart:17-27', test: 'planner:task-collaborators' },
{ id: 'planner-add-task-collaborator', control: 'Add collaborator', method: 'POST', route: '/tasks/:id/collaborators', handler: 'addPlannerTaskCollaborator', flutterSource: 'collaborators_data_source.dart:29-39', test: 'planner:task-collaborators', payload: '{userId}' },
{ id: 'planner-remove-task-collaborator', control: 'Remove collaborator', method: 'DELETE', route: '/tasks/:id/collaborators/:userId', handler: 'removePlannerTaskCollaborator', flutterSource: 'collaborators_data_source.dart:42-47', test: 'planner:task-collaborators' },
```

Important endpoint notes:

- Flutter sends `scheduledOrder` in the weekly scheduling body, but `WeeklyPlanController.scheduleTask` currently ignores it (`weekly_plan_controller.ts:69-81`). Keep it in the contract because receipts represent the Flutter-emitted request; do not imply the API persisted it.
- `POST /tasks` returns 201 (`tasks_controller.ts:228-254`); all PATCH and GET families above return 200; collaborator DELETE returns 204 (`tasks_controller.ts:418-430`).
- Do not add a Planner-specific agent-session contract. The shared inspector's quick actions reuse the existing `create-session` and `session-input` contracts (`quick_actions_bar.dart:164-205`). In this fixture-only prototype, those controls must render a local handoff state or be disabled with an explicit prerequisite—never perform a network call.
- Workspace-member loading is page setup for collaborator choices, not one of issue 2002's requested mutation families. Fixtures should seed local members; do not add runtime `GET /workspaces/me/members` behavior.

## Cross-page consistency notes

- Tasks created/edited/completed in Planner are page-local fixture mutations in this issue. If the lead later centralizes Tasks and Planner fixtures, keep identical IDs and source metadata so `/tasks` and `/planner` can share records without divergent status/date semantics.
- Project steps are source-owned by Projects. Planner may change only the fields Flutter actually routes: notes, due date, and status. Do not allow task-only energy/preferred-agent/collaborator mutations on a project step without a product decision.
- Calendar shadow events are inspect-only context: no drag, completion, edit, collaborator, or quick-action control.
- Open/All, selection, Clear, dialog open/close, week-query changes, and deterministic agent handoffs are client-side. They must not add fake endpoint entries or `page-trace` rows.
- The fixed fixture week is `2026-W33` (2026-08-10 through 2026-08-16), with Wednesday 2026-08-12 marked Today. Previous and next fixtures must be deterministic `2026-W32` and `2026-W34` plans rather than cloned date labels.
- Use the existing mineral tokens/classes only. Planner's hierarchy should favor hairline day dividers, compact task rows/cards, restrained turquoise selection/today accents, mono operational dates/counts, and the same dark/light token behavior as `../rhythm-dashboard-redesign.html`. No shared style or icon addition is required; page-local CSS can cover the board.

## Shared-file asks only

1. Register `/planner` in `src/App.tsx` and ensure Shell/Dashboard Planner links target it.
2. Append the eight `EndpointContract` objects above to `src/endpointMap.ts`.
3. No changes are requested to `src/styles.css`, `src/icons.tsx`, `src/store.tsx`, `src/fixtures.ts`, `src/types.ts`, or `tests/helpers.ts`.

