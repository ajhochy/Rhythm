---
index: "[[Rhythm]]"
date: 2026-07-11
repo: rhythm
tags: [decision, rhythm]
---

# Direction: borrow Leantime concepts to make task management more flexible (exploration #1037)

**Context:** Request to compare [Leantime](https://github.com/Leantime/leantime) (open-source, goals-focused, neurodivergent-first PM) against Rhythm and decide which concepts would make Rhythm more flexible/usable. Audit of the data models confirmed Rhythm's `Task` (`apps/api_server/src/models/task.ts`) has title, notes, due/scheduled date, `scheduledOrder`, `locked`, a 4-value status (`open → in_progress → waiting_for_reply → done`), source provenance, calendar fields, owner, sharing, collaborators, `preferredAgent` — and that priority, tags/labels, subtasks, dependencies, effort estimates, goals, and milestones are absent from all models. Rhythm's differentiators (recurring **rhythms**, template-driven **projects**, **AI-agent** layer) have no Leantime equivalent and must be protected. Full plan tracked in issue #1037.

**Decision:** Pursue a scoped, **additive** set of Leantime-inspired concepts as separate PRs, ranked by leverage:
1. **Goals as a first-class concept** — new `goals` table + nullable `goalId` on `Task`/`ProjectInstance`/`RecurringTaskRule`, with dashboard rollup. Highest leverage: gives every other object a "why."
2. **Kanban board view** over the existing 4 statuses — pure UI, no API change; complements (not replaces) the weekly planner.
3. **Tags + priority** on tasks — two additive columns, turns the existing `TaskFilter` into cross-cutting organization.
4. **Dopamine loop, lightly** — surface existing rhythm `completionRatio` as a progress donut + optional emoji motivation tag as weekly-planner input.
5. **Milestones/timeline grouping on projects** — only after Goals lands.

Adopt Leantime's **"one entity, many views"** discipline (goals/board/timeline are lenses over the same rows), which Rhythm's layered model→repo→controller→view pattern already supports.

**Alternatives considered:**
- *Clone Leantime broadly (time tracking, wikis, Lean/SWOT/Business-Model canvases, retrospectives)* — rejected; serves Leantime's startup/agency audience, adds surface area against Rhythm's simplicity, poor fit for church staff.
- *Copy Leantime's extensibility model (PHP plugin marketplace + JSON-RPC API)* — rejected; Rhythm's dual-endpoint + AI-agent architecture (`preferredAgent`, local agent server on :4001) is the more modern bet and its real differentiator.
- *Do nothing / status quo* — rejected; the task model lacks the flexibility (no goals/tags/priority/board) that the request targets.

**Consequences:**
- + All proposed changes are additive — no breaking changes to existing task/rhythm/project models; migration story in `apps/api_server/src/database/migrations.ts` stays simple.
- + Goals unlock dashboard rollups that the existing `dashboard_summary.ts` aggregation can host directly.
- + Board and tags reuse existing status + `TaskFilter` machinery, keeping first PRs cheap.
- - Goals touch three entities; needs a coherent schema decision (single `goals` table + FK vs. per-entity) before implementation.
- - Neurodivergent "dopamine" UI (donuts, motivation emoji) is design-sensitive; must land within the Rhythm 2.0 light theme tokens.
- Status: exploration only. No implementation committed. First implementation PR (Goals or Kanban) to be scoped next. Tracked in issue #1037.
