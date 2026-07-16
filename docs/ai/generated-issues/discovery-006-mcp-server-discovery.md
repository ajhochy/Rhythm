# Discovery-006: Discover & adopt MCP servers to fill capability gaps (not just skills)

## Goal

Extend the "found" path so a capability gap can be filled by adopting an **MCP server** from a registry, not only a skill from skills.sh. The plumbing partly exists (`searchMcpCandidates`, `installCuratedMcp`/`ensureCuratedMcps`) but MCP discovery is off by default and under-wired. Turn it on: query an MCP registry for each eligible gap, judge candidates alongside skill candidates, and route wins through the same gap → proposal → human-approval → install flow.

## Context

`external_discovery_search.ts` already has an MCP-candidate branch, but `searchMcpCandidates` returns zero unless `RHYTHM_MCP_REGISTRY_SEARCH_URL` is set (`:293-295`) — so by default only skills.sh is live. On approval, MCP adoption installs via `installCuratedMcp` → `ensureCuratedMcps` (`org_proposal_appliers_wiring.ts:130-137`) but is `measurable: false` (one-shot install, no behavioral replay). The session-connected `mcp-registry` server (`mcp__mcp-registry__search_mcp_registry`, `suggest_connectors`) is a candidate backing source.

Some gaps are better solved by a tool/integration (an MCP server) than by a prose skill — e.g. "agent needed to query X API." This issue lets discovery pick the right *kind* of fix per gap.

## Likely files

- `apps/api_server/src/services/generators/external_discovery_search.ts` — `searchMcpCandidates` (`:293-295`), candidate shortlisting alongside skills (`candidateBeatsDraft` `:239-261`)
- `apps/api_server/src/services/generators/external_discovery_generator.ts` — proposal build (`:201`, `:262-275`), `buildChangeJson` (`:172-184`), gap-grounding gate (`:229-238`)
- `apps/api_server/src/services/org_proposal_appliers_wiring.ts` — `registerExternalAdoptionApplier` (`:389`, wired `:936`), `installCuratedMcp`/`ensureCuratedMcps` (`:130-137`), `buildRealExternalAdoptionDeps`
- MCP registry source: session `mcp-registry` tools, or a server-side HTTP client honoring `RHYTHM_MCP_REGISTRY_SEARCH_URL`
- `apps/mcp_server/src/tools/orgOptimizer.ts` — surface for the discovery run

## Acceptance Criteria

- [ ] **MCP candidate source live:** `searchMcpCandidates` returns real candidates from an MCP registry for a gap (via `RHYTHM_MCP_REGISTRY_SEARCH_URL` and/or the `mcp-registry` connector), not an empty list. Document the configured source and how it's set in dev vs prod.
- [ ] **Per-gap fix-kind choice:** for a given gap, discovery considers both skill candidates (skills.sh) and MCP candidates and shortlists the best fix regardless of kind, using the existing "strictly beats the would-be draft" judge posture. Ungrounded/"trending" candidates remain forbidden (`external_discovery_generator.ts:229-238`).
- [ ] **Injection pre-vet applies to MCP metadata:** MCP candidate descriptions/manifests pass the same `scanContextContent` injection pre-vet (`external_discovery_search.ts:183-189`) before being proposed.
- [ ] **Proposal + approval flow:** an MCP win produces an `external-adoption` proposal (`kind`/`external`/`provenanceJson`/`changeJson`) queued as `proposed`, never auto-applied (`org_optimizer_run_service.ts:376-382`). On approval it installs via `ensureCuratedMcps` and is reversibly wired to the needing agent.
- [ ] **Gap resolution:** adopting an MCP that fills a gap resolves that gap (or documents why MCP adoptions are `measurable: false` and how resolution is confirmed without behavioral replay — e.g. mark resolved on successful install + wire).
- [ ] **Security posture:** adopted MCP servers respect the existing per-agent MCP allowlist/scope model; a newly adopted server is not globally enabled without the allowlist wiring. Reference the `secretary MCP scope` enforcement lessons.
- [ ] **vitest:** cover (a) gap with an MCP registry hit → MCP candidate shortlisted; (b) MCP metadata failing injection scan → dropped; (c) approval installs via `ensureCuratedMcps` and wires scoped; (d) no auto-apply.
- [ ] `tsc --noEmit && npx vitest run` passes in `apps/api_server`.

## Dependencies

- **Discovery-005** (Postgres parity) for prod.
- **Discovery-004** (gap-driven trigger) — MCP discovery rides the same gap-triggered pass.
- Builds on the existing skill-discovery flow (this generalizes it to a second candidate kind).

## Out of Scope

- Auto-approving/enabling MCP servers without human review.
- Behavioral replay for MCP installs (skills keep the measure loop; MCP is install-time verified) unless trivially addable.
- Building a new MCP registry — use an existing registry/connector source.

## Data safety

- No customer/private data. Do not persist registry credentials in proposal rows.
- Newly adopted MCP servers must be scoped per-agent via the existing allowlist; never expose an adopted server's tools globally by default.
