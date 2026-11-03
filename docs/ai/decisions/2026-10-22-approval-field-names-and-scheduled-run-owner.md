---
date: 2026-10-22
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

## Context

Two security boundaries failed safely but wrongly on 2026-10-22.

An approval minted from `security_payload` in a tool's argument names (`due_date`) could never match the tool's consumed payload (`dueDate`).

A scheduled-run session that a human continued could not pass the strict owner check. Legacy schedules have no creator, so their runs were ownerless.

## Decision

1. The approval digest compares **top-level field names in one spelling** (snake_case maps to camelCase). This matches the equivalence consume already applies when binding a payload to signed MCP arguments. Values, nested keys and single use stay exact. A payload that names one field twice is refused.
2. A scheduled run is owned by its schedule's creator, or else by the **local operator**: the sole paired mobile user, on loopback SQLite only, and nobody when that is ambiguous or hosted. Existing ownerless scheduled sessions are attributed at boot by the same rule. The delegation owner check stays strict.
3. Async delegation remains interactive-chat only (#1123); scheduled runs, including human-continued ones, use synchronous delegation.

## Alternatives considered

- Treat an ownerless session as shared for delegation. Rejected: it relaxes a deliberate "never delegate as nobody" rule.
- Claim a session when a human prompts it. Not possible: the desktop's WebSocket input path carries no user identity.
- Normalize nested keys too. Rejected: nested maps (e.g. MCP server names) are data, not field names.
- Rewrite schedule creators in a backfill. Rejected: that would change schedule visibility. Only run sessions are attributed.

## Consequences

Scheduled runs now get owner-scoped memory injection for the operator, which matches pre-August behavior. Their sessions become owner-visible rather than unscoped.

Approvals minted before this change with snake_case keys still fail, but they expire within the approval TTL.

On a desktop with more than one paired user, scheduled runs stay ownerless until schedules record a creator.
