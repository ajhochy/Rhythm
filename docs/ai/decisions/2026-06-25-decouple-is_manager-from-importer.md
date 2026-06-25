---
date: 2026-06-25
tags: [decision, rhythm, api_server, agent-profiles, importer]
---

# Decouple is_manager from the OpenCode agent importer

## Context

`syncOpencodeAgentProfiles` (agent_profile_sync.ts) mirrors the opencode agent
registry into `agent_configs`. The other-agent work on `feature/agent-scheduler`
was about to add `isManager` writes to both the INSERT and UPDATE paths:

```ts
const isManager = name === DEV_FRONT_DOOR_PRIMARY;  // line ~350
// ...INSERT... isManager,                            // line ~368
// ...UPDATE... patch.isManager = isManager;          // line ~407
```

This conflated two distinct concepts:

- **session_selectable** — picker visibility (which agents appear in the
  AgentSelectorPill). This IS importer-driven and idempotent, driven by
  `DEV_FRONT_DOOR_PRIMARY` / `DEV_FRONT_DOOR_SECONDARY`.
- **is_manager** — delegator/default-agent designation. This should be
  user-controlled; any profile (e.g. Secretary) may hold the role. Every re-sync
  forcing `workflow-orchestrator` to `is_manager=true` would steal the flag from
  whichever profile the user actually designated.

## Decision

The importer MUST NOT write `is_manager` on either INSERT or UPDATE:

- **INSERT**: `isManager` is omitted from the `AgentConfigInput` passed to
  `repo.insert()`. The DB column `DEFAULT 0` means all imported rows start with
  `is_manager = false`.
- **UPDATE**: `isManager` is never included in the patch object. The existing DB
  value (whatever the user set) is preserved exactly.

`session_selectable` continues to be importer-driven (unchanged behaviour):
- `workflow-orchestrator` → `sessionSelectable = true`
- `superpowers`, `plan` → `sessionSelectable = false`
- All other agents follow the `mode === 'primary' && !INTERNAL_PRIMARY` rule.

## Alternatives considered

1. **Always clear `is_manager` on INSERT, backfill on UPDATE** — rejected; this
   still creates a race where a re-sync immediately after user designation would
   clear the flag.
2. **Let the importer set `is_manager` only if no other profile already holds it**
   — rejected; adds complexity and doesn't handle the case where the user wants to
   reassign the role without running a sync.

## Consequences

- Any profile can be designated manager via `repo.update(id, { isManager: true })`
  and that designation survives indefinite re-syncs.
- `workflow-orchestrator` does NOT auto-acquire `is_manager=true`; callers that
  depend on exactly-one-manager must set it explicitly via the API.
- The invariant is enforced by four new tests in
  `apps/api_server/src/__tests__/agent_profile_sync_hygiene.test.ts`:
  - `fresh INSERT defaults is_manager=false for every imported agent`
  - `re-sync does NOT force workflow-orchestrator is_manager=true`
  - `pre-set is_manager on a non-orchestrator profile survives re-sync`
  - `sessionSelectable for dev front-doors is unaffected by is_manager change`
