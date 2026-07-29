---
date: 2026-07-28
repo: Rhythm
branch: mega/post-1241-20260728
pr: 1242
issues: [1176, 1177, 1076]
status: recorded
tags: [run, rhythm]
---

# OCU-35 trigger evaluations — 2026-07-28 (post-#1241 mega run)

These three issues define their own close/deferral conditions. This record is the
rebase-time evaluation each one mandates, performed against the mega branch
(base: PR #1241 head `17748cefb`).

## #1176 — OCU-35A: v2 session adoption — trigger NOT met, stays blocked

Inspected `apps/opencode_fork/packages/opencode/src/v2/session.ts` (339 lines) at this tip:

| v2 operation | status |
|---|---|
| `create` | placeholder — `return {} as any` (line 170) |
| `prompt` | placeholder — `return {} as any` (line 290) |
| `shell` | empty body (line 292) |
| `skill` | empty body (line 293) |
| `compact` | empty body (line 329) |
| `get` / message listing | real implementations over `SessionTable` |
| `switchAgent` | real (`SessionEvent.AgentSwitched.Sync`) |

Per the issue's adoption trigger step 3: create/prompt/shell/compact remain
placeholders or unsafe casts → **the issue stays blocked**. No migration work is
scheduled. Re-evaluate at the next `apps/opencode_fork` subtree rebase.

## #1177 — OCU-35B: remote-workspace slice — product trigger absent, stays deferred

The issue requires, before any implementation, "a concrete workflow that local
execution cannot serve, naming the project, operator class, expected workload,
data residency, and recovery requirement." No such workflow is attached to the
issue and none exists in `docs/ai/` as of this run. Per the issue's own product
trigger clause: **keep deferred**. No code change.

## #1076 — OCU-35 tracking — close condition met (superseded)

The issue states: "This issue closes only by being superseded by concrete
issues." All three watch-list items now have concrete successor issues:

- v2 API / session.next.* → #1176 (OCU-35A)
- workspaces/control-plane/sync → #1177 (OCU-35B)
- session share → #1178 (OCU-35C, implemented in this mega PR)

**#1076 is closed by this PR as superseded** — its sole close condition, met.
