---
date: 2026-07-02
repo: Rhythm
branch: issue-863-quick-actions
pr: []
issues: [863]
status: implemented-and-verified (PR not yet opened)
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# 2026-07-02 — Issue #863: one-tap agent quick actions

Implemented the shared `QuickActionsBar` widget: four jargon-free, one-tap
buttons ("Help me finish this", "Draft next steps", "Summarize", "Create
follow-up tasks") attached to the task inspector and the dashboard. Each
button runs a preset agent invocation with the item's content pre-loaded —
no model picker, no token talk, no MCP terminology, no typing required.

## Files changed

- `apps/desktop_flutter/lib/features/agents/models/quick_action_context.dart`
  (new) — generic `{kind, sourceId, title, description}` value object so the
  widget doesn't depend on Task/ProjectInstance/MessageThread models.
- `apps/desktop_flutter/lib/features/agents/views/quick_actions_bar.dart`
  (new) — the shared `QuickActionsBar` widget and its 4 preset actions.
- `apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart` — added a
  "Quick Actions" `_InspectorSection` to the task inspector's `aside`
  column (placed LAST, after Metadata — see Notes).
- `apps/desktop_flutter/lib/features/dashboard/views/dashboard_view.dart` —
  added `_NextTaskQuickActionsCard` under the hero panel for the single
  most relevant open task (today's first, else this week's first).
- `apps/desktop_flutter/test/features/agents/quick_actions_bar_test.dart`
  (new) — 7 widget tests.
- `docs/ai/project-state.md` — reset to a lean snapshot for this branch
  (previous content was inherited mega-828 branch state; preserved via
  git history, not duplicated here).

## Checks run

- `flutter test` (full suite): **754/754 pass**, 0 regressions (baseline
  747 before the 7 new tests).
- `flutter analyze --no-fatal-infos`: **0 errors/warnings** (267
  pre-existing info-level lints, unchanged from baseline).
- `dart format . --set-exit-if-changed`: **clean** (0 changed after one
  auto-format pass on the new widget file).
- Re-verified fresh inside `verification-gate` at commit
  `73756ead664c460a9018ce47516e8ae96638a9b1` on branch
  `issue-863-quick-actions` — same results.

## Notes

- Reused the exact same session-creation path as
  `agent_email_view.dart`/`agent_gallery_view.dart`:
  `AgentsController.createSession(mcpRole: 'secretary')` →
  `selectSession`. Diverged from their `setComposerDraft` pattern by
  calling `sendInput` immediately instead, since #863 requires zero user
  typing (a draft still needs the user to press Enter). Guarded on
  `agentsController.connectivity.isWsDisconnected` before sending — full
  reasoning in `docs/ai/decisions/2026-07-02-quick-actions-send-vs-draft.md`.
- "Create follow-up tasks" creates a real linked task directly via
  `TasksController.createTask` (deterministic, testable) and additionally
  launches a secretary-agent session to propose further follow-ups.
- Discovered and fixed a layout regression risk: an earlier draft placed
  the inspector's Quick Actions section FIRST in the aside column, which
  pushed the "Add collaborator" button (tap-tested by
  `test/features/tasks/issue_651_contract_test.dart` without an explicit
  scroll) out of the pre-scroll hit-test area. Moved it to last position;
  re-ran that suite to confirm green.
- No automated visual/screenshot smoke exists for Flutter in this repo
  (verified: no golden tests, no `visual-smoke*` script, no
  `.claude/launch.json`). Per `docs/testing/manual-smoke.md` §9, Flutter
  UI is verified by a human via `RHYTHM_LOCAL_SMOKE=1 flutter run -d
  macos`. Recommended manual check: open a task's inspector and confirm
  "Quick Actions" renders 4 buttons at the bottom of the right panel;
  open the Dashboard and confirm the quick-actions card appears for the
  next open task; tap "Help me finish this" and confirm it opens a new
  agent session with no typing required.
- No provider wiring changes needed in `main.dart`/`app_shell.dart` —
  `AgentsController` and `TasksController` are already globally provided.

## Follow-ups (not filed as issues — informational only)

- `AgentsDataSource.send` has no delivery confirmation beyond the
  `isWsDisconnected` flag; a disconnect between the check and the actual
  `send()` call would still silently drop a prompt. Pre-existing
  repo-wide limitation, not introduced here.
- No widget test exists for `dashboard_view.dart`'s new card specifically
  (no existing dashboard test harness to extend within this issue's
  scope); verified via `flutter analyze` + manual code trace only.
