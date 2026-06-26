---
tags: [decision, rhythm]
date: 2026-06-25
issue: "#747"
---

# is_system column for background/scheduler session exclusion

## Context

Issue #747 requires that background-loop sessions (spawned by the scheduler, skill harvester, skill improver, etc.) are excluded from the normal agent picker and session list in the Flutter UI. Without exclusion, every scheduled agent run would pollute the user-visible session list.

## Decision

Add a boolean `is_system INTEGER NOT NULL DEFAULT 0` column to `agent_sessions`. Scheduler-spawned sessions are tagged `is_system = 1` automatically in `_recordSession()` via the logic `isSystem: opts.isSystem ?? (!!opts.scheduledTaskId)`. `listAll()` and `listByProject()` filter with `WHERE is_system = 0`. `findById()` does NOT filter, preserving internal access.

## Alternatives considered

1. **Title-based filtering** — check for a magic prefix (e.g. `[scheduler]`) in the session title. Rejected: fragile if sessions are renamed, invisible to callers, and couples exclusion logic to display strings.
2. **Separate `system_sessions` table** — more schema churn with no benefit; joins add complexity for simple inclusion/exclusion.
3. **Separate API endpoint only** — expose system sessions via a different route and never write to `agent_sessions`. Rejected: breaks the existing stream-bridge pattern that persists SDK-level events as agent_sessions rows.

## Consequences

- Child sessions (#743, `upsertChildSession`) default to `is_system = 0` (they are user-visible by design).
- Skill-extract and skill-refine sessions do NOT create local `agent_sessions` rows at all (no `parentID` in the bridge event), so no tagging is needed for them.
- Postgres migration uses `ADD COLUMN IF NOT EXISTS` (safe on repeated runs). SQLite migration is guarded by `pragma table_info` check.
- `findById` remains unfiltered so internal services can always retrieve system session rows by id for status tracking.
