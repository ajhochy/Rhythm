# MCP names-alignment + no-server-lost guards (test + real-binary smoke)

**Order:** 1 · **Depends on:** none · **Milestone:** Unify MCP source of truth

## Why

The MCP equivalent of the skills `smoke_skill_alignment.sh` guard is **missing
entirely**. Two invariants make or break MCP unification and are silent when
violated:

1. **Names alignment** — every name in a persisted/derived `allowed_mcps_json`
   MUST exist in the engine's live `GET /opencode/mcp` ids, or #765 per-session
   scoping matches nothing (the exact #781 hazard: picker/persisted `ableton`
   while the engine id is `ableton-mcp`; a leaked `foo` test server).
2. **No server lost** — listing/registration must be additive; a regression in
   the proxy or config writer must not silently drop a configured server.

These need automated guards so a future change can't regress them unnoticed.
This is the cheapest version that proves the single-source-of-truth invariant,
because both Flutter pickers already read the live list.

## What

Add an automated names-alignment **test** (api_server vitest) and a real-binary
**no-server-lost smoke** mirroring `tools/release/smoke_skill_alignment.sh` and
`tools/release/smoke_mcp_allowlist.sh`, wired into CI.

## Acceptance criteria

1. **Names-alignment test:** given a stored/derived `allowed_mcps_json` (including
   the importer default `["rhythm"]` and any `agent_profile_sync`-derived MCP
   scope), every name in it exists in the `GET /opencode/mcp` id set; the test
   **fails loudly** if any name is absent.
2. **Boundary — stale alias fails:** a fixture containing a stale display name
   (`ableton` when the live id is `ableton-mcp`, or `nfl-mcp` vs `nfl_mcp`) or a
   `foo` test-only server makes the alignment test fail (proving it catches #781).
3. **No-server-lost check:** the set of `GET /opencode/mcp` names before any
   provenance/enrichment mapping is a subset of the set after — no configured
   server disappears through the proxy. Asserted against the **built** fork binary
   in the smoke.
4. The real-binary smoke runs a list→scope round-trip on the built binary and is
   wired into `.github/workflows/desktop_release.yml` alongside the existing
   `smoke_skill_allowlist.sh` / `smoke_skill_alignment.sh` / `smoke_mcp_allowlist.sh`.
5. **Done-definition:** both guards run green in CI on the clean tree; a
   deliberately-injected stale name or dropped server makes them fail.

## Likely files

- `apps/api_server/src/**/__tests__/mcp_names_alignment.test.ts` (new)
- `tools/release/smoke_mcp_alignment.sh` (new; model on `smoke_mcp_allowlist.sh`)
- `.github/workflows/desktop_release.yml` (wire the smoke)

## Required tests

- The guards themselves are the tests. Verify they fail on an injected violation
  (stale alias, `foo`, dropped server) and pass on the clean tree.

## Data-safety / out-of-scope

- Read/verify only; no production data, no DB column changes.
- Real-binary smoke must use the **built** binary; re-sign ad-hoc if copied
  (`cp` breaks the signature → SIGKILL rc=137).
- Does **not** repair persisted user rows — that policy decision is issue 05.
- Must not touch the OAuth/DCR flow or #765 enforcement semantics.

## Verification

- `cd apps/api_server && npx vitest run mcp_names_alignment`.
- Run `tools/release/smoke_mcp_alignment.sh` locally against the built fork;
  confirm CI wiring with `gh run watch` (background).
