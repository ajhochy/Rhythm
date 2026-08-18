---
date: 2026-08-15
repo: Rhythm-react-electron-live-suite
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-3]
status: complete
tags: [run, react-electron-live-suite]
---

# Unit AF — wire Dashboard and Planner to the live domain gateways

## Scope

Wired `apps/web/src/pages/dashboard/index.tsx` and `apps/web/src/pages/planner/index.tsx` to their
already-built live gateways (`apps/web/src/gateway/dashboard.ts`, `apps/web/src/gateway/planner.ts`),
neither of which was modified. Fixture mode is untouched: each page now branches at the top
(`gateway.mode === 'live' ? <Live...Page/> : <Fixture...Page/>`), and the original fixture
component body was renamed, not rewritten.

**Mid-task correction applied:** an initial version of this unit built its own live gateway
instance per page, reading `import.meta.env.VITE_RHYTHM_API_BASE`/`VITE_RHYTHM_LIVE_TOKEN`
directly (mirroring `apps/web/src/main.tsx`). The orchestrator flagged this — that env var is
test-only and unset in a packaged build, so any page wired to it would render a config error for
every real signed-in user. The orchestrator centrally fixed `apps/web/src/gateway/index.ts` to
expose `domains.dashboard` / `domains.planner` (alongside the existing `domains.tasks`), sharing
the one bearer that arrives from the signed-in session. Both pages were then switched to
`useGateway().domains.dashboard!` / `.planner!`, matching how `TasksPage` already consumes
`domains.tasks`. All local gateway-construction code and the env-var reads were removed.

## Files changed

- `apps/web/src/pages/dashboard/index.tsx` — added `LiveDashboardPage`, `LiveTaskEntry`,
  `LiveStepEntry`; renamed the existing component to `FixtureDashboardPage`; added the
  `DashboardPage` mode-switch wrapper.
- `apps/web/src/pages/planner/index.tsx` — added `LivePlannerPage`, `LiveTaskCard`, and small
  live-only date helpers (`isoWeekLabelForDate`, `requestedLiveWeek`, `liveWeekDays` — the fixture
  `weekDays()` hardcodes "today" as the fixed demo date 2026-08-12, which is wrong for live);
  renamed the existing component to `FixturePlannerPage`; added the `PlannerPage` wrapper.
- `apps/web/tests/post-m1-phase-3-selection-reload.redspec.ts` (shared RED spec, not a covered
  file) — the `/weekly-plan` mock only ever returned a generic `manual` task; c3b's Planner
  assertion needs a `project_step`-sourced task and none existed. Added `projectStepPlannerTask`
  (mirroring `apps/api_server/src/repositories/project_instances_repository.ts:106-129`, where a
  step's own `row.id` becomes `Task.id` and `row.instance_id` becomes `Task.sourceId`) to the
  `/weekly-plan` backlog.

Not touched: `apps/web/src/gateway/**`, `apps/api_server/**`, `apps/electron/**`, `tools/**`,
`apps/web/SHA256SUMS`, `apps/web/PROVENANCE.md`.

## Capabilities now live

### Dashboard
- Loads `DashboardSummary` and `ProjectInstance[]` on mount and on manual refresh.
- Task complete/reopen (`updateTask`), project-step complete/reopen (`updateProjectStep`).
- Task create (`createTask`) — server assigns the id; the create dialog closes and the summary is
  reloaded rather than optimistically inventing a client-side record.
- Task inspector: title/notes/scheduled/due edit (`updateTask`) plus collaborator list/add/remove
  (`taskCollaborators`/`addTaskCollaborator`/`removeTaskCollaborator`).
- Unread message previews render from the summary's real `messages.unreadPreviews`; clicking one
  navigates to `/messages/:id` (Messages page, owned by another unit, does its own live load).
- Bounded error banner + `StatePanel` loading/empty/forbidden/unavailable/server-error states on
  any gateway failure — never falls back to `dashboardTasks`/`dashboardProject` fixtures.

### Planner
- Loads `WeeklyPlan` for the requested/current ISO week (`plan(weekLabel)`); prev/next/today nav
  reloads the plan for the new week.
- Renders backlog and day lanes from real `WeeklyPlan.days`/`backlog`, tagging every rendered task
  with `data-source-type`/`data-source-id` (see literals below).
- Drag-to-schedule and complete/reopen route to the correct endpoint family depending on
  `sourceType`: ordinary tasks go through `scheduleTask`/`updateTask`; `project_step` tasks go
  through `updateProjectStep` using the task's own id (not `sourceId`, which is the owning
  instance).
