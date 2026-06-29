# Project State

## Current focus

**2026-06-28 — Multi-issue workflow run (#769–#784).** Skills source-of-truth
unification (#778) is merged to `main`. This run shipped two quick fixes,
decomposed two large items into planning epics, closed one epic, and rebased a
batch of conflicting PRs. See
`docs/ai/runs/2026-06-28-workflow-run-issues-769-784.md`.

## Active branch / PR

- **PR #790** (`workflow/run-2026-06-28`) — open, **do not merge**. Closes #780
  (skill-chip overflow hardening) + #782 (trigger-watcher smoke-gate fix); also
  carries the #783 MCP-unification planning docs. Human review + post-merge
  manual smoke first.
- **Rebased & green, ready for review (separate branches):** #754 (Postgres
  bootstrap CREATE parity — prod-durability), #757 (terminal-fix docs), #758
  (durable sdk_session_id fallback; fork-engine re-verify still owed).
- Open MCP-unify children: **#785–#789** (tracked by epic #783).

## In progress

- **Single-skill-source planning** (successor to #779): a background planning
  agent is producing a decision doc + `skill-unify2-*` issues for "one skill
  source (engine `SKILL.md`) + self-improvement loop operating on ALL engine
  skills + standalone menu surfacing one unified list." Issues not yet filed.

## Risks / known issues

- **#758 owes fork-engine re-verification** — its api_server tests pass, but it
  is defense-in-depth and does NOT cure the #751 "stuck on Starting" symptom
  (real cause is a bundled-fork `/event` SSE regression, #759).
- **Visual smoke deferred (needs signed fork rebuild):** the Agent Profile
  skills/MCP pickers render live engine data only against a rebuilt+signed fork;
  pixel/interaction confirmation (incl. #780) is a post-merge manual item.
  Behavior is covered by widget tests against the real `AgentProfileSheet`.
- Managed skills dir `~/.config/opencode/rhythm-managed-skills` is registered
  additively in `skills.paths`; must never collide with `sync-globals` paths
  (`~/.claude/skills` etc.) — relevant to the single-skill-source plan (external/
  discovered skills must stay read-only / fork-on-improve).

## Test status

- Flutter: `analyze --no-fatal-infos` exit 0; `dart format` clean; `flutter test
  test/features/agents/` **459 pass** (the 6 prior `agent_trigger_watcher` F2
  failures resolved by #782; #651 contract 7/7).
- api_server (on rebased PR branches): `tsc`/`npm run build` clean; `vitest`
  1344–1350 pass.

## Next step

Await human review/merge of PR #790 and the 3 rebased PRs (#754 first — prod
durability). When the single-skill-source planning agent returns, file its
`skill-unify2-*` issues + tracking epic and close #779 pointing to it. Then work
the post-merge manual-smoke list against a signed build.
