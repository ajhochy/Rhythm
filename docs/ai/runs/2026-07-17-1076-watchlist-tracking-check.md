---
date: 2026-07-17
repo: rhythm
branch: docs/1123-1076-spike-and-watchlist
pr: pending
issues: [1076]
status: tracking-checkpoint
tags: [run, rhythm, tracking]
---

# #1076 — OCU-35 watch-list tracking checkpoint (2026-07-17)

Per the issue's mandate ("keep updated at fork rebases"), re-checked the three
deliberately-deferred watch-list items against the current fork
(`apps/opencode_fork`, still at v1.14.49 — **no rebase since the 2026-07-11
audit**). All three remain **NOT adopted; no adoption trigger has fired.** Keep
#1076 OPEN as tracking.

| Item | Trigger to re-evaluate | Current state (verified) | Action |
|---|---|---|---|
| **v2 `/api` + `session.next.*` streaming** | when `session.create/prompt/shell/compact/wait` are real (not placeholder casts) in `packages/opencode/src/v2/session.ts` | `v2/session.ts` still carries placeholder markers | Defer — trigger not met |
| **Experimental workspaces / control-plane / sync** | when `OPENCODE_EXPERIMENTAL_WORKSPACES` graduates or a concrete remote-execution need lands | still experimental (workspace-routing middleware present but gated) | Defer — trigger not met |
| **Session share** | decide in-Rhythm sharing product shape first; **never** enable `OPENCODE_AUTO_SHARE` | `share/` present, not enabled; privacy posture still wrong for church-staff data | Defer — do not enable |

## Note
Re-run this checkpoint at the next `git subtree pull` fork rebase. If any trigger
fires, spin a concrete implementation issue and supersede the relevant row here.
