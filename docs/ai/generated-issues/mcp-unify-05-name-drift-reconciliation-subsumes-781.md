# Name-drift reconciliation for persisted `allowed_mcps_json` (SUBSUMES #781)

**Order:** 5 · **Depends on:** #1 (guard), #2 (provenance) · **Milestone:** Unify MCP source of truth

## Why

**This issue subsumes #781** (MCP picker name alignment). #781's symptom: the
picker showed `ableton` / `nfl-mcp` while the engine enforces `ableton-mcp` /
`nfl_mcp`, and a test `foo` server leaked — so a persisted `allowed_mcps_json`
name that does not exactly equal a live engine id silently scopes to **nothing**
under #765.

The picker side of #781 is already fixed (the hardcoded `_kAvailableMcps` array
is gone; both Flutter surfaces read live — see `current-plan.md`). What remains is
**the persisted/derived data**: a stored `allowed_mcps_json` produced before the
pickers went live can still carry a stale display name. Issue 01's guard *detects*
this; this issue defines and implements the *reconciliation policy*.

## What

Implement the drift-resolution policy (see open question 2 in `current-plan.md`):

- **Derived/default names** (from `agent_profile_sync`, expander output): normalize
  to the live engine id before persisting/using (e.g. resolve a hyphen/underscore
  or display-vs-id alias to the actual `GET /opencode/mcp` id).
- **User-entered persisted rows**: do **not** silently rewrite. Surface a stale
  name (via the provenance/alignment data) so the user/picker can re-pick; the
  scope falls back safely (the unmatched name simply enforces nothing, unchanged
  #765 back-compat) rather than erroring.
- **`foo` / test servers**: excluded from any template install and never
  normalized into a real scope.

Provide a small pure alignment helper (e.g. `mcp_name_alignment.ts`) that maps a
candidate name to the matching live id (exact match first, then a documented
alias/normalization rule) used by `agent_profile_sync` and the expander path.

## Acceptance criteria

1. A stale derived name (`ableton`) resolves to the live id (`ableton-mcp`)
   before it is used as scope; likewise `nfl-mcp` → `nfl_mcp` per the documented
   normalization rule.
2. A user-entered persisted name with no live match is **not** rewritten and does
   **not** crash scoping — it enforces nothing (existing #765 back-compat) and is
   surfaced as stale (via provenance/alignment), so issue 01's guard flags it.
3. **Boundary — `foo`:** never normalized into a real scope and never installed
   by a template path.
4. The expander (`mcp_allowlist_expander.ts`) still feeds #765 correctly — its
   `servers[]` entries remain raw live ids that match the fork's `keyToServer`
   map (no regression to `filterMcpToolsByAllowlist`).
5. **Done-definition:** issue 01's names-alignment test passes on the reconciled
   default/derived output; the `ableton`/`nfl-mcp`/`foo` fixtures from #781 are
   resolved or correctly surfaced.

## Likely files

- `apps/api_server/src/services/mcp_name_alignment.ts` (new pure helper) **or**
  an addition to `mcp_allowlist_expander.ts`
- `apps/api_server/src/services/agent_profile_sync.ts` (normalize derived names)
- `apps/api_server/src/services/agent_profile_scope.ts` (use the helper when
  resolving scope, if needed)
- `apps/api_server/src/**/__tests__/mcp_name_alignment*.test.ts` (new)

## Required tests

- Vitest: alias/normalization map (`ableton`→`ableton-mcp`, `nfl-mcp`→`nfl_mcp`);
  unmatched user name surfaced not rewritten; `foo` excluded; expander output
  still matches the fork allowlist contract.

## Data-safety / out-of-scope

- Must not silently mutate user-authored `allowed_mcps_json` rows (changing a
  user's scope without consent is a data-safety risk).
- No new DB columns; if added, backfill in `postgres_bootstrap.ts`.
- Do not change fork `mcp_allowlist.ts` matching semantics or the OAuth flow.

## Verification

- `cd apps/api_server && npx vitest run mcp_name_alignment mcp_allowlist_expander`.
- Re-run issue 01's `mcp_names_alignment.test.ts` — green on reconciled output.
