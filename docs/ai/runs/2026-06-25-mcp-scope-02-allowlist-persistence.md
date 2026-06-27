---
date: 2026-06-25
repo: Rhythm
branch: feature/agent-scheduler
pr: "#734 (draft, open — do not merge)"
issues: mcp-scope-02 (defect fix — persistence)
status: PASS
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# mcp-scope-02 defect fix — persist mcpAllowlist to SQLite

## Context

The mcp-scope-02 engine patch was verified passing in `2026-06-25-mcp-scope-02-engine-patch.md`,
but a subsequent e2e integration test (`mcp_allowlist_e2e.test.ts`) revealed a silent defect:
`mcpAllowlist` was carried on `Session.Info` in memory but **never persisted to SQLite**.
`toRow()` and `fromRow()` had no `mcp_allowlist` column, and `SessionTable` had no such column.
When `prompt.ts runLoop` re-fetched the session via `sessions.get(sessionID)`, the reconstituted
row had `mcpAllowlist: undefined`, so `filterMcpToolsByAllowlist` always received `undefined`
and passed all tools — the feature was silently dead end-to-end.

Cases B, C, D of the e2e test all failed (all 5 tools offered regardless of allowlist).

## Files changed

| File | Change |
|---|---|
| `apps/opencode_fork/packages/opencode/src/session/session.sql.ts` | Added nullable `mcp_allowlist text({ mode: "json" })` column to `SessionTable`, after `permission` |
| `apps/opencode_fork/packages/opencode/src/session/session.ts` | `fromRow()`: reads `row.mcp_allowlist ?? undefined`; `toRow()`: writes `info.mcpAllowlist ?? null` |
| `apps/opencode_fork/packages/opencode/migration/20260625120000_add_session_mcp_allowlist/migration.sql` | `ALTER TABLE \`session\` ADD \`mcp_allowlist\` text;` (hand-written migration) |
| `docs/ai/project-state.md` | Updated snapshot |

## Checks run

| Check | Result |
|---|---|
| `bun test test/session/mcp_allowlist_e2e.test.ts` | **4/4 PASS** — A=5 tools, B=3 (rhythm_*), C=1 (obsidian_get_file), D=0 |
| `bun test test/session/ src/session/` | **325 pass, 0 fail** (4 skip, 1 todo) |
| `bun run typecheck` | **exit 0** |

## Decisions

**Column type — nullable JSON text (no `.notNull()`):**
Matches how `permission` and `revert` are already stored. Nullable so all existing rows
(with NULL) load as `mcpAllowlist: undefined`, preserving back-compat: the gate in `prompt.ts`
passes all tools when `mcpAllowlist` is `undefined`. An explicit empty allowlist
`{servers:[], tools:[]}` serialises as `'{"servers":[],"tools":[]}'` (not NULL) and
round-trips correctly — Case D produces 0 tools as required.

**`toRow()` uses `?? null` / `fromRow()` uses `?? undefined`:**
The `null` side writes an explicit SQL NULL for absent allowlists (column is nullable, no default).
The `undefined` side reconstructs `undefined` on read rather than `null`, so the
`if (!mcpAllowlist)` guard in `filterMcpToolsByAllowlist` correctly treats missing-in-DB
as "no filtering" — identical to upstream behavior.

**Hand-written migration (not drizzle-kit generated):**
Drizzle-kit requires a live DB at the configured path (`/home/thdxr/.local/...` — wrong machine).
The `db.ts migrations()` function scans `migration/` for subdirectories containing
`migration.sql`, sorted by `YYYYMMDDHHMMSS` timestamp prefix — no journal file is needed.
A hand-written `ALTER TABLE session ADD mcp_allowlist text;` in a new timestamped directory
is the correct approach for this vendored fork. Timestamp `20260625120000` places it after
all existing migrations (latest was `20260511000411`).

## Round-trip correctness

| Case | mcpAllowlist value | DB column | fromRow result | tools offered |
|---|---|---|---|---|
| A (no allowlist) | `undefined` | `NULL` | `undefined` | 5 (all) |
| B (servers: ["rhythm"]) | `{servers:["rhythm"],tools:[]}` | JSON string | `{servers:["rhythm"],tools:[]}` | 3 |
| C (tools: ["obsidian_get_file"]) | `{servers:[],tools:["obsidian_get_file"]}` | JSON string | `{servers:[],tools:["obsidian_get_file"]}` | 1 |
| D (empty) | `{servers:[],tools:[]}` | `'{"servers":[],"tools":[]}'` | `{servers:[],tools:[]}` | 0 |

Note: Case D stores `'{"servers":[],"tools":[]}'` (not NULL) so it round-trips to the
empty-object shape, not `undefined`. This is the key correctness invariant.

## Follow-ups / deferred

- None. All 4 cases pass. The mcp-scope-02 defect is fully resolved.
- Next: local end-to-end proof (build fork binary, open Secretary session, confirm tool count drops), then mcp-scope-03 (CI binary bundle).
