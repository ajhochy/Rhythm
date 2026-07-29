---
date: 2026-07-29
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Keep Postgres agent session project IDs as logical references

## Context

SQLite owns the local `projects` table and local workspace/project lifecycle.
The Postgres bootstrap intentionally has no `projects` relation, but the merged
bootstrap attempted to add `agent_sessions.project_id` with a foreign key to
`projects(id)`. Postgres therefore raised `42P01` during API startup and the
production container crash-looped.

## Decision

Keep `agent_sessions.project_id` as nullable `TEXT` in both engines. SQLite may
retain its informational local foreign-key declaration; Postgres stores the
same identifier without a physical foreign key because no Postgres parent table
exists.

## Alternatives

- Create a placeholder Postgres `projects` table: rejected because it invents a
  second project authority with no lifecycle or synchronization contract.
- Remove `project_id` from Postgres: rejected because Postgres activity and
  mobile ownership queries require the column.
- Drop or rewrite production data: rejected; the recovery is additive and
  preserves every existing row.

## Consequences

Postgres bootstrap succeeds on databases with no `projects` relation, remains
idempotent, and can store logical project IDs. Referential integrity for local
project IDs remains the responsibility of the local SQLite/project boundary.
