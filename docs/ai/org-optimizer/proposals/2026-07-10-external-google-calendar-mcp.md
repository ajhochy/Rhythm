---
kind: external-adoption
risk: HIGH
status: queued
signal_ref: "worship-planning.mcp.json notes.unregisteredMcps=[calendar]; notes.inertUntilRegistered=[calendar]"
date: 2026-07-10
---

## Candidate
**Name:** `@cocal/google-calendar-mcp`
**Gap filled:** The `worship-planning` agent role explicitly lists `calendar` in `unregisteredMcps` and `inertUntilRegistered` — the tools are scoped but the server is never materialized, making all four calendar tools (`list_events`, `get_event`, `list_calendars`, `list_events` write) completely inert. No calendar MCP server is in the curated catalog (`curated_mcp_servers.ts`), and the curated catalog comment notes that `google-workspace` was dropped because no installable package existed at the time of verification (2026-06-17). A real, installable Google Calendar MCP now exists with strong adoption.
**Source:** https://www.npmjs.com/package/@cocal/google-calendar-mcp / https://github.com/nspady/google-calendar-mcp
**Stars/Downloads:** 1,151 GitHub stars; 49,086 monthly npm downloads (as of 2026-07-10)
**Last updated:** 2026-06-01 (pushed); npm package 2026-06-01 v2.6.2
**Maintainer:** nspady (Nat Spady); GitHub Actions (OIDC-pinned publisher)
**License:** MIT
**Install:** `npx @cocal/google-calendar-mcp` or `npm install -g @cocal/google-calendar-mcp`

## Why it fills the gap
The `worship-planning` agent role already declares `calendar` tools (`list_events`, `get_event`, `list_calendars`) as allowed but marks the server `inertUntilRegistered` — meaning the role is wired but the MCP server is missing from the curated catalog, so those tool calls silently fail. Adding `@cocal/google-calendar-mcp` to the curated catalog as a local stdio server (OAuth token bridge via the existing `google` token provider, matching the `tokenProvider`/`tokenEnvKey` pattern already defined in `CuratedMcpServer`) would close this gap without any new wiring code. The server supports read/write calendar management with OAuth2, aligning with Rhythm's existing Google OAuth flow.

## Security / provenance note
- Package published via GitHub Actions OIDC (trusted publisher chain, not a personal API key) — same posture as `@modelcontextprotocol/ext-apps` in the existing curated catalog.
- Maintainer is an individual (nspady), not an org — single-maintainer risk. 1,151 stars and 321 forks indicate meaningful community validation but not enterprise backing.
- MIT license — no viral copyleft concern.
- Requires Google OAuth credentials. Rhythm already has a `google` `tokenProvider` bridge in `ensureCuratedMcps`; the token injection path exists.
- 45 open issues on the GitHub repo (modest for the project's age and star count). No known CVEs found in npm audit metadata.
- Checked: `@cocal/google-calendar-mcp` v2.6.2 — no insecure flag on the npm registry response.
- **Concern**: single-maintainer project; if maintainer abandons it, the install path breaks. Mitigated by: the server is local stdio (no remote data exposure), and the curated catalog can pin to a specific version.

## Human review required
This proposal is HIGH risk and must be manually reviewed and approved before any installation or adoption. Approval routes through `ensureCuratedMcps()` and the alignment guards — no bespoke install code.
