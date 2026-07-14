---
kind: external-adoption
risk: HIGH
status: queued
signal_ref: "curated_mcp_servers.ts DROPPED comment: 'google-workspace — @modelcontextprotocol/server-google-workspace does not exist on npm'; worship-planning and church-admin agents have no Google Drive/Docs/Sheets capability"
date: 2026-07-10
---

## Candidate
**Name:** `google_workspace_mcp` (taylorwilsdon)
**Gap filled:** The curated catalog explicitly records that `google-workspace` was dropped because `@modelcontextprotocol/server-google-workspace` did not exist on npm at verification time (2026-06-17). A highly-starred community server has since emerged (2,821 stars, 856 forks, pushed 2026-07-07) that provides Gmail, Google Calendar, Docs, Sheets, Drive, Chat, Forms, Tasks, and Search in a single MCP server. Church admin (`church-admin` role) and worship planning (`worship-planning` role) agents currently have no access to Google Drive or Docs — ministry resources (bulletins, council minutes, meeting agendas) stored in Drive are inaccessible to agents. This server would fill that gap for document-reading and meeting-prep workflows.
**Source:** https://github.com/taylorwilsdon/google_workspace_mcp
**Stars/Downloads:** 2,821 GitHub stars; 856 forks (as of 2026-07-10). No npm package — runs as a Python local server via `uvx` or `pip`.
**Last updated:** 2026-07-07 (last pushed)
**Maintainer:** taylorwilsdon (Taylor Wilson); individual maintainer, active
**License:** MIT
**Install:** `uvx google-workspace-mcp` (uv/uvx) or `pip install google-workspace-mcp && python -m google_workspace_mcp`

## Why it fills the gap
The curated catalog's own comment flags this as a known-missing capability with a forward note: "no installable npm package exists." That condition has changed — a Python-based local server (2,821 stars, last pushed 2026-07-07) now fills exactly this gap. It would be wired as a `type: 'local'` curated entry with `command: ['uvx', 'google-workspace-mcp']` and the existing `tokenProvider: 'google'` bridge (the token injection path in `ensureCuratedMcps` already handles this pattern). Covers Google Docs and Drive reading that church-admin and worship-planning agents cannot currently do.

## Security / provenance note
- Python server, not a Node.js package — does not appear on npm; install path is `uvx` (uv package manager) or pip. This deviates from the curated catalog's current npm-only pattern; the `command` field would need to invoke `uvx` or `python`, which adds a runtime dependency on `uv`/Python being installed on the host machine.
- Individual maintainer (taylorwilsdon); no org or trusted-publisher chain. 2,821 stars indicates community trust but not enterprise vetting.
- MIT license.
- Requires Google OAuth credentials; Rhythm's `tokenProvider: 'google'` bridge is compatible in principle, but a Python server's environment-variable injection needs to be verified against the `ensureCuratedMcps` mechanism (which currently only validates node/npx command patterns).
- **Concern 1**: Python/uv runtime dependency on the host — Rhythm's existing curated servers are all Node.js. Adding a Python dependency introduces a new host requirement.
- **Concern 2**: 137 open issues (higher ratio than `@cocal/google-calendar-mcp`). Active but some instability signals.
- **Concern 3**: Significantly broader scope than the calendar gap — adds Gmail, Docs, Drive, Sheets, Chat, Forms, Tasks, Search. This may be more scope than needed and should be scoped by tool allowlist in the role files.
- Checked: no known CVEs; active commit history; last pushed 3 days before this proposal.

## Human review required
This proposal is HIGH risk and must be manually reviewed and approved before any installation or adoption. The Python runtime dependency, broader scope, and deviation from the Node.js curated-server pattern all require explicit human sign-off. Approval routes through the existing curated-MCP install path and alignment guards.
