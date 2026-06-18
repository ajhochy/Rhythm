---
date: 2026-06-12
repo: rhythm
tags: [decision, rhythm]
---

# OpenCode parity: keep the embedded-SDK architecture (plan #685–#703)

**Context:** Request to port OpenCode's full feature set/UI into the Agents tab, after a prior partial attempt. Options weighed: (a) PTY-wrap the opencode TUI, (b) consume opencode's server API, (c) reimplement client logic natively, (d) hybrid. Audits showed the current code is already (b)+(c): `@opencode-ai/sdk` v1.14.49 in-process (server on :4096), SSE→WS bridge, native Flutter UI — and that the SDK already exposes every endpoint the missing features need (`diff`, `revert`, `unrevert`, `summarize`, `todo`, `fork`, `command`, `message` list, `children`, `mcp`).

**Decision:** Keep (b)+(c). The parity gap is wiring + UI, not architecture. PTY-wrapping the TUI was rejected (regression to the pre-#574 world: ANSI scraping, no structured parts, no permission cards); a webview of opencode's web/desktop client was rejected (foreign design system, Electron/Solid stack inside Flutter). The plan's M1 fixes the structural defects that made the prior attempt rot — dual transcript stores, duck-typed SDK access, in-memory sentinels — before any new features land.

**Consequences:**
- + Each parity feature maps to a typed SDK call + a Flutter widget; per-issue contracts can use recorded v1.14.49 fixtures.
- + Out-of-scope list is explicit (share/themes/keybinds/LSP/TUI-remote/worktrees) with church-context justifications.
- - SDK version pinning matters: parity claims are against v1.14.49; SDK upgrades need a re-audit of the event/part union.
- Landed: plan + issue specs on `workflow/run-2026-06-12-opencode-parity-plan` (PR #704); issues #685–#703.
