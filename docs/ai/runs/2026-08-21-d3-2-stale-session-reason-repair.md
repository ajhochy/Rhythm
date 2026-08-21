---
date: 2026-08-21
repo: Rhythm
branch: agent-stack/si-d3-desktop-feedback-sonnet
pr: none
issues: [1437]
status: verified
tags: [run, Rhythm, D3, repair]
---

# D3.2 focused repair — stale cross-session feedback reason

## Context

A code-review finding on the D3.2 desktop feedback surface (#1437, commit
411b0012): `_RunFeedbackSectionState` owns a single `_reasonController`
across the widget's lifetime. `didUpdateWidget` already re-fetches the new
session's recorded outcome when `sessionId` changes, but it never cleared
the text field. Because `_RunFeedbackSection` is keyed only by the session
side panel's own rebuild (no `ValueKey` per session), Flutter reuses the
same `State` object across a session switch — so a reason typed while
viewing session A's run and left in the field would still be sitting there,
untouched, once the panel switched to session B. Tapping a verdict button on
B would then post A's leftover text as B's reason, misattributing feedback
to the wrong run. This is the one authorized focused repair loop for #1437.

## Repair

- `apps/desktop_flutter/lib/features/agents/views/_session_side_panel.dart`
  — `_RunFeedbackSectionState.didUpdateWidget`: added a synchronous
  `_reasonController.clear()` inside the existing `if (old.sessionId !=
  widget.sessionId)` branch, before the already-present deferred
  `_fetch()` post-frame callback. Clearing a `TextEditingController` only
  notifies its own listeners (the `TextField` below it), not the `Provider`
  tree, so it is safe to do synchronously mid-`didUpdateWidget` — unlike
  `_fetch()`, which stays deferred for the reason already documented at that
  call site (calling into `AgentsController` while an ancestor may still be
  mid-rebuild can throw `setState() called during build`).
- `apps/desktop_flutter/test/features/agents/d3_2_run_feedback_test.dart` —
  added `postedSessionIds` tracking to `_StubAgentsRepository.postRunFeedback`
  (needed to assert WHICH session a submission landed on; the existing fakes
  only tracked verdict/reason) and one new `testWidgets` case: types a
  reason on session `s1`, switches the mounted view to session `s2` via
  `AgentsController.setActiveSessionForTest`, asserts the reason field is
  already empty before any submission is made, then submits a verdict on
  `s2` and asserts `postedSessionIds == ['s2']` and `postedReasons == [null]`
  — session A's reason must never reach session B's POST.

## RED → GREEN evidence

1. **GREEN (fix in place, before recording RED):** `flutter test
   test/features/agents/d3_2_run_feedback_test.dart` — 8/8 passed, including
   the new case.
2. **RED (fix reverted):** `git stash push --
   .../_session_side_panel.dart` to isolate just the production fix, then
   re-ran the same test file. The new case failed exactly as predicted:
   `Expected: empty` / `Actual: 'leaked reason meant for session A'` at the
   post-switch assertion — confirming the test genuinely exercises the bug
   and does not pass vacuously.
3. **GREEN (fix restored):** `git stash pop`, re-ran — 8/8 passed again.

## Checks

- `flutter test test/features/agents/d3_2_run_feedback_test.dart`: **8/8
  passed** (7 pre-existing + 1 new).
- `flutter test test/features/agents/` (full directory): **714/714 passed**
  (713 pre-existing + 1 new; confirms no regression elsewhere).
- `dart format --set-exit-if-changed` on both touched files: 0 changed,
  exit 0.
- `flutter analyze --no-fatal-infos` (whole package): 0 errors/warnings (315
  pre-existing infos, none in the touched files).
- `git diff --check`: clean.
- Added-line secret/security scan (grep for key/token/password/
  connection-string/private-key shapes) on the diff: no matches (the only
  hits were `ValueKey('run-feedback-reason')`/`ValueKey('run-feedback-success')`
  widget keys, not secrets).
- GitNexus `detect-changes`/`analyze`: intentionally not run per this
  track's standing instruction (it rewrites AGENTS.md/CLAUDE.md). Mitigated
  by direct `git status --short` / `git diff --stat`: exactly the 2 files
  above changed.
- `docs/ai/contracts/issue-1437.json` updated with a new `issue-1437-c12`
  criterion documenting this repair; POST/auth/no-optimistic-lie behavior
  (c2, c5, c7's fetch-gating half, c8) was read but not touched and remains
  covered by the pre-existing, still-passing tests.

## Risk

Single-line production fix (`_reasonController.clear()`), synchronous and
side-effect-free beyond the one `TextEditingController` it targets — it
cannot itself trigger the mid-rebuild `Provider` hazard the neighboring
deferred `_fetch()` call is guarding against, since it never touches
`AgentsController` or notifies any ancestor. No route/auth/POST-path change.
