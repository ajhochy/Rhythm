---
date: 2026-08-12
repo: Rhythm
status: ready-for-overnight-swarm
tags: [handoff, open-design, prototype, react, playwright]
---

# Overnight handoff — complete the remaining Rhythm pages

## Outcome

Complete the fixture-backed, web-only React/Vite redesign for Dashboard, Planner, Tasks, Rhythms, Projects, Messages, Facilities, Automations, and Integrations. Preserve the existing Agents implementation. Use the shipping Flutter desktop client for behavior and `rhythm-dashboard-redesign.html` for visual language.

## Exact locations

- Shipping behavior source, read-only: `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter`
- API route/function source, read-only: `/Users/ajhochhalter/Documents/Rhythm/apps/api_server`
- Open Design project root: `/Users/ajhochhalter/Library/Application Support/Open Design/namespaces/release-stable/data/projects/fc0be6da-6e7a-4650-aa68-3bd044a0712c`
- Prototype: the `rhythm-desktop-agents` directory inside that project
- Visual reference: `rhythm-dashboard-redesign.html` in that project
- Studio conversation: `http://127.0.0.1:55948/projects/fc0be6da-6e7a-4650-aa68-3bd044a0712c/conversations/8b1f3e39-6ce5-4d48-8fa4-6322873e8f0d`

## State at pause

### Verified fixture baseline before the paused live attempt

- Polished application shell and full Agents workflow.
- Twelve Tool workflows with ready, loading, empty, retryable error, forbidden, unavailable, and read-only states.
- Exact endpoint receipts, deterministic fixtures, responsive layouts, keyboard behavior, and serious/critical accessibility checks.
- Production build passed.
- Installed-Chrome Playwright suite passed 58/58.
- Dist smoke passed.
- Manual browser click-through passed.
- No Electron dependency, launch, package, or generated bundle remains.

### Canceled live-mode partial work — quarantine first

The live-server run was explicitly canceled and must remain paused. It left partial files:

- `rhythm-desktop-agents/docs/ai/contracts/issue-0-live-mode.json`
- `rhythm-desktop-agents/tests/contract/issue-0-live-mode.spec.ts`
- modified `rhythm-desktop-agents/package.json`
- modified `rhythm-desktop-agents/vite.config.ts`

The current `vite.config.ts` contains an incomplete `stripBrowserHeaders` function signature near line 43 and does not build. `package.json` contains partial `live:dev`, `test:contract`, and `test:live` scripts. No complete live adapter was generated.

Lead agent's first task:

1. Preserve the live-mode JSON and Playwright contract as paused evidence.
2. Ensure ordinary fixture test discovery excludes the paused live contract unless `RHYTHM_LIVE_E2E=1` is explicitly supplied.
3. Restore a valid ordinary Vite configuration with relative production assets and no active live proxy.
4. Remove or quarantine incomplete live scripts/configuration that cannot run without unfinished adapters.
5. Run the build, the verified 58-test fixture suite, and dist smoke. Do not begin page work until all three are green.

Do not call `api.vcrcapps.com`, do not call the local agent server, do not start a sandbox, and do not launch Electron during the overnight redesign.

## Sources of truth, in order

1. Flutter view: visible controls, labels, navigation, permission gates, dialogs, and state transitions.
2. Flutter controller/repository/data source: actual operations, payload fields, query behavior, endpoint method/path, and errors.
3. api_server routes/controllers/services: confirm endpoint and response semantics when Flutter is ambiguous.
4. `rhythm-dashboard-redesign.html`: mineral palette, header/navigation, typography, spacing, shape, density, focus treatment, responsive behavior, and dashboard composition.
5. Existing React Agents implementation: interaction/store/fixture/test conventions only. It cannot override Flutter behavior or the visual reference.

Never infer behavior from endpoint names alone. Record every page finding in `docs/ai/inventories/<page>.md` before implementation.

## Swarm topology and file ownership

Use all available subagent slots in three waves. The lead remains the only writer of shared files.

Lead-only files:

- `src/App.tsx`
- `src/components/Shell.tsx`
- `src/styles.css`
- `src/icons.tsx`
- shared fixture/store utilities
- `package.json`, Vite/Playwright configs, `README.md`, and regenerated `dist/`

Each page owner has exclusive write access to:

- `src/pages/<page>/**`
- `docs/ai/inventories/<page>.md`
- `docs/ai/contracts/issue-<id>.json`
- `tests/contract/issue-<id>-<page>.spec.ts`
- `tests/pages/<page>.spec.ts`
- page-specific screenshots under `test-results/<page>/**`

