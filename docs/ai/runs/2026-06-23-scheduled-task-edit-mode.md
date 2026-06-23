---
index: "[[Rhythm]]"
date: 2026-06-23
repo: Rhythm
branch: feature/agent-scheduler
pr: "734"
issues: scheduled-task-edit-mode
status: verified (headless) — manual smoke pending
tags: [run, Rhythm]
---

# Run: Add edit capability to Scheduled Task form sheet

## Summary

The `AgentSchedulesView` schedule form sheet was create-only. This run adds
full edit capability: the same form widget (`_ScheduleFormSheet`) now accepts
an optional `existing` task, pre-fills all fields, shows "Edit Scheduled Task"
/ "Save" titles, and calls `controller.update(id, patch)` on submit instead of
`controller.create`. An "Edit" button (key `edit-schedule-button`) was added to
`_TaskDetailSheet` between Delete and Trigger Now.

## Files changed

- `lib/features/agent_schedules/views/agent_schedules_view.dart`
  - Renamed `_NewScheduleSheet` → `_ScheduleFormSheet`; added `existing:
    AgentScheduledTask?` constructor param.
  - Added `_isEdit` getter; `initState` pre-fills all form controllers/state
    from `existing` when non-null.
  - `_submit` branches on `_isEdit` to call `controller.update(id, patch)` vs
    `controller.create(payload)`.
  - Form title reads "Edit Scheduled Task" (vs "New Scheduled Task"); submit
    button reads "Save" (vs "Create Schedule") when `_isEdit == true`.
  - Added `_showEditScheduleSheet(context, task)` helper.
  - `_showDetailSheet` now passes `onEdit` callback to `_TaskDetailSheet`.
  - `_TaskDetailSheet` gained required `onEdit: VoidCallback` field and a new
    `OutlinedButton.icon` (key `edit-schedule-button`) styled with `rhythm.accent`.
- `test/features/agent_schedules/agent_schedules_edit_test.dart` — new file
  - `_FakeSchedulesDataSource`: records `lastUpdatedId`, `lastUpdatedPatch`,
    `createCalled` flag.
  - `_EmptyAgentConfigsDataSource`: no-op list() for provider wiring.
  - Test 1: "edit mode pre-fills name and prompt" — finds tile, taps Edit,
    asserts form title + field values.
  - Test 2: "tapping Save calls update(id) not create" — taps Edit, taps Save,
    asserts `lastUpdatedId == _kTaskId` and `createCalled == false`.

## Checks run

| Check | Result |
|-------|--------|
| `dart format . --set-exit-if-changed` | PASS — 0 files changed |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings, 260 pre-existing infos |
| `flutter test` (full suite) | **635 PASS, 0 FAIL** (+2 new tests) |
| Stale-symbol grep (`_NewScheduleSheet`) | 0 live code references (only docs mention) |

Branch: `feature/agent-scheduler`
Commit: `463f2a373787ed508f5b611ebad86d4a3e8e0a94`

## Decisions

- Single form widget for create + edit (no duplication). The `existing` param
  is `null` for new tasks and non-null for edits; `_isEdit` is the single
  branch point.
- `_TaskDetailSheet.onEdit` is a **required** `VoidCallback` — making it
  required means a missed call-site is a compile error, not a silent no-op.
- Edit flow: `Navigator.pop` closes detail sheet, then `_showEditScheduleSheet`
  opens the form sheet — avoids nested sheets.

## Notes

- `flutter run` was forbidden during this session; visual smoke required before
  merging PR #734.
- Manual smoke checklist addition: verify Edit button appears in detail sheet,
  form fields pre-fill, and Save button calls PATCH (check network tab or
  server logs).
