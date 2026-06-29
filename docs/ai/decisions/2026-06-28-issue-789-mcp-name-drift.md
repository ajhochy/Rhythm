---
date: 2026-06-28
repo: Rhythm
issues: [789, 781]
tags: [decision, Rhythm]
---

# #789 — MCP name-drift reconciliation: normalize DERIVED allowed_mcps to live engine ids

## Context

Under #765 the opencode fork enforces a per-session MCP scope by membership:
`mcpAllowlist.servers.includes(keyToServer[toolKey])`, where `keyToServer` maps
each tool back to its RAW live engine id (the `GET /opencode/mcp` / `listMcp()`
key). A scope name that does not EXACTLY equal a live engine id therefore
matches nothing and silently scopes the session to zero MCP tools — the #781
hazard:

- `ableton` (display name) vs the live id `ableton-mcp`
- `nfl-mcp` (hyphen) vs the live id `nfl_mcp`
- a leaked test-only `foo` that matches no real server

The picker side was already fixed (#unify-4/5 read live data). #785 added a
guard (`mcp_names_alignment.test.ts`) that DETECTS the drift. #789 reconciles
the persisted/derived DATA so the derived defaults can't carry a dead name.

## Decision

A small PURE helper `mcp_name_alignment.ts`:

- `alignMcpName(candidate, liveNames) → { resolved, matched }`
  1. **Exact** live id → return unchanged (exact always wins).
  2. **Canonical** match via `canonicalizeMcpName` (lowercase, strip `[-_]`
     separators, drop a single trailing `mcp` token) — resolve to the live id
     ONLY when exactly one live id shares the canonical form.
  3. **Ambiguous** (canonical matches >1 live id) → unresolved (never guess).
  4. **No match** → unresolved (`matched:false`); never invent an id.
- `normalizeDerivedAllowedMcps(json, liveNames)` — maps a DERIVED array to the
  matched live ids (input order, de-duped); drops unmatched names. Fail-safe:
  null/empty-live-set/non-array/invalid-JSON → passthrough. **all-dead → `[]`**
  (NOT null).

Chose canonical-form normalization over a hardcoded alias map because it covers
both #781 fixtures (`ableton`→`ableton-mcp`, `nfl-mcp`→`nfl_mcp`) generically
and needs no maintenance as servers are added.

Wired into the DERIVED default ONLY (`agent_profile_sync` INSERT +
UPDATE-backfill). User-authored `allowed_mcps_json` rows are reconciled
READ-ONLY — surfaced as stale by #785's guard — and NEVER silently rewritten
(AC#2). No new DB columns; no Postgres bootstrap change.

## Alternatives

- **Alias map (`{ableton: 'ableton-mcp', ...}`)** — rejected: brittle, needs
  hand-maintenance per server, doesn't generalize to the separator case.
- **Normalize in `agent_profile_scope` (read path)** — rejected: that path also
  reads USER rows, so normalizing there risks rewriting user data on every run
  (AC#2 violation). Normalization belongs at derived-name PRODUCTION.
- **all-dead → null (fail-open, like the skill `filterAllowlistToLive`)** —
  rejected for MCP: an empty MCP scope is a VALID #765 scope (no MCP tools);
  failing open to "unrestricted" would silently WIDEN a scope — the opposite of
  the drift fix. The skill path differs because locking an agent out of every
  skill is worse than fail-open; MCP has no such asymmetry.

## Consequences

- The importer default (`["rhythm"]`) is now resolved to the exact live id
  (e.g. `rhythm-mcp` if the engine drifted) before persisting. Today `rhythm` is
  already the live id, so this is mostly future-proofing + a generalizable hook
  for any future derived or expander-side name.
- `mcp_allowlist_expander.ts` is untouched: its `servers[]` still emits raw live
  ids matching the fork's `keyToServer` (AC#4). The helper is available to that
  path but the expander already receives live ids from the scope builder.
- #785's `mcp_names_alignment.test.ts` stays green on the reconciled default.
- Fail-safe: a momentary engine outage (empty live set / throwing `listMcp`)
  skips normalization, so a derived scope is never emptied or rewritten by an
  outage.
