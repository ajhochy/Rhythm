---
date: 2026-06-28
repo: Rhythm
branch: main
pr: "#774"
issues: ["#765", "#661", "#707", "#720", "#736", "#723", "#731", "#755", "#770", "#737", "#775"]
status: merged-and-released
tags: [run, Rhythm]
---

# Consolidate agent-stack batch + re-fix #765 MCP scoping

## Files

- Merged PR #774 (`4fbfc059d`) — consolidation of 9 issues onto `main`.
- `apps/opencode_fork/.../session/session.ts`, `.../httpapi/groups/session.ts`,
  `.../httpapi/handlers/session.ts` — restored the per-session MCP allowlist
  **write path** deleted by #765 (commit `409aeb808`).
- `tools/dev/launch_desktop_current.sh` — ad-hoc re-sign staged opencode binary
  after `cp` (AMFI SIGKILL fix, commit `76da710ad`).
- `tools/release/smoke_mcp_allowlist.sh` (NEW) + `desktop_release.yml` —
  #765 persistence regression guard (commit `f2e87d3b2`).
- `docs/ai/project-state.md` — refreshed snapshot + pending-smoke list.

## Checks

- `npx tsc --noEmit` exit 0; `npx vitest run` 1330/1330 (156 files).
- Guard validated: PASS on fixed fork binary, FAIL (mcpAllowlist=null) on a
  binary without the write path.
- E2e: real Flutter UI turn `agent=secretary` → engine DB `mcp_allowlist` =
  the 7-server Secretary set. #765 smoked.
- Release v18.54 dispatched (run 28312640618).

## Notes

- **Root cause of #765 regression:** PR #772 replaced the working
  `Session.setMcpAllowlist` write path with a reuse of the generic
  `PATCH /session/:id` route, but added `mcpAllowlist` to `UpdatedInfo` (the
  session.updated *event* schema) instead of `UpdatePayload` (the PATCH request
  body). The endpoint validates `UpdatePayload` and the handler had no allowlist
  branch → 200 OK, nothing persisted. The original "e2e smoke ✓" was a false
  green: it ran against the still-staged secretary-scope binary that HAD the
  write path. Restored the 3 deleted pieces from `ed61e632d`.
- **Closed:** #661, #707, #720, #723, #731, #736, #755, #770 (and #765 was
  already closed). PR #773 closed. PR #772 was already merged.
- **Still outstanding:** #737 (email fencing — not in batch, never merged,
  needs to land + smoke); #775 (skill-scoping audit, same gap class as #765).
- Everything that landed needs a manual UI smoke EXCEPT #765 (already smoked) —
  see the pending-smoke list in `project-state.md`.
