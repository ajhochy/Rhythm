---
date: 2026-07-11
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# #1002 headless-AgentRunner fix was lost on main — re-land + guardrail

## Context

Background/scheduled agent runs failed in beta.18.42 with "model produced no
output", while interactive chat worked. Investigation found the proven #1002
fix (commit `009823585`, originally live-verified) lived only on the stale
PR #1005 branch. When #1005's still-needed fixes were re-landed on main
(#1020 = `66e129474`), only #999/#1000/#1003/#1004 were carried over — **#1002
was silently dropped**. The USO epic spec even assumed the "#1002
directory-scoping fix" was already available to Phase B "for free"; it was not.

## Decision

Re-land the #1002 fix directly on main's *current* structure (not a
cherry-pick — `agent_runner.ts` had since refactored to `_withinRunDeadline` /
`opencodeSessionId`): use `effectiveCwd` for `prompt`/`listMessages`/
`abortSession`, and extend `resetStaleRunning` to recover `'starting'` orphans.
Because Phase B (#1028-1032) routes *more* background loops through the same
`AgentRunner.run()`, fixing #1002 first was the prerequisite for all of Phase B
working — confirmed live (optimizer-diagnosis + skill-refine self_improvement
sessions produce real transcripts).

## Alternatives considered

- **Re-diagnose from scratch** — rejected; the mechanism was already understood
  and proven, and a live trace confirmed the exact three raw-`cwd` call sites
  still present on main.
- **Cherry-pick `009823585`** — rejected; main diverged, so the pick would not
  apply cleanly and would drag in unrelated #1000/#1003/#1004 hunks already on
  main. Re-applied the semantics instead.

## Consequences

- Headless/scheduled/self-improvement runs produce output again; no more stuck
  `starting` sessions (boot recovery now frees them).
- **Process risk surfaced:** re-landing a subset of a multi-issue commit can
  silently drop a sibling fix. Guardrail for future re-lands: enumerate every
  `#N` in the source commit's message and assert each is either re-landed or
  explicitly deferred — never assume "the still-needed fixes" is complete.
- Stale PR #1005 is now fully superseded and should be closed.
