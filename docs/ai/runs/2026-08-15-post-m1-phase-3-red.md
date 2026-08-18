---
date: 2026-08-15
repo: Rhythm-react-electron-live-suite
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-3]
status: partial
tags: [run, Rhythm-react-electron-live-suite]
---

# Post-M1 Phase 3 executable contract tests

## Files

- Added `apps/api_server/src/__tests__/post_m1_phase_3_route_vocabulary.test.ts`.
- Added `apps/web/tests/post-m1-phase-3-live-pages.redspec.ts`.
- Added `apps/web/tests/post-m1-phase-3-selection-reload.redspec.ts`.
- Added `apps/web/tests/post-m1-phase-3-live-playwright.config.ts`.
- Added `apps/web/tests/post-m1-phase-3-fixture-playwright.config.ts`.
- Updated `docs/ai/contracts/post-m1-phase-3.json`.
- No product code, SHA-listed web file, Electron file, branch, worktree, row, or session was changed or created.

The requested inventory filename `phase-3-session-lifecycle-inventory.md` is absent in this checkout. The authoritative file is `docs/ai/coverage/react-electron/phase-3-operational-workspace-inventory.md`; it contains the same ten verified gaps and vocabulary described in the task.

## Checks

### API prerequisite test — final run

Command:

```text
cd apps/api_server && npx vitest run src/__tests__/post_m1_phase_3_route_vocabulary.test.ts --reporter=verbose
```

Observed output:

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2a: dashboard, task, project-step, collaborator, and message routes exist 1ms
 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2b: weekly plan and its canonical persisted task fields exist 2ms
 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2c: task collaborator routes use numeric userId vocabulary 0ms
 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2d: recurring-rule CRUD, steps, collaborators, and canonical frequencies exist 1ms
 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2e: project template, instance, step, milestone, and collaborator routes exist 1ms
 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2f: message routes preserve numeric IDs and direct/group thread vocabulary 0ms
 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2g: facility CRUD, reservation series, conflicts, and cleanup routes use canonical vocabulary 0ms
 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2h: automation catalogs/rules and exact persisted literals exist 0ms
 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2i: integration auth, account, sync, signal, option, and preference routes exist 1ms
 ✓ src/__tests__/post_m1_phase_3_route_vocabulary.test.ts > post-M1 Phase 3 API boundary prerequisites > post-m1-p3-api-c2j: Secretary quick actions have real session-create and session.input boundaries 1ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  19:47:51
   Duration  145ms (transform 25ms, setup 0ms, import 35ms, tests 8ms, environment 0ms)
```

The first API attempt produced `7 failed | 3 passed` because its source matcher expected `get('/')` even though Express declarations continue with a controller argument (`get('/', controller...)`) and did not normalize multiline declarations. This was a harness failure, not contract RED. After one matcher repair, the final run above passed 10/10.

### Live browser RED collection only

Command:

```text
cd apps/web && npx playwright test --config tests/post-m1-phase-3-live-playwright.config.ts --list
```

Observed output:

```text
Listing tests:
  post-m1-phase-3-live-pages.redspec.ts:49:1 › post-m1-p3-c2a: live Dashboard consumes its real gateway instead of fixture state
  post-m1-phase-3-live-pages.redspec.ts:61:1 › post-m1-p3-c2b: live Planner preserves WeeklyPlan and every persisted scheduling boundary
  post-m1-phase-3-live-pages.redspec.ts:72:1 › post-m1-p3-c2c: live Tasks round-trips numeric collaborators and truthful source metadata
  post-m1-phase-3-live-pages.redspec.ts:84:1 › post-m1-p3-c2d: live Rhythms exposes complete recurring-rule operations
  post-m1-phase-3-live-pages.redspec.ts:95:1 › post-m1-p3-c2e: live Projects exposes template, instance, step, milestone, and collaborator operations
  post-m1-phase-3-live-pages.redspec.ts:107:1 › post-m1-p3-c2f: live Messages uses numeric persisted IDs for complete thread/message operations
  post-m1-phase-3-live-pages.redspec.ts:118:1 › post-m1-p3-c2g: live Facilities exposes canonical CRUD, recurrence, conflicts, and automation cleanup
  post-m1-phase-3-live-pages.redspec.ts:130:1 › post-m1-p3-c2h: live Automations uses server catalogs and rejects every invalid fixture literal
  post-m1-phase-3-live-pages.redspec.ts:142:1 › post-m1-p3-c2i: live Integrations exposes authorization, sync, signals, preferences, options, and imports
  post-m1-phase-3-live-pages.redspec.ts:154:1 › post-m1-p3-c2j: operational quick actions create Secretary sessions and send the preset prompt
  post-m1-phase-3-selection-reload.redspec.ts:24:1 › post-m1-p3-c3a: task mutations refresh Dashboard and Planner without losing task/week/filter selection
  post-m1-phase-3-selection-reload.redspec.ts:40:1 › post-m1-p3-c3b: project-step mutations refresh Dashboard and Planner with stable canonical identity
  post-m1-phase-3-selection-reload.redspec.ts:53:1 › post-m1-p3-c3c: remaining operational families preserve stable selections, filters, and deep links on reload
