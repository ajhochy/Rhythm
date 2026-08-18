# Phase 3 operational workspace capability inventory

Date: 2026-08-15  
Flutter reference: `origin/main` at `9fa2761ed78159f83f56982c03fcd85dc035039a`  
React inspected: current working-tree `apps/web`  
Scope note: the plan says “eight page families” but names nine. This inventory covers all nine named families.

## Missing capabilities — Flutter has these; React does not

1. **Dashboard live workspace:** Flutter reads the authenticated dashboard summary and project instances, creates and edits tasks, manages task collaborators, edits project steps, and opens real message data (`origin/main:apps/desktop_flutter/lib/features/dashboard/data/dashboard_data_source.dart:23-25,72-74,96-126,134-205`). React Dashboard initializes fixture arrays and only appends simulated receipts; it never imports or calls a gateway (`apps/web/src/pages/dashboard/index.tsx:75-89,114-127,136-223`). **No React live Dashboard implementation found.**
2. **Weekly Planner live planning:** Flutter loads `/weekly-plan`, schedules/locks ordered tasks, updates ordinary tasks or project steps, and creates tasks (`origin/main:apps/desktop_flutter/lib/features/weekly_planner/data/weekly_plan_data_source.dart:16-34,46-93`). The real API plan also includes user-scoped tasks, project steps, calendar shadow events, and backlog (`apps/api_server/src/services/weekly_planning_service.ts:77-121,142-183`). React Planner mutates local fixture state and appends receipt strings (`apps/web/src/pages/planner/index.tsx:139-152,178-195,234-297`). **No React live Planner implementation found.**
3. **Task collaborator round-trip and truthful shared/source metadata:** Flutter lists, adds, and removes task collaborators (`origin/main:apps/desktop_flutter/lib/features/tasks/data/collaborators_data_source.dart:17-47`). React's live `TaskGateway` exposes only list/create/update/delete (`apps/web/src/gateway/tasks.ts:4-10`), maps every live task to `collaborators: []`, invents `createdBy: 'Task owner'`, and coerces unrecognized source types to `manual` (`apps/web/src/gateway/tasks.ts:42-62`); the collaborator buttons only change local state and append receipts (`apps/web/src/pages/tasks/index.tsx:320-329`). React can persist basic task CRUD, but cannot perform this Flutter capability live.
4. **Rhythm rule operations:** Flutter lists users/rules and creates, edits, enables/disables, deletes, and manages rule collaborators (`origin/main:apps/desktop_flutter/lib/features/rhythms/data/rhythms_data_source.dart:15-29,39-117`). React Rhythms performs the same-looking operations only against local `rules` state (`apps/web/src/pages/rhythms/index.tsx:129-135,157-201`). **No React recurring-rule gateway or live implementation found.**
5. **Project template and instance operations:** Flutter persists template/step CRUD, generates project instances, updates/deletes instance steps and instances, and manages milestones and collaborators (`origin/main:apps/desktop_flutter/lib/features/projects/data/projects_local_data_source.dart:15-125`; `origin/main:apps/desktop_flutter/lib/features/projects/data/project_milestones_data_source.dart:16-51`; `origin/main:apps/desktop_flutter/lib/features/projects/views/projects_view.dart:222-318,570-659,2132`). React Projects keeps templates and instances in component state and only records simulated receipts (`apps/web/src/pages/projects/index.tsx:79-104,141-298`). **No React Projects gateway or live implementation found.**
6. **Messaging:** Flutter loads visible threads/users/messages, creates direct or group threads, sends messages, and marks threads read/unread (`origin/main:apps/desktop_flutter/lib/features/messages/data/messages_data_source.dart:18-96`). React Messages mutates its seeded thread array and appends receipts (`apps/web/src/pages/messages/index.tsx:92-109,136-156,254-297`). **No React Messages gateway or live implementation found.**
7. **Facilities and reservations:** Flutter persists facility CRUD; reservation overview, single/group mutations, recurrence series, conflicts; and automation-created reservation preview/removal (`origin/main:apps/desktop_flutter/lib/features/facilities/data/facilities_data_source.dart:18-55,61-201,208-249`). React Facilities holds facilities/reservations locally and simulates mutations and automation cleanup (`apps/web/src/pages/facilities/index.tsx:170-213,339-494`). **No React Facilities gateway or live implementation found.**
8. **Automation rules and catalogs:** Flutter loads server trigger/action/provider catalogs and integration prerequisites, then previews, creates, edits, enables, deletes, and resyncs rules (`origin/main:apps/desktop_flutter/lib/features/tasks/data/automation_rules_data_source.dart:49-146,155-239`). React Automations is fixture-only (`apps/web/src/pages/automations/index.tsx:209-218,230-298`) and its fixture vocabulary is not API-safe: `auto_schedule_task`, `pco.volunteer_declined`, `google_calendar.event_matches`, and `gmail.message_matches` (`apps/web/src/pages/automations/fixtures.ts:1-2,66-70,78`) do not match canonical `auto_schedule`, `planning_center.plan_person_declined`, `google_calendar.event_matching_filter`, and `gmail.message_matching_filter` (`apps/api_server/src/models/automation_rule.ts:15-43`). **No React live Automation implementation found.**
9. **Integration authorization, sync, signals, and preferences:** Flutter begins Google user/agent and Planning Center authorization, reads connected accounts, syncs providers/all, reads Gmail signals, and reads/writes Calendar and PCO task preferences (`origin/main:apps/desktop_flutter/lib/features/integrations/data/integrations_data_source.dart:18-149`). React only constructs a fixture handoff and mutates local provider/preference/import state (`apps/web/src/pages/integrations/index.tsx:113-143,171-247,280-307`); its hyphenated provider IDs (`apps/web/src/pages/integrations/fixtures.ts:1-12`) are not canonical API provider values (`apps/api_server/src/models/integration_account.ts:1-13`). **No React live Integrations gateway, OAuth handoff, sync, or preference implementation found.**
10. **Operational agent quick actions:** Flutter creates a real Secretary-scoped agent session, sends the preset prompt, and, for follow-up, persists the task before launching the agent (`origin/main:apps/desktop_flutter/lib/features/agents/views/quick_actions_bar.dart:164-205,208-269`). React Dashboard explicitly says “Local preview · no request sent” (`apps/web/src/pages/dashboard/index.tsx:250`), while Planner/Tasks call the store's local `createSession` (`apps/web/src/pages/planner/index.tsx:294-300`; `apps/web/src/pages/tasks/index.tsx:360-371`), which only prepends a fixture session object (`apps/web/src/store.tsx:308-321`). **No React real operational quick-action handoff found.**

