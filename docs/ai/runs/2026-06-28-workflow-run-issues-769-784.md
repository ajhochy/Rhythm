---
date: 2026-06-28
repo: Rhythm
branch: workflow/run-2026-06-28
pr: 790
issues: [769, 779, 780, 781, 782, 783, 784]
status: pr-open
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Workflow run 2026-06-28 — issues #769–#784

Multi-issue run dispatched via the orchestrator chain. Heterogeneous batch:
2 code fixes shipped, 2 large items decomposed into planning epics, 1 epic
closed, 1 batch of 3 PRs rebased.

## Disposition per issue

- **#769** (epic: agent tool-gating & untrusted-content security) — **CLOSED
  completed**. All children done: #765 (Layer 1, shipped v18.54), #736 (Layer 2
  WS backstop), #737 (SF-4 fencing). No code.
- **#780** (RenderFlex overflow on skill rows) — **FIXED** (PR #790). The
  reported `location`-path overflow had **no render site on current main**
  (`OpencodeSkillEntry.location` is parsed but never displayed). Real risk was a
  long-named `FilterChip` label inside the `Wrap`/managed-skill `Row`. Bounded
  label `maxWidth: 240` + ellipsis + `Tooltip` in `_agent_profile_sheet.dart`.
- **#782** (6 failing `agent_trigger_watcher_test.dart`) — **FIXED** (PR #790).
  Misframed as the F2 auth-change group; real cause: the test session leaked
  `RHYTHM_LOCAL_SMOKE=1` into the production `isLocalSmokeRun` getter, so the
  watcher no-op'd under `flutter test`. SUT now ignores the env-var smoke path
  when `FLUTTER_TEST=true`; dart-define path + #651 release hardening preserved.
- **#781** (MCP picker name alignment) — **CLOSED subsumed** by the #783
  decomposition (→ #785 guard + #789 reconciliation).
- **#783** (unify MCP servers onto opencode engine) — **decomposed, kept open as
  tracking epic**. Grounding showed most of the target design already shipped in
  #778 (both Flutter MCP surfaces already read live `GET /opencode/mcp`;
  `_kAvailableMcps` already removed). Remaining work = reconcile/align/guard.
  Filed **#785–#789** (`docs/ai/generated-issues/mcp-unify-*.md`).
- **#779** (New-skill in standalone Skills menu) — **re-scoped, deferred**. The
  standalone menu lists self-improvement `AgentSkill` DB records, not engine
  `OpencodeSkillEntry` skills; engine-skill authoring already exists in the
  Agent Profile sheet. Maintainer wants a bigger goal: ONE skill source (engine
  `SKILL.md`), self-improvement operating on ALL engine skills, standalone menu
  surfacing one unified list. Planning agent dispatched to produce a decision
  doc + decomposed `skill-unify2-*` issues (subsumes #779). Not yet filed at run
  close.
- **#784** (rebase 3 conflicting PRs) — **DONE**. #754, #757, #758 rebased onto
  `main`, conflicts resolved (mostly `project-state.md`), force-pushed, **all CI
  green**. Owed: fork-engine re-verification for #758 (its own description flags
  it as defense-in-depth, not the #751 cure → #759).

## Files changed (PR #790)

- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart` (#780)
- `apps/desktop_flutter/lib/app/core/agents/agent_trigger_watcher.dart` (#782)
- `docs/ai/generated-issues/mcp-unify-0{1..5}-*.md`, `docs/ai/current-plan.md` (#783 plan)
- run/decision docs (#782, planning)

## Checks run

- `dart format --set-exit-if-changed` clean; `flutter analyze --no-fatal-infos`
  exit 0; `flutter test test/features/agents/` → **459 pass** (covers #782 + #651
  contract 7/7 + AgentProfileSheet mount for #780).
- Run-branch Desktop CI watched on push (see PR #790).
- Rebased PRs #754/#757/#758: type-check+build and server-checks green.

## Notes / follow-ups

- Visual confirmation of the #780 picker is a **post-merge signed-fork manual
  smoke** item (picker renders live skills only against a rebuilt+signed fork);
  behavior covered by widget tests.
- Single-skill-source epic (#779 successor) issues to be filed once the planning
  agent returns its decision doc + `skill-unify2-*` issue files.
- Merge order unchanged: human review only; never auto-merge.
