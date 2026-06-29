---
date: 2026-06-28
repo: Rhythm
branch: codex/mega-open-prs-2026-06-28
pr: 812
issues: [813]
status: committed-for-mega-smoke
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Run 2026-06-28 — #813 Status column populate + sortable

Fix for a gap found during the PR #812 smoke of the redesigned Skills table:
the trailing **Status** column was empty on a normal system (every skill is
`active`, but the pill only rendered for `measuring`/`reverted`), and Status
was not a sortable column (only Name + Description sorted).

Worktree branch `worktree-agent-ade854aa5dccb06f7`, commit
`ca29709d75b832ca39072ae67b2bf2195e6ad1d6`, based on the running mega tip
`7facf8b47`. Not pushed — lands on `codex/mega-open-prs-2026-06-28` for
re-smoke per dispatch.

## Files changed

- `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart`
  — trailing cell now renders a lifecycle pill for EVERY skill. Added
  `_statusOf(skill)` (defaults to `active` when `metadata`/`status` absent, per
  the server default) and `_statusRank` (measuring → reverted → active, unknown
  last). `_StatusBadge` colors `reverted` red, `measuring` amber, `active`/
  unknown a muted neutral pill. Added `_SortColumn.status` + a Status comparator
  (rank with Name tiebreak) and made the static `Status` header a sortable
  `_HeaderCell` keyed `skills-sort-status`. Name stays default sort.
- `apps/desktop_flutter/test/features/agent_skills/agent_skills_view_test.dart`
  — +2 tests in the #813 group: (a) an `active` skill renders a visible
  `status-badge-active` pill (column not empty); (b) clicking `skills-sort-status`
  sorts rows by lifecycle and toggles asc↔desc.

No controller / data-source change: `AgentSkillsController.loadSkills` already
calls `listWithMetadata()` (`agent_skills_controller.dart:49`), so each entry
already carried `metadata.status`. The gap was purely the view gating the pill
on `status != 'active'`.

## Checks run

- `dart format --set-exit-if-changed lib/features/agent_skills/ test/features/agent_skills/` → exit 0 (0 changed).
- `flutter analyze --no-fatal-infos lib/features/agent_skills/ test/features/agent_skills/` → No issues found (0/0).
- `flutter test test/features/agent_skills/` → 18 passed (16 prior + 2 new).
- Falsification: gating the pill on `status != 'active'` fails the active-pill
  test; forcing the status comparator to `byRank = 0` fails the sort test. Both
  reverted; full suite green after restore.
- Visual: no repo visual-smoke/golden tooling for this view; ran a throwaway
  real-surface render probe — mounted `AgentSkillsView` painted a Status pill
  for all four lifecycles (2× ACTIVE incl. null-default, MEASURING, REVERTED),
  `skills-sort-status` header present, `takeException()` null. Probe passed,
  then removed.

## Notes

- PR-level `tsc`/`vitest` legs not exercised — Flutter-only diff, no api_server
  change. Flutter analyzer is the Dart build-equivalent gate.
- Status sort order groups attention-needing states first (measuring →
  reverted → active) with a Name tiebreak; documented in the view docstring.
- Minor concern: every row now renders a pill, so a default-metadata list shows
  multiple `status-badge-active` widgets sharing a key. Tests assert
  `findsOneWidget`/`findsNWidgets` on controlled lists only; a name-scoped key
  would be needed for per-row key uniqueness if a future test needs it.
