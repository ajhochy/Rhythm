---
index: "[[Rhythm]]"
date: 2026-06-16
repo: rhythm
tags: [decision, rhythm]
---

# MCP-7: curated MCP server registry completed to 7 + credential approaches

**Context:** `CURATED_MCP_SERVERS` (apps/api_server/src/config/curated_mcp_servers.ts) is the source-of-truth list Rhythm auto-installs into the user's opencode.json via `ensureCuratedMcps()`. MCP-2 shipped pdf-tools; MCP-6 added the two token-bridged servers. MCP-7 completes the set to 7. Exact package names / remote URLs are a supply-chain pin risk; every uncertain pin carries a `// TODO(verify-pin)` comment to confirm at PR. No service changes were needed — `toEntry()` already persists `{type:'remote',url}` for remote servers and `{type:'local',command}` for local ones.

**Per-server record (id — pin — rationale — credential approach — fallback):**

1. **pdf-tools** — `npx -y @modelcontextprotocol/server-pdf` (local) — zero-auth PDF tooling, first end-to-end proof (MCP-2). Credential: none (`requiredEnv: []`). Pin UNCONFIRMED (TODO-verify): published package name + version. Fallback: n/a.
2. **google-workspace** — `npx -y @modelcontextprotocol/server-google-workspace` (local) — Google Workspace tools. Credential: **token bridge** — fresh OAuth access token injected into `GOOGLE_OAUTH_ACCESS_TOKEN` from Rhythm's stored Google tokens at ensure time (MCP-6); skipped entirely when no account connected. Pin UNCONFIRMED (TODO-verify): package name + version + that the server reads that env key. Fallback: none today (server is skipped if no connected Google account).
3. **planning-center** — `npx -y @ajhochy/pco-mcp-server` (local) — in-house Planning Center MCP. Credential: **token bridge** into `PCO_ACCESS_TOKEN` (MCP-6); skipped when no PCO account connected. Pin: in-house package, version UNCONFIRMED (TODO-verify). Fallback: a PCO Personal Access Token supplied via the secrets UI if the OAuth token bridge is unavailable.
4. **canva** — remote `https://mcp.canva.com/mcp` — **official** Canva hosted MCP. Credential: **remote OAuth on first use** by opencode, no API key (`requiredEnv: []`). URL confirmed via Canva docs/PulseMCP (June 2026) but marked TODO-verify against drift. Fallback: n/a.
5. **notion** — remote `https://mcp.notion.com/mcp` — **official** makenotion hosted MCP. Credential: remote OAuth on first use (`requiredEnv: []`). URL per issue; TODO-verify. Fallback: n/a.
6. **stripe** — `npx -y @stripe/mcp --tools=all` (local) — **official** Stripe MCP. Credential: **API key via secrets UI** — server reads `STRIPE_SECRET_KEY` from env (a restricted API key is recommended; `--api-key=` flag is an alternative). Package confirmed; version pin UNCONFIRMED (TODO-verify). Fallback: Stripe also hosts a remote MCP at `https://mcp.stripe.com` if the local stdio server is undesirable.
7. **mailchimp** — `npx -y @agentx-ai/mailchimp-mcp-server` (local) — **maintained community** (not official) Mailchimp Marketing MCP. Credential: **API key via secrets UI** — reads `MAILCHIMP_API_KEY`; the key embeds the data-center suffix (e.g. `...-us21`) so no separate server-prefix env var is needed. Package + env key UNCONFIRMED (TODO-verify): community package, pin a version. Fallback: alternative community Mailchimp MCP servers exist (e.g. damientilman/mailchimp-mcp-server) if this one is unmaintained.

**Alternatives considered:** running Stripe/Notion as remote-only vs local stdio — chose local stdio for Stripe (explicit key control via secrets UI) and remote for Notion/Canva (their official OAuth-on-connect path avoids storing long-lived keys).

**Consequences:**
- + Registry is feature-complete at 7; remote + local + token-bridge + API-key credential shapes are all represented and tested.
- + No `ensureCuratedMcps()` changes required — remote persistence path already existed.
- - Several pins are unconfirmed (TODO-verify) and must be validated + version-pinned before release to mitigate supply-chain risk, especially the community Mailchimp package.
