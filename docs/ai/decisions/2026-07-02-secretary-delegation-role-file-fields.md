---
tags: [decision, Rhythm]
---

# Reconcile secretary's manager/roster from .mcp-roles/secretary.mcp.json, not the DB (#883)

## Context

#883 found secretary correctly configured as a Manager profile
(`agent_configs.is_manager = 1`) with an `allowed_delegates_json` roster and a
system prompt that already says "delegate to the approved specialist," but
**missing `rhythm_delegate`** from its MCP tool scope
(`.mcp-roles/secretary.mcp.json` → `mcpServers.rhythm.allowedTools`) — so it
was authorized to delegate but had no tool to invoke it.

Investigating the roster and `is_manager` flag surfaced a deeper gap: neither
value has ANY canonical source in the git repo. `agent_profile_sync.ts`'s
`syncOpencodeAgentProfiles()` explicitly and intentionally never sets
`is_manager` (a hard invariant enforced by
`agent_profile_sync_hygiene.test.ts`'s "is_manager decoupling" tests), and
only backfills `allowed_delegates_json` for `workflow-orchestrator`
specifically (`deriveAllowedDelegates`). Read-only inspection of the live
local DB confirmed `secretary`'s actual roster (11 entries, some UUID-keyed,
some slug-keyed) exists ONLY as a hand-edit made through the Agent Profiles
designer UI — a fresh database, a wiped dev DB, or a new environment would
seed `secretary` as a non-manager with an empty roster, silently regressing
the intended design. The real canonical source for the INTENDED roster turned
out to be `~/.config/opencode/agents/secretary.md`'s `task:` permission
block — but that file lives outside this git repo (`~/.config/`) and is a
completely separate delegation mechanism (the opencode engine's own subagent
`task` tool, not the `rhythm_delegate` MCP tool `agent_delegation_service.ts`
authorizes) — editing it is out of scope for this repo's worktree.

## Decision

1. Add `"rhythm_delegate"` directly to `.mcp-roles/secretary.mcp.json`'s
   `mcpServers.rhythm.allowedTools`. This file is read LIVE (not cached, not
   synced) by `agent_sessions_controller.ts`'s `resolveMcpRole()` at every
   session-create call — editing it is both necessary and *sufficient* to fix
   the tool-scope gap; no separate sync step exists or is needed for this
   part.
2. Add two NEW, additive fields to the `.mcp-roles/*.mcp.json` schema:
   `isManager: boolean` and `allowedDelegates: string[]`, populated on
   `secretary.mcp.json` with `true` and a 7-member slug roster (theologian,
   librarian, worship-planning, worship-production, AI-Trend-Researcher,
   Theological-Researcher, fantasy-gm). These fields are documentation +
   intent, not consumed by `resolveMcpRole()` (which only reads
   `mcpServers`/`disabledMcpServers`).
3. Add `secretary_delegation_seed.ts`, a new boot-adjacent reconciliation
   module (mirrors the read-only role-file-reader pattern already established
   by `ministry_recipes_seed.ts` and `org_optimizer_seed.ts`) that backfills
   `agent_configs('secretary').is_manager` / `.allowed_delegates_json` from
   those two new fields — but ONLY when the column is still at its unset
   default (`is_manager = false` / `allowed_delegates_json = null`). This
   preserves the exact same "USER-OWNED overlay, backfill-once" contract
   `agent_profile_sync.ts` already uses for `allowed_mcps_json` /
   `allowed_skills_json` / `allowed_delegates_json` — a value set by a human
   in the designer is NEVER overwritten by this seed.
4. Call `seedSecretaryDelegation()` from the END of
   `syncOpencodeAgentProfiles()` (alongside the existing #858 `oc_agent`
   repair pass) rather than from `server.ts`'s boot sequence. Reason:
   `syncOpencodeAgentProfiles` is NOT invoked at server boot in this
   codebase — it only runs fire-and-forget on every
   `GET /agent-sessions/agents` call (agent picker load) and on-demand via
   `POST /agent-configs/sync-opencode`. A boot-only hook would almost always
   find `secretaryRowMissing` (the row doesn't exist yet that early) and be a
   permanent no-op in practice. Chaining onto the sync function itself
   guarantees the reconciliation runs as soon as the `secretary` row
   genuinely exists.

## Alternatives considered

- **Derive the roster generically for any `isManager` opencode agent inside
  `agent_profile_sync.ts`'s main loop**, the way `deriveAllowedDelegates`
  already special-cases `workflow-orchestrator`. Rejected: the loop's
  `is_manager` decoupling is a hard, test-enforced invariant — the importer
  must NEVER touch that column for any agent, full stop. A generic "read
  `isManager` from the role file for the CURRENT agent name" would require
  either loosening that invariant or awkwardly special-casing `secretary`
  inside the same function the hygiene tests scrutinize. A dedicated,
  clearly-scoped module (called once, after the loop, only for `secretary`)
  keeps that boundary completely intact while still solving the
  reproducibility gap.
- **Read `~/.config/opencode/agents/secretary.md`'s `task:` permission block
  directly** as the roster source, instead of adding new role-file fields.
  Rejected: that file lives outside the git repo and outside this worktree
  (per the assignment's explicit isolation contract) and is a different
  delegation mechanism (opencode's own subagent dispatch) from
  `agent_configs.allowed_delegates_json` (the `rhythm_delegate` MCP tool's
  authz). The two rosters can legitimately differ and reconciling them is a
  separate, larger concern — flagged as a follow-up, not solved here.
- **Backfill the full 11-entry live-DB roster** (including UUIDs) into the
  role file, to make the file match today's live state exactly. Rejected:
  the issue's minor observations flag the raw-UUID rendering as a cosmetic
  bug (relates to #858) — codifying UUIDs into a NEW canonical source would
  cement that bug rather than let a future #858-style fix resolve names
  cleanly. The slug-keyed subset is deliberately the CORRECT reproducible
  target, even though it's narrower than what a human has since added live.

## Consequences

- A fresh/rebuilt local database now seeds `secretary` as a working
  delegation hub (manager + roster + `rhythm_delegate` tool) with zero manual
  SQL or Agent Profiles UI steps — the durable fix the issue asked for.
- The CURRENT live DB (11-entry roster, some UUID-keyed) is completely
  unaffected by this change — the backfill-only contract means an
  already-non-null `allowed_delegates_json` is left exactly as a human set
  it. If that live value is ever reset to null, it will re-seed to the
  narrower 7-entry slug roster documented here, not the current broader one
  — worth flagging if that surprises a future maintainer.
- The opencode `task:` permission roster
  (`~/.config/opencode/agents/secretary.md`) and the `rhythm_delegate` MCP
  roster (`agent_configs.allowed_delegates_json`) remain two independently
  maintained lists that can drift. Reconciling them (e.g. generating one from
  the other) is out of scope for #883 and left as a follow-up.
