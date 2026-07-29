# Issue #1172 inferred blast radius

GitNexus impact analysis was explicitly waived for this task.

## Production change

- `ChatList` is composed only by the Agents tab. Adding the lifecycle state
  and segmented control affects the visible cross-project chat catalog, its
  empty-state copy, and which existing session cards/actions are rendered.
- The filter delegates to the existing `buildAgentChatReadModel`; no session
  transport, persistence, mutation, route, or backend API changed.
- Explicit loading/error rendering reuses `ToolScreenState`. It changes only
  the zero-row presentation; cached rows, offline notice, pull-to-refresh, and
  all existing mutations keep their prior paths.

## Test-fixture change

- The fake OpenCode state gained an opt-in `includeOptimizerActivity` flag and
  `/__control/activity-sources` control endpoint.
- Default fake-server behavior is unchanged, preserving the existing
  Background Loops empty-state specs. Only the new #1172 e2e enables the
  optimizer fixture.

## Risk

Inferred risk is **LOW–MEDIUM**: one shared mobile UI component changes, but
the service/API contracts are unchanged and the fake-server extension is
disabled by default. The main residual risk is four lifecycle buttons fitting
on narrow devices; `SegmentedButtons` supplies the existing accessible,
theme-aware control used elsewhere in the app.
