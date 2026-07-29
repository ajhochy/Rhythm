---
date: 2026-07-28
tags: [decision, rhythm]
issues: [1037]
---

# Adopt Leantime concepts: "one entity, many views" + Kanban now, seeds for the rest

## Context

Issue #1037 compared [Leantime](https://github.com/Leantime/leantime) (goals-focused,
neurodivergent-first PM, PHP/Laravel) against Rhythm's task management and produced a
ranked adoption plan: 1 Goals, 2 Kanban view, 3 tags+priority, 4 dopamine loop,
5 milestones; time tracking / wiki / canvases / retros out of scope.

This record deepens that with a field-by-field comparison against Leantime's actual
source (fetched 2026-07-28 from `Leantime/leantime@master`):
`app/Domain/Tickets/Models/Tickets.php` and
`app/Domain/Goalcanvas/Repositories/Goalcanvas.php`.

### Verified: Leantime ticket vs Rhythm task

Leantime has **one** `Tickets` model for everything — tasks, milestones, stories, bugs —
discriminated by a `type` field. Milestones are just tickets with `type = 'milestone'`
(plus `milestoneColor`); subtasks/dependencies are self-references
(`dependingTicketId`, `children`). Status is an **int** (default `3`) with per-project
configurable labels — not a fixed enum. `tags` is a plain comma-separated string
column, not a join table.

| Concept | Leantime `Tickets.php` | Rhythm `task.ts` | Notes |
|---|---|---|---|
| Title | `headline` | `title` | |
| Body | `description`, `acceptanceCriteria`, `outcomeImpact` | `notes` | Leantime splits desc / AC / impact |
| Kind | `type` (task/milestone/story/bug) | — (separate models per concept) | Rhythm: task vs rhythm vs project step are distinct tables |
| Status | `status` int, per-project labels | `status` 4-value string enum | Rhythm's enum is a strength for a board: fixed columns |
| Priority | `priority` | ✗ | Gap confirmed |
| Ordering | `sortIndex` | `scheduledOrder` | Equivalent — board drag-order reuses this |
| Dates | `date`, `dateToFinish`, `timeToFinish`, `editFrom`/`editTo` (start/end), `timelineDate(ToFinish)` | `dueDate`, `scheduledDate`, `startsAt`/`endsAt`, `isAllDay` | Rhythm's scheduled-vs-due split is finer than Leantime's |
| Effort | `storypoints`, `planHours`, `hourRemaining`, `bookedHours` | ✗ | Rejected (time tracking out of scope) |
| Tags | `tags` (comma string) | ✗ | Gap confirmed — Leantime's own impl is just a string column |
| Hierarchy | `dependingTicketId` (parent), `children[]`, `parentHeadline` | ✗ (rhythms have `sequential` step gating only) | Gap confirmed |
| Milestone link | `milestoneid`, `milestoneHeadline`, `milestoneColor` | ✗ | Milestone = self-referencing ticket, not a table |
| Sprint | `sprint` | ✗ | Not applicable to church staff |
| Project link | `projectId`, `projectName`, `clientName` | ✗ on Task (projects are template/instance steps) | Structural difference, not a field gap |
| People | `editorId` (assignee), `userId` (creator), `collaborators[]` | `ownerId`, `collaborators[]` | Comparable |
| Rollup | `doneTickets`, `allTickets`, `percentDone` (view-model fields) | `RecurringTaskRuleProgress.completionRatio` on rhythms | Rhythm already computes this — feed for dopamine loop |
| Provenance | — | `sourceType`/`sourceId`/`sourceName` | Rhythm-only (integrations) |
| Agent | `__toString()` "for AI consumption" (prose dump) | `preferredAgent` (routed execution) | Rhythm's agent layer is structurally deeper |
| Sharing | — | `isShared`, `workspaceId` | Rhythm-only |

### Verified: Leantime goal vs Rhythm

Goals are **not** a dedicated table: they are `zp_canvas_items` rows with `box='goal'`
on a `zp_canvas` board of `type='goalcanvas'` (the `Goalcanvas` repository extends the
generic `Blueprints` canvas base). Goal fields, per the repository's own SELECT:

