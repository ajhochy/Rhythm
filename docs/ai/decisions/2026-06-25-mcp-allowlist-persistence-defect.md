---
tags: [decision, opencode_fork]
date: 2026-06-25
---

# mcpAllowlist is not persisted to the database

## Context

The mcp-scope-02 patch added `mcpAllowlist` to the Session `Info` type and wired
it into `sessions.create()` input and `resolveTools()` in prompt.ts. The
integration test (mcp_allowlist_e2e.test.ts, Cases B/C/D) immediately failed,
proving the gate is not firing.

Root cause: the E2E test showed all 5 MCP tools being offered even when
`mcpAllowlist: { servers: ['rhythm'], tools: [] }` was passed to
`sessions.create()`. Investigation traced the issue to the persistence layer.

## Defect

Three files in the carried patch are incomplete:

1. **`src/session/session.sql.ts`** — `SessionTable` has no `mcp_allowlist` column.
   Without this column, the value is never written to SQLite.

2. **`src/session/session.ts` `toRow()`** — does not include `mcpAllowlist` in
   the returned object, so the Drizzle insert/update never sends the value.

3. **`src/session/session.ts` `fromRow()`** — does not reconstruct `mcpAllowlist`
   from a row, so `sessions.get()` (called by `runLoop`) always returns a session
   with `mcpAllowlist: undefined`.

When `runLoop` calls `sessions.get(sessionID)` the reconstituted session has no
allowlist. `filterMcpToolsByAllowlist` receives `undefined` and returns all keys
(back-compat pass-through), so all 5 MCP tools are always offered.

## Decision

The E2E integration test (test/session/mcp_allowlist_e2e.test.ts) was left in the
working tree as written — it correctly proves the defect. The test is NOT patched
around: Cases B/C/D must fail until the persistence defect is fixed.

Per coding-agent rules: STOP and report the defect; do not patch around it.

## Fix required

In a follow-up commit (after this decision is recorded):

1. `src/session/session.sql.ts`: add
   ```typescript
   mcp_allowlist: text({ mode: "json" }).$type<{
     servers: string[]
     tools: string[]
   }>(),
   ```
   to `SessionTable`.

2. `src/session/session.ts` `fromRow()`: add
   ```typescript
   mcpAllowlist: row.mcp_allowlist ?? undefined,
   ```

3. `src/session/session.ts` `toRow()`: add
   ```typescript
   mcp_allowlist: info.mcpAllowlist ?? null,
   ```

4. Re-run `bun test test/session/mcp_allowlist_e2e.test.ts` — all 4 cases must
   pass and show the correct console.log drops (5→3→1→0).

## Alternatives

- Mock `sessions.get()` in the test to return the allowlist directly — rejected;
  this would be a false green (stub bypasses the real path).
- Store `mcpAllowlist` only in memory (not DB) — rejected; sessions survive
  restart and child sessions need the allowlist from the parent's DB record.

## Consequences

- The E2E proof test is written and proves the defect is real.
- Cases B/C/D will remain failing until the 3-line persistence fix is applied.
- Once fixed, the test gives strong end-to-end coverage of the entire mcp-scope
  gate (DB persist → loop read → resolveTools → LLM request body).

## Resolution (2026-06-25)

**FIXED.** All three changes applied exactly as specified above, plus:

- Added drizzle migration `migration/20260625120000_add_session_mcp_allowlist/migration.sql`
  (`ALTER TABLE session ADD mcp_allowlist text;`).

Verification: `bun test test/session/mcp_allowlist_e2e.test.ts` — 4/4 PASS
(A=5 tools, B=3 rhythm_*, C=1 obsidian_get_file, D=0 tools).
Full suite: 325 pass, 0 fail. Typecheck: exit 0.
Run log: `docs/ai/runs/2026-06-25-mcp-scope-02-allowlist-persistence.md`.