The first nine gaps align to the nine named page families. Gap 10 is one shared capability exposed from Dashboard, Planner, and Tasks.

## Per-family detail

### Dashboard

- **Flutter:** Authenticated summary across tasks, rhythms, projects, goals, and messages; task/project-step mutation; collaborator and message drill-through. The API summary shape is explicit (`apps/api_server/src/models/dashboard_summary.ts:12-28,30-41,53-68,70-106`).
- **React:** A polished fixture summary with create/edit/toggle/inspect/navigation state and deterministic error states.
- **React cannot:** Load or refresh real summary/project/message records, persist its mutations, preserve server identities, or launch its quick actions against the real session boundary.
- **Boundary:** `GET /dashboard/summary`, plus canonical Tasks, Project Instances, and Message Threads routes; all are authenticated (`apps/api_server/src/routes/dashboard_routes.ts:8-9`, `apps/api_server/src/routes/tasks_routes.ts:8-16`, `apps/api_server/src/routes/project_instances_routes.ts:8-21`, `apps/api_server/src/routes/messages_routes.ts:8-14`).

### Planner

- **Flutter:** Authenticated ISO-week load; day/backlog assembly; drag scheduling and locking; ordinary-task/project-step edit and completion; task creation and collaborators; read-only calendar-shadow context.
- **React:** Deterministic week navigation, filtering, selection, drag/drop, inspector, collaborator picker, and quick-action presentation over fixture records.
- **React cannot:** Read the real user-scoped plan, preserve `scheduledOrder`/`locked`, distinguish canonical `sourceType: 'project_step' | 'calendar_shadow_event'`, mutate source-owned project steps, or persist collaborator/quick-action outcomes.
- **Boundary:** `GET /weekly-plan?week=YYYY-WNN` and `PATCH /weekly-plan/tasks/:id` (`apps/api_server/src/routes/weekly_plan_routes.ts:8-10`), ordinary Tasks/Project Instance endpoints, and the `WeeklyPlan` declaration (`apps/api_server/src/services/weekly_planning_service.ts:7-17`).

### Tasks

- **Flutter:** User-visible list; create/edit/status/delete; schedule/due/agent/energy fields; collaborator list/add/remove; list and Kanban presentations.
- **React:** The only Phase 3 page with a live gateway. It can list/create/update/delete basic tasks (`apps/web/src/gateway/tasks.ts:91-104`) and otherwise supplies rich fixture filters, list/board, inspector, and quick actions.
- **React cannot:** Live-load or mutate collaborators, preserve real creator identity, faithfully expose all server `sourceType` values, or create/send a real agent quick action. Live mapping also omits `scheduledOrder`, `locked`, `sourceId`, `goalId`, `workspaceId`, and `updatedAt` even though the API declares them (`apps/api_server/src/models/task.ts:9-35`).
- **Boundary:** Task CRUD and collaborator routes (`apps/api_server/src/routes/tasks_routes.ts:8-16`) with canonical statuses `open | in_progress | waiting_for_reply | done` (`apps/api_server/src/models/task.ts:7`).

