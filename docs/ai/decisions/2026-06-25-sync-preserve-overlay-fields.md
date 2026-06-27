---
date: 2026-06-25
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Sync must preserve user-owned overlay allowlist fields

## Context

`syncOpencodeAgentProfiles` (apps/api_server/src/services/agent_profile_sync.ts)
mirrors the opencode agent registry into `agent_configs`. It runs on POST
`/agent-configs/sync-opencode` and again at SessionStart (via `listAgents`).

On UPDATE of an existing row it correctly preserved user-set `systemPrompt`,
`modelProvider`, and `modelId` (backfill-when-null), but it wrote
`allowed_delegates_json` **unconditionally** to the importer-derived value —
which is `null` for every agent except `workflow-orchestrator`. So every sync
silently nulled a user's delegate scope, and regenerated the orchestrator's
delegates over any user edit. Live symptom: Secretary lost its
`allowed_mcps_json` scope after a sync and had to be re-PATCHed.

These three columns are USER-OWNED overlay fields edited in the Rhythm profile
designer:

- `allowed_mcps_json`
- `allowed_skills_json`
- `allowed_delegates_json`

## Decision

Treat all three overlay allowlists as user-owned: the sync may set them on
**first INSERT** only (importer defaults), and on **UPDATE** it must
backfill-when-null but **never overwrite** a value the user set — the same
preserve-when-set policy already applied to `systemPrompt` / `modelProvider` /
`modelId`. Engine-derived fields (`ocAgent`, `sessionSelectable`, including the
dev front-door selectable overrides) continue to refresh on every sync.

Concretely: `allowed_delegates_json` was moved out of the unconditional UPDATE
patch into a `existing.allowedDelegatesJson === null` backfill guard, matching
the existing `allowed_mcps_json` / `allowed_skills_json` handling.

## Alternatives considered

- **Drop the three fields from the UPDATE patch entirely (no backfill).**
  Rejected: legacy rows inserted before importer hygiene have `null` and benefit
  from a one-time backfill to the sane default; this also keeps parity with the
  existing mcps/skills backfill tests.
- **Keep importer-driven delegation for the manager only.** Rejected: the task
  is explicit that `allowed_delegates_json` is user-owned with no manager
  exception, and a user scoping the orchestrator's delegates must survive sync.

## Consequences

- The hygiene test `re-sync restores importer-driven manager delegation config`
  encoded the old overwrite contract; it was rewritten to assert preservation
  (`re-sync preserves a user-edited manager delegation override`).
- `is_manager` preservation is intentionally **out of scope** here — handled by a
  separate PR (the importer must not write `is_manager`). This change does not
  add or remove the `is_manager` write.
- A profile's designer-set MCP/skill/delegate scope now survives both the
  manual sync endpoint and the SessionStart sync.
