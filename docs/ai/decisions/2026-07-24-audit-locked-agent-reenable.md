---
date: 2026-07-24
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Audit-locked agents require an exact reviewed transition

## Context

An ordinary `enabled` flag expresses an operator preference but is not a durable
security control. A generic update or database drift could re-enable an agent
that had been disabled after an audit, while cached registry/projection state
could keep it executable.

## Decision

Store an independent lock, reason, timestamp, and actor on `agent_configs`.
Treat that lock as authoritative across every execution and discovery boundary,
regardless of `enabled`. Only a dedicated reviewed-reenable operation can clear
it, and that operation must optimistically match the current reason and lock
timestamp. Append both lock and reviewed-reenable transitions to a security
event table that is not deleted with the profile.

The generic PATCH route may continue to manage ordinary enable/disable state,
but it cannot set lock metadata or enable a locked profile.

## Alternatives considered

- Reuse `enabled` alone: rejected because it cannot distinguish a preference
  from an audit hold and offers no reviewed transition.
- Add only a `disabled_reason`: rejected because reason presence can drift and
  is not an explicit execution guard.
- Make the dedicated transition last-write-wins: rejected because a reviewer
  could unknowingly clear a newer lock.

## Consequences

- Registry, projection, sessions, schedules, WebSocket turns, runners, and
  delegation must all enforce the same authoritative predicate.
- Lock and re-enable operations synchronize projection and live engine state.
- SQLite migrations and Postgres bootstrap must remain schema-compatible.
- Security events provide durable evidence even if an agent profile is later
  deleted.
