# Issue #651 — Collaborator add/remove fails silently with no error UI

## Symptom

In vbeta.18.37, when a user adds an AI account (e.g. "Visalia CRC") as a
collaborator on a task, two things happen at once:

1. The collaborator chip does not appear (looks like the save was never
   applied).
2. The task-ready chat bubble does not open.

The user sees **nothing** — no toast, no banner, no inline error, no
indication that anything went wrong.

This is the same surface symptom that #644 was filed to fix, returning in the
release that should contain the #644 fix.

## Root cause vs. shipped fix

Investigation against the current source (vbeta.18.37 = main @ e368a72):

- The #644 fix is intact on every `CollaboratorsDataSource` construction site
  (`tasks_view.dart`, `weekly_planner_view.dart`, `dashboard_view.dart`,
  `projects_view.dart`, plus the two `CollaboratorsRow` callbacks in
  weekly planner and projects).
- The backend `tasks_controller.addCollaborator` still saves the collaborator
  unconditionally and still emits a `pending_claude_trigger` when the added
  user matches `env.claudeUserId`.
- Production `/health` is responding 200.

Yet the symptom is back. There is a class of regressions — wrong stored
`ServerConfigService.url`, expired auth token, deployed backend missing the
`#339` change, a permissions edge case — that all produce **silent failure**
because every collaborator add/remove call site in the UI swallows the
thrown `AppError` from `assertOk`:

- [`rhythm_inspector.dart:768-775`](../../apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart#L768) — `_showPeoplePicker` uses `try { ... } finally { ... }` with **no** `catch` clause.
- [`rhythm_inspector.dart:778-787`](../../apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart#L778) — `_removeCollaborator` same shape.
- [`collaborators_row.dart:39`](../../apps/desktop_flutter/lib/shared/widgets/collaborators_row.dart#L39) — `GestureDetector.onLongPress` calls `onRemove` with no error handling.
- [`collaborators_row.dart:108-110`](../../apps/desktop_flutter/lib/shared/widgets/collaborators_row.dart#L108) — `_showPeoplePicker` awaits `onAdd` with no error handling.

The thrown `AppError` propagates as an unhandled async error, which is
invisible in release builds. Without an error surface there is no way for a
user (or us) to know whether the underlying failure is auth, network, URL
config, or backend.

This issue is therefore both:

1. A **regression-immune UX fix**: never let a collaborator add/remove fail
   silently again. Surface the `AppError.message` (and statusCode when
   present) as a `SnackBar`.
2. A **diagnostic shim** that exposes the actual root cause of the
   vbeta.18.37 regression on the user's next test, so the follow-up fix can
   target the right layer.

## Acceptance criteria

- **c1** When `CollaboratorsRow.onAdd` throws an `AppError`, the row shows a
  `SnackBar` whose content text contains the `AppError.message`.
- **c2** When `CollaboratorsRow.onRemove` throws an `AppError` (long-press on
  an existing chip), the row shows a `SnackBar` containing the message.
- **c3** When the task inspector's `onAddCollaborator` callback throws an
  `AppError`, the inspector shows a `SnackBar` containing the message and the
  loading spinner state is cleared.
- **c4** When the task inspector's `onRemoveCollaborator` callback throws an
  `AppError`, the inspector shows a `SnackBar` containing the message and the
  loading spinner state is cleared.
- **c5** (manual smoke) Re-test the original repro on vbeta.18.38: add Visalia
  CRC as collaborator on a task; if it still fails, the error message shown
  identifies the actual root cause (status code, server URL, or backend
  response body).

## Likely files

- `apps/desktop_flutter/lib/shared/widgets/collaborators_row.dart`
- `apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart`
- `apps/desktop_flutter/test/features/tasks/issue_651_contract_test.dart` (new)

## Out of scope

- The underlying root cause of the vbeta.18.37 regression. That requires the
  error message produced by c5 to be visible first; the follow-up issue will
  be filed once the user retests with this shim in place.

## Validation

- `flutter test test/features/tasks/issue_651_contract_test.dart`
- `ai-workflow checks --level pr`