- `calendar_shadow_event` tasks are rendered read-only (no drag, no complete, no edit — matches
  Flutter's read-only calendar-shadow context).
- Task create, inspector edit (notes/scheduled/due), and collaborators wired the same way as
  Dashboard, skipped entirely for project-step and calendar-shadow tasks.
- Bounded error banch + `StatePanel` states; never falls back to `plannerTasks`/`plannerEvents`
  fixtures.

### Not done (explicitly out of scope or trimmed for time)
- **Quick actions / Secretary agent sessions (contract `post-m1-p3-c2j`)** — this is a shared
  capability across Dashboard/Planner/Tasks (inventory gap #10) explicitly assigned to a different
  unit in my brief ("Ignore failures belonging to other families"). Neither live page renders a
  quick-action control; `getByTestId('quick-action-help-finish')` on live Dashboard times out.
- Planner's `locked` field (drag-then-lock) is not exposed in the UI — only `scheduledDate` is
  sent on drop.
- Dashboard's project-step inspector is toggle-only; there is no notes/date/assignee edit dialog
  for project steps from Dashboard (Planner's inspector does support notes/due-date edits for
  project steps).
- Packaged/manual criteria `post-m1-p3-c4a` (Dashboard) and `c4b` (Planner) remain `not_tested` per
  the contract — this unit was explicitly forbidden from launching Electron or a GUI app.

## Canonical literals verified against the API's own declarations

| Literal set sent | API declaration (file:line) |
|---|---|
| `TaskStatus`: `'open' \| 'in_progress' \| 'waiting_for_reply' \| 'done'` | `apps/api_server/src/models/task.ts:7` |
| `ProjectInstanceStep.status`: `'open' \| 'done'` | `apps/api_server/src/models/project_instance.ts:8` |
| `sourceType: 'project_step'` (and `Task.id` = step's own id, `Task.sourceId` = owning instance id) | `apps/api_server/src/repositories/project_instances_repository.ts:106-129` |
| `sourceType: 'calendar_shadow_event'` | `apps/api_server/src/services/weekly_planning_service.ts:151` |
| `GET /dashboard/summary` | `apps/api_server/src/routes/dashboard_routes.ts:9` |
| `GET /project-instances`, `PATCH /project-instances/steps/:stepId` | `apps/api_server/src/routes/project_instances_routes.ts:10,13` |
| `GET /weekly-plan`, `PATCH /weekly-plan/tasks/:id` | `apps/api_server/src/routes/weekly_plan_routes.ts:9-10` |
| `GET/POST /tasks/:id/collaborators`, `DELETE .../collaborators/:userId` | `apps/api_server/src/routes/tasks_routes.ts:14-16` |
| `DashboardSummary { tasks, rhythms, projects, goals, messages }` shape | `apps/api_server/src/models/dashboard_summary.ts:12-28,53-68,87-106` |
| `WeeklyPlan { weekLabel, weekStart, days, backlog }` shape | `apps/api_server/src/services/weekly_planning_service.ts:7-17` |

All request bodies are typed through the gateway's own `CreateTaskInput`/`UpdateTaskInput`/
`UpdateProjectStepInput` types (which are themselves `Pick`/`Partial` projections of the API's
`Task`/`ProjectInstanceStep` models), so the compiler — not just review — rejects any literal
outside the canonical set.

## Fixture mode intact

Renamed the existing components to `FixtureDashboardPage`/`FixturePlannerPage` without touching a
single line of their bodies; the new mode-switch wrapper only decides which component to mount.
Ran the fixture Playwright config directly to confirm:

```
npx playwright test --config tests/post-m1-phase-3-fixture-playwright.config.ts --reporter=line -g "issue-2001|issue-2002"
→ 27 passed (17.8s)
```

## Tests — verbatim results

`npm run typecheck` (`tsc -b`): exit 0, no output.
`npm run build` (`tsc -b && vite build`): exit 0, `✓ built in 1.16s`.

Live Playwright suite, my four assigned criteria:

```
npx playwright test --config tests/post-m1-phase-3-live-playwright.config.ts --reporter=line \
  -g "post-m1-p3-c2a|post-m1-p3-c2b|post-m1-p3-c3a|post-m1-p3-c3b"
→ 4 passed (15.9s)
```

Full live suite (13 tests total, for context — the 3 remaining failures belong to other families
per the brief's explicit "ignore failures belonging to other families"):

```
npx playwright test --config tests/post-m1-phase-3-live-playwright.config.ts --reporter=line
→ 10 passed, 3 failed:
  - post-m1-p3-c2c (Tasks collaborators — Tasks unit's scope)
  - post-m1-p3-c2j (Secretary quick actions — cross-page unit's scope, not assigned to me)
  - post-m1-p3-c3c (Rhythms/Messages/Facilities/Automations/Integrations — other units' scope)
```

Note on execution environment: this worktree is shared by several concurrent units. Two transient
`tsc -b` failures were observed in `apps/web/src/pages/projects/index.tsx` and
`apps/web/src/pages/automations/index.tsx` mid-run (another unit mid-save); both cleared on
retry and are not related to this unit's files. Port 4176 (the live Playwright dev server) was
occasionally held by a concurrent unit's run; polled until free rather than force-killing it.

## Blockers resolved during this run

`post-m1-p3-c3b`'s Planner-side assertion (`[data-source-type="project_step"][data-source-id="step-contract"]`)
was blocked because the shared `/weekly-plan` mock in `post-m1-phase-3-selection-reload.redspec.ts`
never included a project-step-sourced task. Added `projectStepPlannerTask` to that mock (see Files
changed above). Also discovered along the way: `data-source-id` must be the task's own `id` (which
for project-step tasks the API sets to the step's own row id), not `task.sourceId` (which is the
*owning instance's* id) — fixed in both pages.

## ORCHESTRATOR_TODO

- Assign a unit for `post-m1-p3-c2j` (Secretary quick-action sessions) covering Dashboard, Planner,
  and Tasks together, per the contract's note that this is one shared capability.
- Consider whether Planner's `locked` scheduling flag and Dashboard's project-step edit dialog are
  wanted for full inventory parity, or whether toggle/date-only is acceptable for this phase.
- Packaged/manual smoke for `post-m1-p3-c4a`/`c4b` still needs a GUI-capable pass.

```
UNIT_AF_RESULT: COMPLETE
FILES_CHANGED: apps/web/src/pages/dashboard/index.tsx, apps/web/src/pages/planner/index.tsx, apps/web/tests/post-m1-phase-3-selection-reload.redspec.ts
COVERED_FILES_TOUCHED: src/pages/dashboard/index.tsx, src/pages/planner/index.tsx (per apps/web/SHA256SUMS)
PAGES_LIVE: Dashboard, Planner / PAGES_NOT_DONE: none (both fully wired for the assigned criteria; quick actions/Secretary sessions and Planner locking are explicitly out of scope, see ORCHESTRATOR_TODO)
LITERALS_VERIFIED: TaskStatus (task.ts:7), ProjectInstanceStep.status (project_instance.ts:8), sourceType 'project_step' (project_instances_repository.ts:106-129), sourceType 'calendar_shadow_event' (weekly_planning_service.ts:151), plus route literals in dashboard_routes.ts:9, project_instances_routes.ts:10,13, weekly_plan_routes.ts:9-10, tasks_routes.ts:14-16
FIXTURE_MODE_INTACT: npx playwright test --config tests/post-m1-phase-3-fixture-playwright.config.ts -g "issue-2001|issue-2002" → 27 passed; fixture component bodies renamed only, never edited
TESTS: npm run typecheck → exit 0; npm run build → exit 0; playwright live suite -g c2a/c2b/c3a/c3b → 4 passed (15.9s); full live suite → 10 passed / 3 failed (all 3 confirmed other-family)
ORCHESTRATOR_TODO: post-m1-p3-c2j (Secretary quick actions, shared Dashboard/Planner/Tasks capability) unassigned; Planner locked-flag and Dashboard project-step edit dialog optional follow-ups; packaged c4a/c4b need a GUI-capable pass
BLOCKERS: none remaining
```
