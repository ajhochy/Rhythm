---
index: "[[Rhythm]]"
date: 2026-06-23
repo: Rhythm
tags: [decision, Rhythm]
---

## Context

Issue C2 acceptance criteria specified: "add a version-pinned gmail MCP entry to `curated_mcp_servers.ts`" (e.g. `npx @some-org/gmail-mcp@1.2.3`). The issue also noted "Known Ambiguities — Gmail MCP package pin: the exact gmail MCP server package/command is unverified."

The parent dispatch prompt for the B1/C2/D1 implementation explicitly stated: "Rhythm's MCP email tools already exist: mcp_server/src/tools/google.ts → rhythm_search_gmail, rhythm_read_email, rhythm_send_email. (Use THESE — do NOT add any third-party gmail MCP, do NOT add an npx package, no pin needed.)"

## Decision

No third-party gmail MCP entry was added to `curated_mcp_servers.ts`. The `email-assistant.mcp.json` role file scopes the **rhythm** MCP server's existing email tools:
- `rhythm_search_gmail`
- `rhythm_read_email`
- `rhythm_send_email`

## Alternatives considered

1. Add a third-party npm gmail MCP package (rejected — parent prompt explicitly forbids; also the "Known Ambiguities" note confirmed the exact package/version was unverified at issue-write time).
2. Add a placeholder entry to curated_mcp_servers.ts for future use (rejected — would ship an unpinned/unverified entry, violating the pin-verification requirement).

## Consequences

- The email-assistant role works entirely via the rhythm MCP server's existing google.ts tools.
- No new npm package dependency or install risk.
- If a standalone gmail MCP package is later verified and pinned, it can be added to curated_mcp_servers.ts independently without changing the role file (role file already uses the rhythm server's tools, which broker Gmail OAuth).
- The existing `/integrations/gmail/signals` endpoint (slash) was not removed; the new `/integrations/gmail-signals` (hyphen) endpoint is additive.
