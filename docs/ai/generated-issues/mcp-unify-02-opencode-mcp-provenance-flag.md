# `GET /opencode/mcp`: add a provenance flag (curated / rhythm / adhoc)

**Order:** 2 · **Depends on:** none · **Milestone:** Unify MCP source of truth

## Why

The skills proxy tags each entry `managed: boolean` so the UI can prove the
Rhythm-managed dir is the write surface and the rest is show+scope only. The MCP
proxy (`GET /opencode/mcp`) has **no equivalent provenance**, so there is no
machine-checkable way to assert that the curated catalog
(`curated_mcp_servers.ts`) is only a template/enrichment layer rather than a
parallel display source. Adding provenance makes the single-source-of-truth
claim verifiable and lets both Flutter surfaces label entries without re-deriving
from a hardcoded list.

## What

Extend each `GET /opencode/mcp` entry with a provenance field. Recommended shape:
`source: 'curated' | 'rhythm' | 'adhoc'` (curated = matches a
`CURATED_MCP_SERVERS` id/name; rhythm = the brokered rhythm MCP; adhoc =
user-added or otherwise discovered). A simpler `curated: boolean` is acceptable
if the rhythm-vs-adhoc split is deemed out of scope — pick one and document it.

The flag is **derived from the live engine list + the catalog**, never a second
display list. The catalog continues to drive `requiredEnv`/OAuth-url enrichment
exactly as today.

## Acceptance criteria

1. Every `GET /opencode/mcp` entry carries a provenance field whose value is
   derived from the live status map cross-referenced with `CURATED_MCP_SERVERS`
   (by id or name) — `curated` for catalog matches, otherwise `adhoc` (and
   `rhythm` for the rhythm MCP if the three-way split is implemented).
2. The live server **set is unchanged** by adding the flag — same names, same
   count as before (no-server-lost; aligns with issue 01's check).
3. **Boundary:** a server present in the live engine list but absent from the
   catalog is tagged `adhoc` (not dropped, not errored).
4. **Boundary:** the `foo` test server, if present in the live list, is tagged
   `adhoc` (it is never `curated`).
5. Existing fields (`status`, `needsCredentials`, `requiredEnv`, redacted
   `environment`, `url`) are unchanged; redaction still applies.
6. Routes keep the existing auth posture (`requireAuth` unless `AGENT_LOCAL`).

## Likely files

- `apps/api_server/src/routes/opencode_mcp_routes.ts` (add provenance in the GET
  mapper, reusing `findCuratedServer`)
- `apps/api_server/src/services/opencode_client_service.ts` (only if a helper is
  cleaner; prefer route-level)
- `apps/api_server/src/**/__tests__/opencode_mcp*.test.ts` (extend)
- Optionally `apps/desktop_flutter/lib/features/.../mcp_data_source.dart` +
  `opencode_mcp_data_source.dart` to parse the new field (display-only;
  non-blocking — may be a follow-up)

## Required tests

- Vitest: a curated server is tagged `curated`; an unknown/`foo` server `adhoc`;
  the entry set/count is byte-stable vs. the pre-flag list except for the added
  field.

## Data-safety / out-of-scope

- Read-only mapping; no DB columns, no writes, no OAuth changes.
- No name repair here (issue 05). No catalog content changes (issue 03).

## Verification

- `cd apps/api_server && npx vitest run opencode_mcp`.
