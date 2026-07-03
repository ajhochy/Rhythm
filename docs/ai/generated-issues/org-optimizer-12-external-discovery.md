# org-optimizer-12: External discovery & adoption (gated, highest risk)

## Goal

A less-frequent run that scouts external sources for new/popular skills, MCP
servers, and APIs and proposes `external-adoption` (HIGH, `external=1`) — but only
to fill a **detected** org gap, each carrying a mandatory provenance/security
note. Never auto-installed; on approval it flows through the existing curated-MCP
install / skill-create paths so the alignment guards still apply.

## Context

Per decision doc §6 — this is the single highest risk class (running third-party
code with scopes), above create-agent / delegation / webhook-wiring. **Compose
existing sources; do NOT build a crawler.** Sources: the connected `mcp-registry`
MCP (`search_mcp_registry`, `suggest_connectors`, `list_connectors`), the npm
registry, GitHub (trending/topics for MCP servers + skills + awesome-lists), and
`WebSearch` / the `deep-research` skill. These are agent-side MCP/skill calls
scoped to the external-discovery profile — not new server code.

## Likely files

- NEW `apps/api_server/src/services/generators/external_discovery_generator.ts`
  (orchestration + proposal writing + dedup + result cap; the actual searching is
  done by the scoped agent via MCP/skill calls, not by this module crawling)
- reuse `curated_mcp_servers.ts` / `ensureCuratedMcps()` and the skill-create path
  for the apply step (run only on approval, behind the queue)
- proposals repo; `.mcp-roles/<slug>.mcp.json` for the external-discovery profile

## Acceptance Criteria

- [ ] Every emitted `external-adoption` proposal references a concrete audit gap
  (`signal_ref` → `gapId`); a candidate with no matching gap is dropped (no
  "trending/popular" without a gap).
- [ ] Every proposal carries `provenance_json` with: source, stars/downloads,
  last-updated, maintainer, license, install command. **A proposal missing the
  provenance note is not emitted** (and the queue blocks approval without it).
- [ ] `risk='high'`, `external=1`; never auto-applied (not reachable from the auto
  path).
- [ ] On approval, an MCP adoption runs the curated-MCP install path and then the
  alignment guards must pass; a skill adoption runs the skill-create path. No
  bespoke install bypassing the guards.
- [ ] Throttled to its own (less-frequent) schedule, deduped against the
  already-suggested/rejected set, and result-capped per run.

## Required tests

- generator contract: candidate w/o gap → dropped; candidate w/ gap but no
  provenance → not emitted; valid candidate → high-risk external proposal w/
  provenance; approve → routes through the curated-MCP/skill-create path (mocked)
  and is rejected if the alignment guard would fail. **Security/provenance vetting
  is an explicit acceptance criterion** — approval is impossible without the note.

## Dependencies / order

Depends on 03 (gaps), 04, 10 (queue apply), 11 (UI). Seeded as a separate
less-frequent task in 14.

## Safety notes

Highest risk class — running external code with scopes. Strictly propose-only,
always gated, provenance-vetted, and routed through guard-enforcing install paths.
The discovery agent's role is scoped to the external sources + write-proposals; it
cannot install anything itself.
