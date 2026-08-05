---
date: 2026-08-05
repo: Rhythm
branch: mega/run-2026-08-04
pr: 1319
issues: [1123, 1302, 1322, 1323, 1324, 1325, 1326, 891, 1305]
status: verified — awaiting AJ's smoke pass and merge decision
tags: [run, Rhythm, delegation, security, desktop]
---

# Delegation migration, permission-gate repair, and three transcript bugs

## What shipped

**Permission gates were provably dead** (f8ece4f5, 1c3b943b). The bridge read
`perm.toolName ?? perm.type` and `args.command`; the engine sends `permission` and
`patterns`. `toolName` was `''` for every real permission, silently disabling BOTH
the #736 tool-allowlist backstop and the #878 command gate. A hardline
`curl … | sh` reached the shell with no card. ~10 existing #878 tests passed
throughout because they hand-build `metadata: { command }` — a shape no engine
event has.

**Delegation migration** (040e2ecf, 40cd9a6b, de3a4bbf, 27ce9465). `rhythm_delegate_async`
had NEVER succeeded: 716 `task` calls / 7 sync / 0 async in all history. Three
independent causes — a stale bearer nothing re-pushes, a required `callerSessionId`
no model can know, and a fabricated engine message id that made the wake unorderable
so one wake produced 56 assistant turns. Now: 5 managers, async chosen unprompted in
an interactive chat, parent stays conversational, result pushed once, parent idles.
`task` restricted to natives for the other 29 profiles (0 of 34 still inherit
`"*": allow`, was 24 of 34).

**Three desktop transcript bugs**, all found by AJ in real use, none by API probing:
- ordering (585abf89) — `seq` tiebreaker; `createdAt` has 1s granularity
- lost sends (031e28e7) — `send()` silently discarded while the socket was down
- interrupted streams (5d1fbd7b) — a partial delta blocked the finished REST text

**The actual ordering root cause** (a60dc8e4 + 4f38e0d9). The api_server emitted
TWO formats from one feature: sessions `2026-08-05T22:18:21.279Z` (JS write),
messages `2026-08-05 22:23:01` (SQLite column DEFAULT). Designator-less strings are
LOCAL to Dart, so every REST message shifted 7 hours ahead of every streamed one.
Normalised on read server-side so all consumers are fixed at once. The `seq` fix
was necessary but not sufficient — with a 7h skew timestamps never tie, so the
tiebreaker was never consulted.

**Skills.** Four of the five destroyed skills had real originals under
`~/Documents/Claude/Scheduled/`, RICHER than the reconstructions.
`monday-worship-planning` 185 → 263 lines, restoring the Obsidian Bases schema,
`liturgical_movement` as the 8-slot controlled vocabulary, `STEP 0` and a MANDATORY
`STEP 3a`. Rhythm's own skill version history was empty for all of them.

## Checks

api_server 477 files / 4005 tests; mcp_server 155/155; desktop 24 transcript tests;
typecheck clean everywhere. Live-verified after relaunch: every `createdAt` zoned,
ids strictly ascending, newest message last (API last id == DB max id). AJ confirmed
the transcript renders correctly.

## Notes for next session

- **A green health check does not prove the bridge is alive.** An engine respawn at
  21:46:25Z stranded it; persistence stopped across EVERY session for ~9 minutes
  while `/health`, `/opencode/health` and the WS gateway all reported healthy. Check
  `SELECT MAX(created_at) FROM agent_session_messages` is advancing. #1325.
- **#1305 is live right now**: the engine on `:4096` runs
  `apps/opencode_bin/opencode` (the shadowing copy, build `…0020`), NOT the staged
  `apps/api_server/opencode_bin/`. The version string does not reveal this — check
  the `lsof` txt path.
- **api_server stdout is captured nowhere** (#1326). It blocked two diagnoses today;
  both had to be reproduced with custom instrumentation.
- Outstanding code: taint propagation to the parent (the wake result is fenced but
  the parent is not marked tainted), and `rhythm_delegation_transcript`.
- Sections G–M of `docs/testing/mega-2026-08-04-smoke.md` have never been exercised
  through the UI.
