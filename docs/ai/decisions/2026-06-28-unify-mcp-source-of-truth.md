---
date: 2026-06-28
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Curated MCP catalog is an install-template + enrichment layer; the live engine is the source of truth

## Context

Rhythm exposes MCP servers to the user through the Flutter pickers and the
`/opencode/mcp` routes. There are two artifacts that could each look like "the
list of MCP servers":

- **The live engine list** — `opencodeClient.listMcp()` (the opencode engine's
  own MCP status map), surfaced by `GET /opencode/mcp`. This is what the model
  actually has access to and what the UI displays.
- **`CURATED_MCP_SERVERS`** (`apps/api_server/src/config/curated_mcp_servers.ts`)
  — the curated set Rhythm offers to install (pdf-tools, canva, notion, stripe,
  mailchimp), with per-server `requiredEnv`, transport (`local`/`remote`), and an
  optional OAuth `tokenProvider` bridge.

This mirrors the skills situation resolved in
`2026-06-28-unify-skills-source-of-truth.md`: there, three hardcoded skill-name
lists drifted from the engine's real `GET /skill` set. For MCP, the catalog is
**already template-shaped in practice** — its only consumers are
`ensureCuratedMcps()` (install) and route-level enrichment/lookup, NOT display.
But that role was **implicit**: nothing documented or enforced it. The file's own
header even called `CURATED_MCP_SERVERS` "the source-of-truth list", and a future
change could innocently wire `res.json(CURATED_MCP_SERVERS)` into a route and
resurrect the exact parallel-list drift the skills work just eliminated.

This is the MCP half of the source-of-truth unification, following the MCP-scope
enforcement work (#765) and alongside the engine-provenance (#786) and
names-alignment (#785) items; #781 tracked the broader catalog/display split.

## Decision

Make the **live engine list (`GET /opencode/mcp`) the single source of truth**
for "what MCP servers exist", and pin `CURATED_MCP_SERVERS` as an
**install-template + enrichment layer ONLY**:

1. **Header contract** on `curated_mcp_servers.ts` states it plainly: the engine
   is the source of truth; the catalog materializes INTO the engine via
   `ensureCuratedMcps()` (materialize-on-install), mirroring how published DB
   skills materialize into the engine's file store on publish
   (materialize-on-publish). It enumerates the only sanctioned consumers
   (install config, `requiredEnv` enrichment in `GET /opencode/mcp`,
   `/credentials` validation, OAuth-URL resolution) and forbids returning the
   catalog (or a derivative) as a standalone display payload.
2. **Guard test** `apps/api_server/src/__tests__/curated_mcp_no_display.test.ts`
   enforces it three ways: (g1) `GET /opencode/mcp` returns exactly the engine's
   live servers — a non-curated engine server appears, curated-but-unreported
   servers are absent, and an empty engine yields an empty listing despite the
   non-empty catalog; (g2) `ensureCuratedMcps()` stays idempotent (add-missing /
   refresh-changed / no-op-identical) and skips token-bridged servers when no
   account is connected; (g3) a static check that `opencode_mcp_routes.ts` never
   ships the bare catalog array to a client and only consumes it via `.find(`
   lookups.
3. **No change to the catalog's server definitions** or to `ensureCuratedMcps`
   behavior — this is documentation + enforcement of the existing, already-correct
   architecture, not a behavioral change.

## Alternatives considered

- **Leave it implicit (do nothing).** The catalog is already template-shaped, so
  today's behavior is correct. Rejected: nothing prevents a future route from
  treating it as a display source, which is precisely the drift the skills work
  showed is easy to re-introduce and hard to notice. A header + a guard test cost
  little and lock the boundary in.
- **Delete the catalog and have the engine own everything.** The engine cannot
  carry Rhythm's install templates (verified npm pins, `requiredEnv` for the
  needs-credentials UI, the OAuth token-bridge metadata). Rejected — the catalog
  is the install-template layer by necessity; the fix is to name that role, not
  remove it.
- **Move enrichment data onto the live engine entries instead of looking it up.**
  Larger change to the engine/fork surface for no drift-prevention benefit;
  `requiredEnv` enrichment by `findCuratedServer` is already a pure lookup keyed
  on the live entry's name. Rejected as out of scope (overlaps #786's provenance
  work).

## Consequences

- The catalog's role is now explicit and test-enforced: any attempt to surface
  it as a display/listing payload fails `curated_mcp_no_display.test.ts` (proven
  by falsification — injecting `res.json(CURATED_MCP_SERVERS)` into `GET /` failed
  4 of the suite's 7 assertions).
- Display always comes from the engine, so the MCP picker can never drift from
  what the engine can actually run — the MCP analogue of the skills guarantee.
- No runtime behavior changed; no fork rebuild or signed release is required for
  this issue (header comment + new test + decision doc only).
- The existing idempotency coverage (`opc_curated_mcp_ensure.test.ts`) and
  token-bridge skip coverage (`opc_curated_mcp_token_bridge.test.ts`) remain the
  deep tests; the new guard re-pins the boundary next to the display guard so the
  contract reads as one unit.
- Mirrors `2026-06-28-unify-skills-source-of-truth.md`: engine = source of truth,
  Rhythm-owned config = a layer that materializes INTO the engine.