### Rhythms

- **Flutter:** Rule and user load; weekly/monthly/annual scheduling; step assignees; sequential/enabled behavior; progress; collaborators; CRUD.
- **React:** Fixture list/detail/editor, enable toggle, collaborator editor, and delete confirmation.
- **React cannot:** Execute any rule read or mutation against the API.
- **Boundary:** `RecurringTaskRule` and DTOs (`apps/api_server/src/models/recurring_task_rule.ts:1-69`) via the recurring-rule routes used by Flutter.

### Projects

- **Flutter:** Template and template-step CRUD; generate/list/update/delete instances; update steps; milestone create/assign/delete; instance collaborators.
- **React:** Fixture template/instance views with equivalent-looking editors and receipts.
- **React cannot:** Execute any Projects operation against the API or reload the persisted result.
- **Boundary:** Template routes (`apps/api_server/src/routes/project_templates_routes.ts:10-20`) and instance/step/milestone/collaborator routes (`apps/api_server/src/routes/project_instances_routes.ts:8-21`).

### Messages

- **Flutter:** Visible-thread list, participant selection, direct/group creation, message read/send, read/unread state.
- **React:** Fixture threads, search, create/reply/read/unread, plus rename/delete UI.
- **React cannot:** Execute Flutter's messaging capabilities live. Also, rename/delete are not present in the current API route declaration and must not be treated as persisted capabilities (`apps/api_server/src/routes/messages_routes.ts:8-14`).
- **Boundary:** `MessageThread`, `Message`, `CreateThreadDto`, and `CreateMessageDto` (`apps/api_server/src/models/message.ts:1-40`).

### Facilities

- **Flutter:** Facilities, overview and per-room reservations, grouped multi-room reservations, recurring series, conflict results, and automation-reservation cleanup.
- **React:** Detailed fixture calendar/room editors, grouped/series flows, conflicts, and automation cleanup presentation.
- **React cannot:** Execute any facility/reservation operation live. Its local `start`/`end`, `creatorId`, `external`, `conflicted`, and `automation` names are view-model fields, not API vocabulary (`apps/web/src/pages/facilities/fixtures.ts:1-21`).
- **Boundary:** Full authenticated route surface (`apps/api_server/src/routes/facilities_routes.ts:8-55`) and mixed response/request vocabulary declared in `facility.ts` (`apps/api_server/src/models/facility.ts:1-25,28-48,85-105,107-151,172-185`).

### Automations

- **Flutter:** Server catalogs determine available providers/triggers/actions; connected accounts and provider-specific options constrain the builder; rule preview/CRUD/enable/resync are live.
- **React:** Fixture catalogs and rules with local builder/preview/enable/delete/resync behavior.
- **React cannot:** Load server catalogs/prerequisites, persist or resync rules, or submit several of its current fixture literals successfully.
- **Boundary:** Authenticated catalog endpoints (`apps/api_server/src/routes/automation_catalog_routes.ts:8-11`) and rule endpoints (`apps/api_server/src/routes/automation_rules_routes.ts:8-15`).

### Integrations

- **Flutter:** Account state, three OAuth starts (Google user, Google agent intent, Planning Center), Calendar/Gmail/PCO sync, sync-all, Gmail signals, Calendar selection, PCO teams/positions.
- **React:** Fixture-only account panels, handoff receipt, local preference/sync status, and local AI-import simulation.
- **React cannot:** Start real authorization, observe callback/account state, sync, persist preferences, load signals/options, or import records into the API.
- **Boundary:** Authenticated integration routes (`apps/api_server/src/routes/integrations_routes.ts:8-41`) plus auth begin routes used by Flutter (`origin/main:apps/desktop_flutter/lib/features/integrations/data/integrations_data_source.dart:32-49`).

## Canonical persisted/API vocabulary

These names and value shapes come from API type declarations or service return declarations, not UI labels.

