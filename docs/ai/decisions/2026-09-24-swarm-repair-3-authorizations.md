---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Third repair attempts authorized for the deferred swarm candidates

## Context

The 2026-09-24 open-issue swarm resume integrated six slices and deferred ten candidates whose
two-attempt repair cap was reached ([run record](../runs/2026-09-24-open-issue-swarm-resume.md)).
The cap rule says a third attempt needs AJ to revalidate product intent. AJ was asked one plain
language question per blocker and answered each on 2026-09-24.

## Decision

1. **PR #1578 / #1577** — run the bounded fix (server-side trusted `profileId` as the per-turn
   agent, strengthened c9 fixture, guard on legacy audit outcomes); integrate into PR #1544 if green.
2. **#1558** — criterion 2 stands as written: the group containing the selected session is
   expanded on load regardless of stored state; the automatic open does not rewrite the stored
   preference. Bounded repair, then integrate if green.
3. **#1569 S0** — the five coverage items the Astra review flagged (Keychain-link confirmation,
   atomic 0600/0700 grant writes with corrupt-file rejection, production/diagnostic non-disclosure,
   Rhythm ownership of `index.md`/`log.md`, preservation of Hermes `MEMORY.md`/`USER.md`) are
   required. Docs-only repair, Astra re-review, then freeze S0 and branch S1/S3/S5.
4. **#1574/#1573, #1565, #1491, #1579, #1582, #1572, #1468** — one full repair pass each, in
   parallel isolated Codex worktrees; only candidates that pass fresh verification are integrated.
5. **Planning doc** — `docs/ai/current-plan-1569.md` moves unchanged to
   `docs/ai/plans/2026-09-24-issue-1569-brokered-credentials-plan.md` (repo convention for
   per-issue plans; the scanner self-check reads only top-level `docs/ai/*.md`) and is committed
   with the S0 freeze. Rewording was rejected once it was clear 23 lines matched, not two.
6. **Skill sync** — no change to agent-stack `main` was needed: main never listed `kanban-worker`.
   The stale entry lived in the installed `~/.config/ai-workflow/sync_workflow_globals.py`, copied
   from the local feature-branch checkout. Reinstalled from main; both skill targets verified
   in sync. The local agent-stack checkout stays on its feature branch, untouched.
7. **Cleanup** — only the six integrated candidate worktrees are removed (about 14.6 GB). Evidence
   directories, `.proof` diffs, other worktrees and branch pushes were not approved.

GitNexus impact before dispatch was LOW for every shared symbol checked (`handleInputFrame`,
`SessionRail`, `EngraphManager.getStatus`, `_maybeConsumeComposerDraft`, `agents_models_routes.ts`,
`OpencodeClientService.promptAsync`).

## Alternatives considered

- Park the seven multi-defect candidates and file fresh issues after smoke (recommended, declined).
- Reword the plan doc in place (declined once the match count was corrected).
- Push the `kanban-worker` skill folder to agent-stack main (moot; main was never the cause).

## Consequences

- Ten Codex (`gpt-5.6-sol`) repair jobs run concurrently, one per candidate worktree; the
  orchestrator reviews every diff, runs the out-of-sandbox checks (Playwright, Flutter, live
  sandbox tests) and decides integration per slice.
- Bot Crossing remains untouched; PR #1544 stays draft; no merge.