If a page needs a reusable component, keep it page-local. The lead may extract it after the wave passes. Page owners never edit shared files directly; they send the lead a wiring note.

Waves:

- Wave 1: Dashboard (2001), Planner (2002), Tasks (2003)
- Wave 2: Rhythms (2004), Projects (2005), Messages (2006)
- Wave 3: Facilities (2007), Automations (2008), Integrations (2009)

Use each page agent in two turns:

1. Recon/contract turn: inventory Flutter behavior; create the canonical contract JSON and executable Playwright contract tests; run them and prove they fail for the missing page rather than erroring.
2. Implementation turn: only after lead review, implement the isolated page and make its contracts pass.

This creates a fast horde without concurrent edits to App, Shell, global styles, or config.

## Repeatable page procedure

1. Inspect the page's Flutter view, controller, repository, data source, models, and relevant api_server routes.
2. Inventory every visible control: label, type, precondition/permission, trigger, visible outcome, endpoint/function, payload, loading state, success state, and failure state.
3. Inventory every route and deep-link target.
4. Write `docs/ai/contracts/issue-<id>.json` using the canonical contract schema.
5. Write one failing Playwright test per criterion. Name the regression each test catches. Tests must drive the page surface, not mock the behavior being tested.
6. Confirm tests fail because the behavior is absent, not because the test harness is broken.
7. Implement deterministic fixtures and page UI only in the assigned page directory.
8. Give every enabled control a visible outcome: route change, state update, modal/menu, filter result, endpoint receipt, toast/status, or deterministic recovery. A control that cannot work must be natively disabled with an accessible reason.
9. Add exact method/path/payload traceability for each endpoint-backed control through the existing receipt/endpoint-map convention.
10. Run the page contract, page click-through, accessibility, and responsive checks. Return inventory, changed files, commands/results, screenshots, and unresolved gaps to the lead.

## Shared acceptance contract

Every page contract must include these independently testable criteria in addition to its page-specific criteria.

- **C1 Route and shell:** selecting the global navigation item loads a non-placeholder `<main>` with the correct page heading, preserves account/global navigation, marks the active item, and survives direct hash-route load. Unknown routes show a recoverable not-found state.
- **C2 Visual system:** at 1440px the page uses the reference mineral tokens, typography, borders, radii, density, and restrained accent; no generic light dashboard or unrelated visual system is introduced. Visual parity is manual-plus-screenshot, never silently waived.
- **C3 Deterministic states:** query/fixture selection can deterministically render ready, loading, empty, retryable error, forbidden, unavailable, and read-only states where the Flutter behavior supports them. Reload/reset returns the same fixture state.
- **C4 No dead controls:** every enabled interactive element produces the documented visible outcome. Every intentionally unavailable action is disabled and exposes its prerequisite to assistive technology.
- **C5 Endpoint traceability:** every API-backed action records the exact HTTP method, route, meaningful payload fields, response status, and resulting UI state. Static navigation-only controls are explicitly classified as client-side rather than assigned fake endpoints.
- **C6 Semantic accessibility:** landmarks and headings are ordered; forms have labels/errors; dialogs/menus manage focus and Escape; controls have accessible names; status/errors use appropriate live semantics; keyboard-only operation works; serious/critical automated issues are zero.
- **C7 Responsive resilience:** no page-level horizontal overflow at 1440, 1024, 768, or 390 CSS pixels; content remains usable at 200% text; 44px touch targets, RTL, long text, emoji/CJK, forced colors, and reduced motion are supported.
- **C8 Fixture isolation:** all data is deterministic and synthetic. Tests fail on accidental requests to production, localhost Rhythm APIs, analytics, or third-party OAuth services.
- **C9 Regression preservation:** the verified Agents workflow and its existing 58 tests remain green; no existing route, Tool state, keyboard behavior, receipt, or responsive contract regresses.
- **C10 Web-only safety:** `npm ls electron electron-builder --depth=0` reports neither package and no Electron app/bundle is generated or launched.

## Page-specific seed contracts

These are minimum criteria. The recon turn must correct and expand them using the Flutter source before implementation.

### Dashboard — issue 2001

Behavior sources:

- `features/dashboard/views/dashboard_view.dart`
- `features/dashboard/controllers/dashboard_controller.dart`
- `features/dashboard/repositories/dashboard_repository.dart`
- `features/dashboard/data/dashboard_data_source.dart`
- visual composition in `rhythm-dashboard-redesign.html`

Endpoint families: `GET /dashboard/summary`, `GET/POST/PATCH /tasks`, task collaborators, recurring rules, project templates/instances/steps, message threads/messages.

Minimum outcomes:

- Refresh visibly moves loading to ready or error; Retry recovers without reload.
- Focus-for-this-week, today/week/project progress, planning lists, unread preview, and empty states match available fixture data.
- Adding a task validates title, applies schedule/collaborator selections, inserts the task, updates counts, and emits a POST receipt.
- Completing/updating a task or project step updates the correct row and summary through the correct PATCH receipt.
- Planner, Projects, Messages, and thread shortcuts navigate to exact routes.
- Quick Actions select one action at a time and produce an explicit client-side handoff state rather than a dead toast-only control.

### Planner — issue 2002

Behavior sources:

- `features/weekly_planner/views/weekly_planner_view.dart`
- `features/weekly_planner/controllers/weekly_planner_controller.dart`
- `features/weekly_planner/repositories/weekly_plan_repository.dart`
- `features/weekly_planner/data/weekly_plan_data_source.dart`

Endpoint families: `GET /weekly-plan`, `PATCH /weekly-plan/tasks/:taskId`, `PATCH /tasks/:id`, `PATCH /project-instances/steps/:id`, `POST /tasks`.

Minimum outcomes:

- Previous/next week and Today update the visible date range and deterministic plan.
- Scheduled tasks and project steps render in the correct day; unscheduled/backlog items are distinct.
- Reassigning/scheduling an item updates its day and emits the correct task-versus-project-step receipt.
- Creating, editing, and completing a task update the visible plan and summaries.
- Empty week, partial data, error/retry, read-only, and long-title cases remain usable.

### Tasks — issue 2003

Behavior sources:

- `features/tasks/views/tasks_view.dart`
- `features/tasks/views/tasks_kanban_view.dart`
- `features/tasks/controllers/tasks_controller.dart`
- `features/tasks/repositories/tasks_repository.dart`
- `features/tasks/data/tasks_local_data_source.dart`
- `features/tasks/data/collaborators_data_source.dart`

Endpoint families: `GET/POST /tasks`, `PATCH/DELETE /tasks/:id`, task and project-instance collaborator endpoints.

Minimum outcomes:

- Search, status/date/owner filters, sorting, grouping, and clear-filter recovery produce deterministic visible results.
- List and Kanban views preserve the same selected task and filter state.
- Create validates required fields and inserts a task; edit changes title/notes/status/due date/assignee/project fields supported by Flutter.
- Complete/reopen, collaborator add/remove, and delete update lists/counts and show exact receipts.
- Empty/no-results/error/forbidden/read-only states expose the correct recovery or prerequisite.

### Rhythms — issue 2004

Behavior sources:

- `features/rhythms/views/rhythms_view.dart`
- `features/rhythms/controllers/rhythms_controller.dart`
- `features/rhythms/repositories/rhythms_repository.dart`
- `features/rhythms/data/rhythms_data_source.dart`

Endpoint families: `GET/POST /recurring-rules`, `PATCH/DELETE /recurring-rules/:id`, recurring-rule collaborator endpoints, users.

Minimum outcomes:

- List/search/filter expose enabled/paused and schedule information exactly as Flutter does.
- Create/edit validates recurrence, dates, ownership, and supported task template fields.
- Enable/pause, collaborator add/remove, and delete update the selected rule and receipts.
- Generated/next-run information and empty/error/read-only states are explicit and deterministic.

### Projects — issue 2005

Behavior sources:

- `features/projects/views/projects_view.dart`
- project template/milestone controllers and repositories
- `features/projects/data/projects_local_data_source.dart`
- `features/projects/data/project_milestones_data_source.dart`

Endpoint families: project templates and template steps; project instances, steps, collaborators, and milestones.

Minimum outcomes:

- Template and active-project/instance views are distinct and deep-linkable.
- Create/edit/delete template and step operations preserve ordering and validation.
- Starting an instance, editing/completing steps, collaborator changes, milestone add/remove, and instance status actions update the correct surface and receipt.
- Empty templates, no active projects, partial completion, error/forbidden/read-only states are covered.

### Messages — issue 2006

Behavior sources:

- `features/messages/views/messages_view.dart`
- `features/messages/controllers/messages_controller.dart`
- `features/messages/repositories/messages_repository.dart`
- `features/messages/data/messages_data_source.dart`

Endpoint families: `GET/POST /message-threads`, `GET/POST /message-threads/:id/messages`, `POST /message-threads/:id/read`, `POST /message-threads/:id/unread`, users.

Minimum outcomes:

- Thread search/filter and unread counts update deterministically.
- Selecting/deep-linking a thread renders transcript, participants, subject, and read state.
- New thread validates recipients/subject/body and selects the created thread.
- Reply validates body, appends once, preserves scroll/focus, and emits the correct receipt.
- Mark read/unread updates thread and global badges; empty/no-results/error/read-only states recover correctly.

### Facilities — issue 2007

Behavior sources:

- `features/facilities/views/facilities_view.dart`
- `features/facilities/controllers/facilities_controller.dart`
- `features/facilities/repositories/facilities_repository.dart`
- `features/facilities/data/facilities_data_source.dart`

Endpoint families: facilities CRUD; facility reservations; cross-facility reservation search; reservation series; automation-reservation preview/cleanup.

Minimum outcomes:

- Overview and booking modes, date/room filters, availability, and conflict indicators match Flutter.
- Create/edit/delete reservation validates time, room, title, and conflicts.
- Recurring-series create/edit/delete distinguishes one occurrence from the series where Flutter does.
- Manager permissions gate facility/room management and destructive actions.
- Facility create/edit/delete and room-management controls update the deterministic inventory.
- Automation-reservation preview and cleanup show counts, confirmation, result, and receipts.

### Automations — issue 2008

Behavior sources:

- `features/tasks/views/automation_rules_view.dart`
- `features/tasks/controllers/automation_rules_controller.dart`
- `features/tasks/repositories/automation_rules_repository.dart`
- `features/tasks/data/automation_rules_data_source.dart`

Endpoint families: automation rules CRUD/preview/resync; automation catalog triggers/actions/providers; integration accounts; PCO options; Gmail labels; project templates.

Minimum outcomes:

- Rule list/search/filter and enabled state remain deterministic.
- Builder validates provider/source, trigger, conditions, and actions based on the catalog.
- Missing integration prerequisites disable affected controls and explain how to connect.
- Create/edit/enable-disable/delete update the rule list and receipts.
- Preview renders matches/changes without mutation; Resync renders progress/result and emits its receipt.
- Empty catalog, invalid configuration, provider error, forbidden, and read-only states are covered.

### Integrations — issue 2009

Behavior sources:

- `features/integrations/views/integrations_view.dart`
- `features/integrations/controllers/integrations_controller.dart`
- `features/integrations/repositories/integrations_repository.dart`
- `features/integrations/data/integrations_data_source.dart`

Endpoint families: integration accounts; Google and Planning Center auth begin; Google Calendar settings/preferences/sync; Gmail signals/sync; PCO task options/preferences/sync; sync-all.

Minimum outcomes:

- Service cards accurately show connected, disconnected, syncing, error, and permission states.
- Connect actions expose an explicit OAuth handoff fixture and never open a real external URL overnight.
- Google Calendar selection/settings and PCO team/position preferences validate, save, and update receipts.
- Gmail enable/signal/sync and individual/sync-all actions show progress, success, partial failure, and retry.
- AI import or other Flutter-visible secondary actions are inventoried and receive deterministic outcomes.
- Disconnected, expired-auth, error, forbidden, and read-only states explain prerequisites.

## Verification gates

Run gates after every page, after every wave, and once at the end.

1. Page contract tests pass and contract JSON criteria are updated from pending to pass; manual criteria are listed in `not_tested` with reasons.
2. `npm run build` passes.
3. Installed-Chrome Playwright through `tests/external-host-playwright.config.ts` passes with strict unique ports.
4. `npm run test:dist-smoke` passes.
5. All top-level routes load directly and by click; none render `ModulePlaceholder`.
6. Endpoint trace audit reports zero enabled API controls without method/path/payload receipt and zero fake endpoints on client-only controls.
7. No-dead-control audit reports zero enabled controls without a visible outcome.
8. Automated serious/critical accessibility violations are zero across ready plus representative non-ready states.
9. Screenshot sweep covers 1440, 1024, 768, and 390 widths plus 200% text/RTL/forced-colors representatives.
10. Browser network audit reports no production, Rhythm localhost API, analytics, OAuth, or unrelated external requests.
11. `npm ls electron electron-builder --depth=0` and filesystem audit show no Electron dependency or artifact.
12. Manual click-through is performed in Chrome after automation. Run the failure-postmortem workflow even when it passes.

## Completion definition

The work is not complete because code was generated or because a build passes. It is complete only when all nine page contracts pass, the full pre-existing Agents suite remains green, every top-level route is non-placeholder, network isolation is proven, the manual browser click-through finds no missing/dead behavior, README/inventories/contracts reflect the final state, and the resulting Studio/Chrome preview is opened for review.

If time expires, stop at a clean wave boundary, leave passing integrated work in place, and report exact remaining contract IDs. Never weaken or delete tests to manufacture a green result.