Total: 13 tests in 2 files
```

Chromium was not launched. Per task constraint, these criteria remain `pending`, not `red`, until the orchestrator observes assertion failures.

### Fixture collection only

Command:

```text
cd apps/web && npx playwright test --config tests/post-m1-phase-3-fixture-playwright.config.ts --list
```

Observed terminal summary after listing every collected test:

```text
Total: 129 tests in 9 files
```

The nine SHA-locked issue-2001 through issue-2009 specs were collected without modification. Chromium was not launched, so c1a-c1i remain `pending`.

### Contract, checksum, and residue validation

Observed output:

```text
{
  "criteria": 31,
  "counts": {
    "pending": 22,
    "not_tested": 9
  },
  "not_tested": 9,
  "all_test_paths_exist": true
}
NOT_LISTED tests/post-m1-phase-3-live-pages.redspec.ts
NOT_LISTED tests/post-m1-phase-3-selection-reload.redspec.ts
NOT_LISTED tests/post-m1-phase-3-live-playwright.config.ts
NOT_LISTED tests/post-m1-phase-3-fixture-playwright.config.ts
sessions=0
rows=0
worktrees=0
branches=0
```

The managed sandbox remained up on API `:4098` and engine `:4097`; this unit did not start, stop, or alter it.

## Routes verified

- `GET /dashboard/summary` — `apps/api_server/src/routes/dashboard_routes.ts:9`.
- Task CRUD and `GET|POST|DELETE /tasks/:id/collaborators[/userId]` — `apps/api_server/src/routes/tasks_routes.ts:9-16`.
- `GET /weekly-plan` and `PATCH /weekly-plan/tasks/:id` — `apps/api_server/src/routes/weekly_plan_routes.ts:9-10`.
- Recurring-rule CRUD, steps, and collaborators — `apps/api_server/src/routes/recurring_rules_routes.ts:9-17`.
- Project template/step/generate routes — `apps/api_server/src/routes/project_templates_routes.ts:12-20`.
- Project instance/step/milestone/collaborator routes — `apps/api_server/src/routes/project_instances_routes.ts:10-21`.
- Message thread/message/read/unread routes — `apps/api_server/src/routes/messages_routes.ts:9-14`.
- Facility/reservation/series/conflict-cleanup routes — `apps/api_server/src/routes/facilities_routes.ts:9-55`.
- Automation catalogs — `apps/api_server/src/routes/automation_catalog_routes.ts:9-11`; rule CRUD/preview/resync — `apps/api_server/src/routes/automation_rules_routes.ts:9-15`.
- Integration account/sync/signal/preference/options routes — `apps/api_server/src/routes/integrations_routes.ts:9-40`; OAuth begin routes — `apps/api_server/src/routes/auth_routes.ts:20-24`.
- `POST /agent-sessions` — `apps/api_server/src/routes/agent_sessions_routes.ts:67`; WebSocket `session.input` — `apps/api_server/src/services/ws_gateway.ts:288-295,986-991`.

## Notes

- API prerequisite tests are intentionally green; they prove the RED browser specs target real API boundaries and canonical literals rather than invented endpoints.
- The live specs use `page.route` interception and public gateway methods. No product-only test hook was requested or added.
- c4a-c4i are `not_tested`, not silently pending: Electron modification and GUI execution were explicitly forbidden for this unit.