| Purpose | Leantime field (`zp_canvas_items`) |
|---|---|
| Identity | `id`, `title`, `description`, `canvasId`, `box`, `author`, `sortindex` |
| Measurement | `metricType`, `startValue`, `currentValue`, `endValue`; legacy: `assumptions` (what's measured), `data` (current), `conclusion` (target), `kpi`, `data1`–`data5` |
| Health | `status` — `status_ontrack` / `status_atrisk` / `status_miss` label set |
| Timeframe | `startDate`, `endDate` |
| Links | `milestoneId` (varchar, links goal→milestone ticket), `relates`, `impact` |

Rhythm has no counterpart anywhere (`task.ts`, `recurring_task_rule.ts`,
`project_template.ts`, `project_instance.ts` all verified). Takeaway for a future
Rhythm Goals spec: a goal is essentially *title + metric (start/current/end) +
ontrack/atrisk/miss health + date range + links to work items*. Leantime's
canvas-item substrate is legacy baggage (`data1`–`data5`) we should not copy — a small
dedicated `goals` table is cleaner.

### Verified: views

Leantime renders Kanban / Table / List / Gantt / Calendar over the same `zp_tickets`
rows. Rhythm's `TaskFilter` (status/scheduledBefore/dueBefore/overdue/search) plus the
layered model→repo→controller→view pattern already supports the same discipline.

## Decision

1. **Adopt Leantime's "one entity, many views" discipline** as an architectural rule:
   new ways of looking at tasks are new Flutter views over existing rows and existing
   endpoints, never new entities or parallel stores.
2. **Implement the Kanban board view now** (this run, issue #1037 prototype): pure UI
   in `apps/desktop_flutter/lib/app/features/tasks/`, four fixed columns from the
   existing `TaskStatus` enum, card order from `scheduledOrder`, drag-between/within
   columns = existing `PATCH /tasks/:id` (`status`, `scheduledOrder`). **Zero API or
   schema change.** Complements the weekly planner; does not replace it.
3. **Defer** the remaining candidates to their own specs/issues (seed specs below).
4. **Reject** time tracking/timesheets, wikis, Lean/SWOT/business-model canvases,
   retrospectives, and Leantime's PHP-plugin + JSON-RPC extensibility model. Rhythm's
   extensibility bet is the agent layer (`preferredAgent`, local agent server on
   :4001), which is already structurally ahead of Leantime's "ticket `__toString()`
   for AI" approach.

### Seed specs for deferred items

**Goals (next, highest leverage).** New `goals` table: `id, title, description,
metricLabel, startValue, currentValue, targetValue, health('on_track'|'at_risk'|'off_track'),
startDate, endDate, ownerId, createdAt` — modeled on Leantime's
`metricType/startValue/currentValue/endValue` + ontrack/atrisk/miss, minus the canvas
substrate. Nullable `goalId` on `Task`, `ProjectInstance`, `RecurringTaskRule`.
Dashboard rollup + donut via the existing `dashboard_summary` aggregation. Additive
migration only; needs the Postgres backfill in `postgres_bootstrap.ts` per the known
SQLite/Postgres drift gotcha.

**Tags + priority.** Two additive columns on tasks: `priority INT NULL` (Leantime
proves an int column is enough) and `tags` (JSON array — do better than Leantime's
comma string). Extend `TaskFilter` with `tag?: string` and `minPriority?: number`;
surface as filter chips and a board "swimlane by tag" toggle later.

**Dopamine loop.** No schema change for phase 1: render the existing
`RecurringTaskRuleProgress.completionRatio` as a progress donut on rhythm cards +
dashboard, and add a brief completion affirmation on task-done. Phase 2 (optional):
one `energy` column on tasks (emoji/enum) as a weekly-planner ordering input —
Leantime's motivation rating, minus gamification sprawl.

**Milestones (only after Goals).** Optional `milestones` grouping on project
instances (`id, instanceId, title, dueDate, color, sortOrder`) + `milestoneId` on
instance steps; simple timeline view. Note Leantime models milestones as
self-referencing tickets — Rhythm should not, since project steps are already a
separate entity; a small grouping table fits the existing pattern better.

## Alternatives

- **Goals first** (issue's #1 rank): highest leverage but needs schema + migration +
  dual-engine backfill + dashboard work; Kanban ships value this run with zero API
  risk and exercises the "many views" discipline it depends on. Goals is next, not
  never.
- **Copy Leantime's unified ticket model** (one table, `type` discriminator, self-ref
  milestones/subtasks): rejected — Rhythm's separate task/rhythm/project models are
  its differentiator, and Leantime's own model shows the cost (80+ fields, `mixed`
  types, view-model fields inside the entity).
- **Adopt the plugin/JSON-RPC extensibility model**: rejected — agent layer is the bet.
- **Configurable status columns** (Leantime's per-project status labels): rejected for
  now; the fixed 4-status enum keeps the board dead simple and matches church-staff
  usage. Revisit only on real demand.

## Consequences

- Kanban prototype lands with no migration, no new endpoints, no data risk; rollback
  = delete the view.
- The "one entity, many views" rule constrains future feature PRs: a rejected PR shape
  is "new table that mirrors tasks for view X".
- Deferred items each need their own issue + spec; the seeds above are the starting
  briefs, and the Goals seed inherits the Postgres/SQLite drift obligation.
- We accept divergence from Leantime's data model (no unified ticket table), so future
  "import from Leantime"-style interop would need mapping — acceptable, not a target.
- Explicit rejections (time tracking, wiki, canvases, retros, plugins) are on record;
  re-opening any of them requires a new decision record.
