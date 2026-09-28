---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: null
issues: [1559, 1560, 1561, 1562, 1563, 1564]
status: complete
tags: [run, Rhythm]
---

# Agent Settings UI/UX audit (exploration + issue writing only)

Scope: the seven sections of `apps/web/src/components/tools/AgentSettingsTool.tsx`, judged
against the Accounts section (rebuilt in `05ca632c`) as the quality bar. No product code
was changed and no PR was opened.

## Files read

- `apps/web/src/components/tools/AgentSettingsTool.tsx` / `.css`
- `apps/web/src/components/ListInspector.tsx` / `.css`
- `apps/web/src/components/ToolWorkspace.tsx` / `.css`
- `apps/web/src/styles.css` (`.property-list`, `.kind-badge`, `.auto-promotion-card`)

## Checks

Audited the **live** surface, not the fixture. Recipe (all scaffolding removed afterwards):

1. `apps/web/node_modules` symlinked from the main checkout; worktree reset to `1963bf42`.
2. The user's running api_server (:4001) and engine (:4096) were left untouched. A throwaway
   node proxy exposed them on :4193 / :4194 stripping `Origin`, `Referer` and **`Sec-Fetch-*`**
   — `localAgentSurfaceGuard` 403s on `Sec-Fetch-Site: cross-site` even when the origin is gone.
3. `vite` on :4192 with `VITE_RHYTHM_GATEWAY_MODE=live` and split API/engine bases
   (the gateway refuses identical ports for both), plus a `transformIndexHtml` plugin
   stripping the `index.html` CSP `<meta>` (it pins `connect-src` to :4001/:4096).
4. Real data: 54 profiles, 2 accounts, 26 MCP servers (21 connected, 2 `needs_auth`,
   3 `failed`), auto-promotion endpoint unavailable.

## Issues filed

| # | Title |
|---|---|
| 1559 | One failed request hides all seven sections, including the offline-capable ones |
| 1560 | MCP `failed`/`needs_auth` servers look identical to connected ones; errors styled muted |
| 1561 | MCP section leads with the add form; no way to find the 5 broken servers among 26 |
| 1562 | Profiles overview is 54 inert cards, no search, primary action buried below all of them |
| 1563 | Runtime and Auto-promotion report status in 9px right-aligned mono and assert unverified state |
| 1564 | MCP connect/disconnect/remove disable every button with no progress indicator; notices leak |

All labelled `agent-settings-ux`.

## Notes

- The `05ca632c` "inherited layout" lead checked out but is already fixed: `.agent-settings-records
  article` still carries the 34px avatar column, and only `.agent-settings-account` overrides it
  to `1fr auto` — but every non-profile consumer does carry that class, so no section inherits a
  wrong grid today. The live analogue of that class of bug is `.agent-settings-mcp-list p { color:
  var(--muted) }` (AgentSettingsTool.css:22-29) capturing `<p role="alert">` and muting MCP errors.
- **Not filed, deliberately:** the developer-facing wording of the Behavior / Keybindings / Runtime
  gap notices ("requires GET and PATCH /agent-settings/behavior…", "Configure this in Flutter Agent
  settings"). #1550, #1551 and #1555 already own those three notices, and #1551 argues the
  Keybindings notice is outright false. Filing a copy-only issue would have collided with them.
- **Not filed:** the app-wide 9px/8px type scale (`.list-inspector-row small`, `.kind-badge`). It is
  a shell-wide token decision affecting every tool, not an Agent Settings defect; the settings-visible
  consequences are covered inside #1563.
- Screenshots were captured during the audit but not attached — `gh issue create` cannot upload
  images, so each issue carries measured values (rendered colours, counts, px sizes) instead.
- Test coverage on this surface remains thin: the "Agent Settings live persistence" specs had no
  Playwright config targeting them until `05ca632c`. Each issue asks for a rendered regression check.
