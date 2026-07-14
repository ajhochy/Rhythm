---
date: 2026-07-11
repo: Rhythm
branch: none
status: ready-for-coding
issues: [1076]
order: 35
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m7-hygiene]
---

# OCU-35 — Watch list — v2 API, workspaces/sync, session share (tracking)

## Summary
Audit watch-list items deliberately NOT built now: (1) engine v2 /api namespace + session.next.* event-sourced streaming (26 events) — where upstream is heading, but several engine methods are placeholder stubs today; (2) experimental workspaces/control-plane/sync — remote execution environments (could eventually run agents on the NAS/server from the desktop app); (3) session share — uploads transcripts to opncd.ai/enterprise URL, privacy posture wrong for church staff data; if sharing is wanted, build in-Rhythm transcript sharing instead.

## Scope (in)
- Tracking only
- Adoption triggers to re-evaluate at each fork rebase/upstream sync: v2 — when session.create/prompt/shell/compact/wait are implemented upstream (not placeholder casts in packages/opencode/src/v2/session.ts) → plan migrating the stream bridge to session.next.* events
- Workspaces — when OPENCODE_EXPERIMENTAL_WORKSPACES graduates or a concrete remote-execution need lands
- Share — decide on in-Rhythm sharing product shape first, never enable OPENCODE_AUTO_SHARE

## Non-goals (out)
- All implementation
- This issue closes only by being superseded by concrete issues

## Likely files
- apps/opencode_fork/packages/opencode/src/v2/session.ts (references)
- apps/opencode_fork/packages/opencode/src/control-plane/ (references)
- apps/opencode_fork/packages/opencode/src/share/ (references)

## Acceptance criteria
N/A — tracking issue; keep updated at fork rebases

## Required tests
None

## Dependencies
None
