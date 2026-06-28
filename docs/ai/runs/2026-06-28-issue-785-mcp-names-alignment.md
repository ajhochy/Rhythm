---
date: 2026-06-28
repo: Rhythm
branch: worktree-agent-a8e47e60d1bc0fe28
pr: pending
issues: [785]
status: verified-pending-pr
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Run — #785 MCP names-alignment + no-server-lost guards

The MCP analogue of the #777 skill guards (`skill_names_alignment.test.ts` +
`smoke_skill_alignment.sh`). Two invariants, both silent when violated:

1. **Names alignment** — every name in a persisted/derived `allowed_mcps_json`
   (the importer default `["rhythm"]`, and any agent_profile_sync-derived MCP
   scope) must exist in the engine's live `GET /opencode/mcp` id set. A name
   absent from the live set silently scopes a #765 per-session allowlist to
   nothing (the #781 hazard: `ableton` vs `ableton-mcp`, `nfl-mcp` vs `nfl_mcp`,
   a leaked `foo`).
2. **No server lost** — the GET /opencode/mcp provenance/enrichment mapping
   (curated lookup → requiredEnv/needsCredentials/env-redaction) must be
   additive: the set of server ids OUT equals the set IN from `listMcp()`.

## Files changed

- `apps/api_server/src/__tests__/mcp_names_alignment.test.ts` (new) — fast
  in-CI vitest guard. Hits GET /opencode/mcp via `startTestServer` with a mocked
  engine; asserts OUT == IN and IN ⊆ OUT (no-server-lost), the importer default
  + a persisted profile `allowed_mcps_json` align with the live set, and a
  boundary case where `ableton`/`nfl-mcp`/`foo` fail the alignment check.
- `tools/release/smoke_mcp_alignment.sh` (new) — real-binary smoke modeled on
  `smoke_mcp_allowlist.sh`/`smoke_skill_alignment.sh`. Writes two `mcp` servers
  into opencode.json, asserts both survive the live `GET /mcp` listing
  (no-server-lost), then round-trips a live id through a per-session
  `mcpAllowlist` (#765/#781 names alignment).
- `.github/workflows/desktop_release.yml` — wired the smoke as a new step after
  `smoke_skill_alignment.sh`, before "Package macOS artifacts".

## Checks run

- `tsc --noEmit` (api_server) → 0 errors.
- `vitest run mcp_names_alignment.test.ts` → 5 pass on clean tree.
- Injected-failure demo: replacing the importer default with
  `['rhythm','ableton','foo']` failed with `dead names: ableton, foo`; reverted,
  re-ran → 5 pass.
- `vitest run` of 5 related files (mcp/skill alignment, m4_3 routes, profile-sync
  skill alignment, mcp_allowlist_expander) → 37 pass.
- `bash -n smoke_mcp_alignment.sh` → OK (shellcheck unavailable on host).
- verification-gate → PASS (commit 854216ed6).

## Notes

- **Stayed additive (in scope):** no edits to `opencode_mcp_routes.ts`,
  `curated_mcp_servers.ts`, `agent_profile_sync.ts`, or Flutter — only the new
  test + new smoke + the one workflow wiring line.
- **Decision:** the agent_profile_sync MCP path writes a STATIC
  `IMPORTER_DEFAULT_ALLOWED_MCPS_JSON = ["rhythm"]`; it does NOT intersect with
  the live MCP set the way the skill path does (Unify-3). This guard *detects*
  that drift but does not fix it.
- **Note for #789:** #789 owns building the reconciliation — adding the live-set
  intersection for `allowed_mcps_json` in `agent_profile_sync.ts`. Once it lands,
  this guard stays green by construction.
- **Real-binary portion is CI-only:** the fork binary is per-branch + gitignored
  (per AGENTS.md), so `smoke_mcp_alignment.sh`'s serve loop runs only in release
  CI; locally only `bash -n` was exercised. The vitest fully covers the
  proxy-level invariants.
