# Document + enforce the curated catalog as an install-template / enrichment layer

**Order:** 3 · **Depends on:** none · **Milestone:** Unify MCP source of truth

## Why

`config/curated_mcp_servers.ts` is the parallel "what you can install" list the
issue calls out. In practice it is **already** template-shaped (its consumers are
`ensureCuratedMcps` install + route enrichment, not display). But that role is
**implicit** — nothing documents or enforces it, so a future change could
re-introduce it as a display source and resurrect drift. This issue makes the
catalog's template-only role explicit and machine-checked, the direct analogue of
skills' "materialize-on-publish" decision.

## What

1. Add a clear header contract to `curated_mcp_servers.ts`: it is an
   **install-template + enrichment layer only**; the single source of truth for
   "what servers exist" is the live engine list (`GET /opencode/mcp`). Curated
   entries **materialize into** the engine via `ensureCuratedMcps`
   (materialize-on-install), mirroring skills' materialize-on-publish.
2. Add a guard test asserting the catalog is consumed only for
   template/enrichment (install config, `requiredEnv`, OAuth-url resolution,
   `/credentials`) — never returned as a standalone display list from any route.
3. Write the decision record
   `docs/ai/decisions/2026-06-28-unify-mcp-source-of-truth.md` (Context /
   Decision / Alternatives / Consequences), referencing #783, #781, #765 and the
   skills decision it mirrors.

## Acceptance criteria

1. `curated_mcp_servers.ts` header documents: engine is source of truth; catalog
   is template+enrichment; materialize-on-install via `ensureCuratedMcps`.
2. A test asserts no route returns `CURATED_MCP_SERVERS` (or a derivative) as a
   display/listing payload — display always comes from `GET /opencode/mcp`.
3. **Boundary:** `ensureCuratedMcps` remains idempotent (add-missing /
   refresh-changed / no-op-identical) and still skips token-bridged servers when
   no account is connected (existing behavior preserved — assert with a test or
   reference the existing one).
4. Decision doc exists with the four required sections and the `tags: [decision,
   Rhythm]` frontmatter.

## Likely files

- `apps/api_server/src/config/curated_mcp_servers.ts` (header contract)
- `apps/api_server/src/**/__tests__/curated_mcp_no_display.test.ts` (new)
- `docs/ai/decisions/2026-06-28-unify-mcp-source-of-truth.md` (new)

## Required tests

- Vitest: catalog is consumed only for enrichment/install; not surfaced as a
  display list.

## Data-safety / out-of-scope

- No behavior change to install/enrichment; docs + guard only.
- No OAuth changes, no DB columns.
- Auto-installer fate is issue 04; provenance flag is issue 02.

## Verification

- `cd apps/api_server && npx vitest run curated_mcp`.
