---
date: 2026-08-15
repo: rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [post-m1-phase-3]
status: pending
tags: [run, rhythm]
---

# Post-M1 Phase 3 domain gateways

## Files

- Added live and fixture gateway modules for Dashboard, Planner, Rhythms, Projects, Messages,
  Facilities, Automations, and Integrations under `apps/web/src/gateway/`.
- Added the combined contract file
  `apps/web/tests/gateway/post-m1-phase-3-domain-gateways.redspec.ts` and its collection-only
  config `apps/web/tests/post-m1-phase-3-domain-gateways-playwright.config.ts`.
- No page, API-server, Electron, provenance, or checksum file was edited. None of the new web files
  appears in the current `apps/web/SHA256SUMS` manifest.

## Routes and canonical vocabulary

### Dashboard

- Routes: `GET /dashboard/summary`
  (`apps/api_server/src/routes/dashboard_routes.ts:9`); project instance list and step patch
  (`apps/api_server/src/routes/project_instances_routes.ts:10,13`); task create/update and
  collaborator list/add/remove (`apps/api_server/src/routes/tasks_routes.ts:11-16`); message thread
  and message reads (`apps/api_server/src/routes/messages_routes.ts:9,11`, mounted at
  `apps/api_server/src/app.ts:145`).
- Vocabulary: `DashboardSummary { tasks, rhythms, projects, goals, messages }`; task counts and lists
  retain `openCount`, `pastDueCount`, `pastDeadlineCount`, `todayRemainingCount`,
  `todayTotalCount`, `thisWeekRemainingCount`, `thisWeekTotalCount`, `unscheduledCount`, `recent`,
  `pastDue`, `today`, `thisWeek`, and `unscheduled`; projects retain `activeCount`, `items`, and
  `onDeckSteps`; messages retain `threadCount` and `unreadPreviews`.

### Planner

- Routes: `GET /weekly-plan` and `PATCH /weekly-plan/tasks/:id`
  (`apps/api_server/src/routes/weekly_plan_routes.ts:9-10`); task create/update and collaborators
  (`apps/api_server/src/routes/tasks_routes.ts:11-16`); project-step patch
  (`apps/api_server/src/routes/project_instances_routes.ts:13`).
- Vocabulary: `WeeklyPlan { weekLabel, weekStart, days, backlog }`; each day has `date` and `tasks`;
  scheduling retains `scheduledDate`, `scheduledOrder`, and `locked`; source types remain
  `project_step` and `calendar_shadow_event`. The weekly-plan schedule route owns
  `scheduledDate`/`locked`; canonical task `PATCH` owns `scheduledOrder`.

### Rhythms

- Routes: recurring-rule list/detail/create/update/delete, step add, and collaborator
  list/add/remove (`apps/api_server/src/routes/recurring_rules_routes.ts:9-17`).
- Vocabulary: `frequency: 'weekly' | 'monthly' | 'annual'`; `dayOfWeek`, `dayOfMonth`, `month`,
  `enabled`, `sequential`, numeric/null `ownerId`, `goalId`, step `assigneeId`, `steps`,
  `collaborators`, `progress`, and `createdAt`.

### Projects

- Routes: template CRUD, template-step CRUD, and generation
  (`apps/api_server/src/routes/project_templates_routes.ts:12-20`); instance list/create/update/
  delete, instance-step patch, milestone CRUD, and collaborator operations
  (`apps/api_server/src/routes/project_instances_routes.ts:10-21`).
- Vocabulary: template `name`, `description`, `anchorType`, `ownerId`, `steps`; step `templateId`,
  `offsetDays`, `offsetDescription`, `sortOrder`, numeric/null `assigneeId`; instance `templateId`,
  `name`, `anchorDate`, `status`, `ownerId`, `goalId`, `isShared`, `milestones`, `steps`; instance
  step status is `'open' | 'done'`.

### Messages

- Routes: thread list/create, message list/create, and read/unread
  (`apps/api_server/src/routes/messages_routes.ts:9-14`, mounted at
  `apps/api_server/src/app.ts:145`).
- Vocabulary: numeric thread/message IDs; `threadType: 'direct' | 'group'`; `taskId`, `createdBy`,
  `lastMessage`, `unreadCount`, `isUnread`, `participants`; create uses numeric `participantIds`,
  `threadType`, `title`, and `taskId`; messages use `threadId`, `senderId`, `senderName`, and `body`.

### Facilities

- Routes: facility list/CRUD, overview and per-facility reservations, reservation groups/series,
  conflict-bearing mutation results, and automation reservation preview/removal
  (`apps/api_server/src/routes/facilities_routes.ts:9-55`).
