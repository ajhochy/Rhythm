# Inferred blast radius — issue #1037

Status: implementation unblocked by clarified scope.

## Existing path confirmed

`TasksLocalDataSource.update` already serializes a non-null `status` into the
body of the existing `PATCH /tasks/:id` request. `TasksRepository.update`
already forwards that field. No API route, server model, database, or new HTTP
call is required.

## Symbols and views affected

- `TasksController`
  - Add `updateStatus(String id, TaskStatus status)`.
  - It optimistically moves the task, reconciles with the repository response,
    and restores the prior list if the PATCH fails.
  - Existing callers of `load`, `createTask`, `updateTask`, `toggleDone`, and
    `deleteTask` remain source-compatible.
- `TasksView`
  - Add local list/board presentation state.
  - Add a compact `RhythmSegmentedControl`, matching the existing local
    segmented filters in the same toolbar.
  - Continue owning load, error-banner, search, and task-creation behavior.
- `TasksKanbanView` (new)
  - Read the already-loaded task list passed by `TasksView`.
  - Group each task into exactly one of the four existing `TaskStatus` values.
  - Sort cards by `scheduledOrder`, then due date.
  - Route drag acceptance to `TasksController.updateStatus`.

## Risk assessment

Risk: low-to-medium, Flutter desktop only.

- Direct UI risk is confined to the Tasks destination.
- Drag acceptance temporarily changes controller state before the existing
  PATCH completes; rollback prevents a failed request from leaving the card in
  the wrong column.
- The board uses the same controller list as the existing list view, so there
  is no second cache or data source.
- No shell navigation index changes are needed. Weekly Planner and Automations
  are separate `AppShell` destinations; for two presentations of the same task
  entity, the least-invasive established pattern is TasksView's own stateful
  `RhythmSegmentedControl`.
- No `api_server`, repository endpoint, schema, migration, or
  `docs/ai/decisions/` file is in the blast radius.

## 2026-07-28 toolbar overflow follow-up

### Baseline finding

The reported overflow is present in the base tree and was not introduced by
the issue-#1037 view toggle:

- `git show main:.../rhythm_toolbar.dart` is identical to the working-tree
  toolbar layout. Its existing `< 760` narrow branch changes the outer toolbar
  from a `Row` to a `Column`, but its controls remain a `Wrap` whose children
  wrap only as whole widgets.
- `git show main:.../rhythm_color_legend.dart` is identical to the
  working-tree legend. `RhythmColorLegend` returns one `Row` containing every
  legend item. That row cannot break internally.
- `git show main:.../tasks_view.dart` already mounts the same seven-item
  `RhythmColorLegend`. The reported legend row is 108 pixels wider than its
  708-pixel constraint, so the same indivisible row cannot fit at that width
  with or without the new view-toggle sibling.

The new toggle can cause the already-broken width to be encountered by this
widget test, but it is not the root layout defect. Per the task's explicit
baseline rule, neither `rhythm_toolbar.dart` nor
`rhythm_color_legend.dart` was changed in this follow-up.

### `RhythmColorLegend` call-site analysis

There are exactly two production call sites:

1. `features/tasks/views/tasks_view.dart`
   - Seven items.
   - Present on `main` before the Kanban toggle.
   - This is the reported 708-pixel overflow.
2. `features/weekly_planner/views/weekly_planner_view.dart`
   - Six items in the same indivisible legend row.
   - Uses the same `RhythmToolbar` filters slot and therefore has the same
     narrow-width failure mode at a slightly smaller threshold.

The only `Row` directly wrapped by `RhythmColorLegend` is its own line-12
outer row; `_LegendItem` also uses a small non-wrapping row for each dot/label
pair, which is appropriate because individual legend entries should remain
atomic. No other direct construction or test call sites exist.

A proper shared fix should make the legend's collection wrap while retaining
each `_LegendItem` as an atomic row. That would improve both known call sites,
but it is a pre-existing shared-component repair and is intentionally not
silently folded into #1037.
