---
date: 2026-06-28
repo: Rhythm
branch: codex/mega-open-prs-2026-06-28
pr: 812
issues: [780, 782, 785, 786, 787, 788, 789, 791, 792, 793, 794, 795, 796, 797, 798, 802, 803, 804, 805, 806, 807, 808]
status: complete
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Mega open-PR integration smoke

## Files changed

- Merged source PRs #754, #757, #758, #790, #799, #800, #809, #810, and #811
  with merge commits, preserving each source branch history.
- `apps/api_server/scripts/smoke_memory_authority.sh` — resolve the API's
  vault-root-relative `memory/...` response directly below the temporary vault.

## Checks run

- Confirmed all nine source PR heads are ancestors of the integration branch.
- `ai-workflow checks --level issue` — pass.
- `ai-workflow checks --level pr` — pass.
- api_server `npm run build` — pass.
- `tools/dev/launch_desktop_current.sh` — rebuilt the fork engine and debug
  Flutter app, launched the app, verified API `:4001`, engine `:4096`, and
  `opencode=true`.
- `smoke_memory_authority.sh` — pass through write, full SQLite deletion, vault
  rebuild, and identical recall.
- Built-fork MCP/skill allowlist and alignment guards — pass.
- GitNexus compare against `main` — MEDIUM risk, one affected flow.

## Notes

- Initial memory-authority smoke failed because #803 changed the returned note
  path to the canonical vault-root-relative form (`memory/...`) while the #808
  guard still prefixed another `memory/`. The isolated smoke also reclaimed the
  already-running local engine on its fixed port. The path assertion was
  corrected, the guard passed on rerun, and the app must be relaunched after
  isolated server smoke.
- No follow-up issue was filed; the failure was an in-scope stale guard contract.
- Source PRs will remain as provenance until the mega PR exists, then can be
  closed as superseded without merging them individually.
- Draft mega PR #812 was opened against `main`; the nine source PRs were closed
  as superseded with comments pointing to #812.
- Final relaunch used `RHYTHM_LOCAL_SMOKE=1`. `/health`,
  `/opencode/health`, and `/agents/capabilities` were healthy; the running
  `:4096` executable resolved to `apps/api_server/opencode_bin/opencode` with
  the expected mega-branch version.