- Vocabulary: response fields remain camelCase (`facilityId`, `seriesId`, `groupId`,
  `requesterName`, `requesterUserId`, `createdByUserId`, `startTime`, `endTime`,
  `externalEventId`, `externalSource`, `createdByRhythm`, `isConflicted`, `conflictReason`);
  mutation fields remain snake_case (`facility_ids`, `requester_name`, `requester_user_id`,
  `start_time`, `end_time`, `recurrence_type`); recurrence values are `weekly`, `biweekly`,
  `monthly`, and `custom`.

### Automations

- Routes: trigger/action/provider catalogs
  (`apps/api_server/src/routes/automation_catalog_routes.ts:9-11`) and rule
  list/detail/preview/resync/create/update/delete
  (`apps/api_server/src/routes/automation_rules_routes.ts:9-15`).
- Vocabulary: sources are `rhythm`, `planning_center`, `google_calendar`, and `gmail`; account is
  `sourceAccountId`; actions are `create_task`, `create_project_from_template`, `auto_schedule`,
  `send_notification`, `tag_task`, and `create_reservation`; condition operators are `equals`,
  `not_equals`, `contains`, `not_contains`, `greater_than`, and `less_than`.
- Trigger keys are exactly `rhythm.project_step_due`, `rhythm.task_due`, `rhythm.plan_assembly`,
  `planning_center.plan_upcoming`, `planning_center.plan_published`,
  `planning_center.plan_person_declined`, `planning_center.plan_person_unconfirmed`,
  `planning_center.needed_position_open`, `planning_center.special_service_candidate`,
  `planning_center.service_item_updated`, `google_calendar.event_matching_filter`,
  `google_calendar.all_day_event`, `gmail.message_matching_filter`, and
  `gmail.unread_message_matching_filter`. Confirmed at
  `apps/api_server/src/models/automation_rule.ts:15-43` and against the served catalog at
  `apps/api_server/src/services/automation_catalog_service.ts:9-163`.

### Integrations

- Routes: accounts, provider/all sync, Calendar settings/preferences, Gmail signals/labels, and PCO
  preferences/options (`apps/api_server/src/routes/integrations_routes.ts:9-41`); Google user/agent
  and Planning Center authorization begins (`apps/api_server/src/routes/auth_routes.ts:20,23-25`);
  import persistence uses the existing task, recurring-rule, project-template, and template-step
  creates (`apps/api_server/src/routes/tasks_routes.ts:11`,
  `apps/api_server/src/routes/recurring_rules_routes.ts:11`,
  `apps/api_server/src/routes/project_templates_routes.ts:14,17`).
- Vocabulary: providers are `google_calendar`, `gmail`, and `planning_center`; public account state
  retains `provider`, `status`, `needsReauth`, `email`, `displayName`, `scope`, `expiresAt`,
  `lastSyncedAt`, and `errorMessage`; Calendar uses `selectedCalendarIds`; PCO preferences use
  `teamIds` and `positionNames`; options use `teams` and `positionsByTeamId`.

## Checks

### RED captured before implementation

Command:

```text
cd apps/web && npx playwright test --config tests/post-m1-phase-3-domain-gateways-playwright.config.ts --list
```

Verbatim output:

```text

Error: Cannot find module '/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/web/src/gateway/dashboard' imported from /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/web/tests/gateway/post-m1-phase-3-domain-gateways.redspec.ts

Error: No tests found
Listing tests:
Total: 0 tests in 0 files
```

### Post-implementation checks

- `cd apps/web && npm run typecheck` — PASS after one Facilities query-helper type repair.
- `cd apps/web && npm run build` — PASS; Vite transformed 1,631 modules and emitted the existing
  >500 kB chunk-size advisory.
- `cd apps/web && npx playwright test --config tests/post-m1-phase-3-domain-gateways-playwright.config.ts --list`
  — PASS collection: 10 tests in 1 file.
- Playwright execution was not run; this unit was explicitly prohibited from launching Chromium.

## Not finished / orchestrator handoff

- No pages were wired and no files under `apps/web/src/pages/**` were touched.
- The eight domains were not added to `gateway/index.ts`; the next page-wiring unit can compose the
  factories into `GatewayDomainContracts` after its own GitNexus impact check. A local impact check
  attempt for `createLiveGateway` could not complete because the index had a pending LadybugDB WAL;
  editing that existing symbol without a successful impact report would violate repo policy.
- The 10 collected redspecs were not executed. The orchestrator must execute them in an environment
  where Chromium can launch, then add live two-actor/API coverage separately.
- No API endpoint was added or changed. Message rename/delete remain intentionally unsupported by
  the current route declaration. There is no bulk integration-import endpoint; imports persist via
  the four existing canonical create routes listed above.