| Family | Canonical vocabulary confirmed | Evidence |
|---|---|---|
| Dashboard | `DashboardSummary { tasks, rhythms, projects, goals, messages }`; task counts/lists include `openCount`, `pastDueCount`, `pastDeadlineCount`, `todayRemainingCount`, `todayTotalCount`, `thisWeekRemainingCount`, `thisWeekTotalCount`, `unscheduledCount`, `recent`, `pastDue`, `today`, `thisWeek`, `unscheduled`; projects use `activeCount`, `items`, `onDeckSteps`; messages use `threadCount`, `unreadPreviews`. | `apps/api_server/src/models/dashboard_summary.ts:12-28,53-68,87-106` |
| Planner | `WeeklyPlan { weekLabel: string, weekStart: string, days: { date: string, tasks: Task[] }[], backlog: Task[] }`; scheduling fields are `scheduledDate`, `scheduledOrder`, `locked`; observed planner `sourceType` values are `project_step` and `calendar_shadow_event`. | `apps/api_server/src/services/weekly_planning_service.ts:7-17,142-165`; `apps/api_server/src/repositories/project_instances_repository.ts:118`; `apps/api_server/src/models/task.ts:13-20` |
| Tasks | `TaskStatus = 'open' | 'in_progress' | 'waiting_for_reply' | 'done'`; `Task` fields: `id`, `title`, `notes`, `dueDate`, `scheduledDate`, `scheduledOrder`, `locked`, `status`, `sourceType`, `sourceId`, `sourceName`, `startsAt`, `endsAt`, `isAllDay`, `ownerId`, `goalId`, `priority`, `tags`, `energy`, `workspaceId`, `isShared`, `collaborators`, `createdAt`, `updatedAt`, `preferredAgent`; collaborator fields are `userId`, `name`, `photoUrl`. | `apps/api_server/src/models/task.ts:1-35` |
| Rhythms | `frequency: 'weekly' | 'monthly' | 'annual'`; rule fields `id`, `title`, `dayOfWeek`, `dayOfMonth`, `month`, `enabled`, `sequential`, `ownerId`, `goalId`, `steps`, `collaborators`, `progress`, `createdAt`; steps use numeric/null `assigneeId`, `dayOfWeek`, `dayOfMonth`, `month`. | `apps/api_server/src/models/recurring_task_rule.ts:1-69` |
| Projects | Template fields `id`, `name`, `description`, `anchorType`, `ownerId`, `createdAt`, `steps`; template-step fields `templateId`, `offsetDays`, `offsetDescription`, `sortOrder`, numeric/null `assigneeId`; instance fields `templateId`, `name`, `anchorDate`, `status`, `ownerId`, `goalId`, `isShared`, `milestones`, `steps`; instance-step status is `'open' | 'done'`. | `apps/api_server/src/models/project_template.ts:1-40`; `apps/api_server/src/models/project_instance.ts:1-51` |
| Messages | Thread fields `id: number`, `title`, `threadType: 'direct' | 'group'`, `taskId`, `createdBy`, `createdAt`, `updatedAt`, `lastMessage`, `unreadCount`, `isUnread`, `participants`; message fields `id: number`, `threadId: number`, `senderId`, `senderName`, `body`, `createdAt`; create uses `participantIds`, `threadType`, `title`, `taskId`. | `apps/api_server/src/models/message.ts:1-40` |
| Facilities | Response fields use camelCase: `facilityId`, `seriesId`, `groupId`, `requesterName`, `requesterUserId`, `createdByUserId`, `startTime`, `endTime`, `externalEventId`, `externalSource`, `createdByRhythm`, `isConflicted`, `conflictReason`; create/update DTO request keys use snake_case such as `facility_ids`, `requester_name`, `start_time`, `end_time`; `recurrence_type` is `'weekly' | 'biweekly' | 'monthly' | 'custom'`. | `apps/api_server/src/models/facility.ts:28-48,85-151,172-185` |
| Automations | `source: 'rhythm' | 'planning_center' | 'google_calendar' | 'gmail'`; `actionType: 'create_task' | 'create_project_from_template' | 'auto_schedule' | 'send_notification' | 'tag_task' | 'create_reservation'`; `Condition.operator` is `equals | not_equals | contains | not_contains | greater_than | less_than`; trigger keys are the exact `rhythm.*`, `planning_center.*`, `google_calendar.*`, and `gmail.*` literals declared by `AutomationTriggerKey`; rule account field is `sourceAccountId`, not `accountId`. | `apps/api_server/src/models/automation_rule.ts:1-88` |
| Integrations | `IntegrationProvider = 'google_calendar' | 'gmail' | 'planning_center'`; persisted account `status: 'connected' | 'error'`; account fields include `externalAccountId`, `email`, `displayName`, `scope`, `expiresAt`, `lastSyncedAt`, `errorMessage`; Calendar preference is `selectedCalendarIds`; PCO preference is `{ teamIds: string[], positionNames: string[] }`; options are `teams` and `positionsByTeamId`. | `apps/api_server/src/models/integration_account.ts:1-23`; `apps/api_server/src/models/planning_center_task_preferences.ts:1-20`; `origin/main:apps/desktop_flutter/lib/features/integrations/models/google_calendar_settings.dart:30-46` |

## Inventory conclusion

The Phase 3 React pages are broad UI prototypes, not broad live clients. The current live operational boundary is basic Task CRUD only. Phase 3 must therefore build eight family gateways, complete the Task gateway, connect operational quick actions, and replace invalid view-model literals at the API boundary before packaged parity can be claimed.
