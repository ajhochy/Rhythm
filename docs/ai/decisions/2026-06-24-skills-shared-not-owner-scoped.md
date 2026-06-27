---
index: "[[Rhythm]]"
date: 2026-06-24
repo: Rhythm
tags: [decision, Rhythm]
---

# Skills are shared instance-wide (no owner scoping)

## Context

Odysseus's skill + memory stores are owner-scoped (`owner_user_id`) for multi-user
isolation. When porting the skill library into Rhythm, we had to decide whether
`agent_skills` rows carry an owner.

## Decision

`agent_skills` rows carry **NO `owner_user_id`** — skills are shared across the
whole Rhythm instance. Retrieval, injection, extraction, and the Flutter surface
all operate on the single shared set. This was an explicit user choice ("shared
across the rhythm instance").

## Alternatives

- **Per-user owner scoping (Odysseus default):** rejected — Rhythm's local agent
  server is single-tenant per install, and the user wants one evolving library
  the whole instance benefits from. Owner scoping would also reintroduce the exact
  per-user complexity the consolidation aimed to remove.

## Consequences

- Simpler schema + queries (no owner filter anywhere).
- A skill learned in any session helps all future sessions/tasks/recipes.
- If Rhythm ever becomes multi-tenant, owner scoping would need to be added back
  to `agent_skills` and threaded through retrieval/injection/extraction — noted
  as a known re-scoping cost.
