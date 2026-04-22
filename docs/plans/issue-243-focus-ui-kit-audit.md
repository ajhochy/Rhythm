# Issue 243: Focus UI Kit Audit

## Decision

Use Focus Flutter UI Kit as a pattern reference, not as a direct dependency or copy target.

The first-pass UI overhaul should prioritize:

1. Shared Rhythm UI primitives under `apps/desktop_flutter/lib/app/core/ui/`
2. Weekly Planner work surface patterns
3. Task list/table controls

Dashboard signal cards and setup-flow components are good second-wave candidates once the shared primitives are stable.

## Focus Components To Reuse Or Adapt

### Shared Layout And Surface Patterns

Focus reference:
- `FUISectionPlain`
- `FUISectionContainer`
- `FUIPane`
- `FUIPanel`
- `FUITabPane`
- `FUIAccordion`

Rhythm adaptation:
- Use sections for full-width screen bands and major scroll areas.
- Use panels for framed task lists, planner detail panes, filter groups, and settings/integration forms.
- Use tabs or segmented controls for scoped state changes, such as task views or planner modes.
- Avoid directly importing Focus widget structure because Rhythm already has app-specific layout, controllers, and token names.

Recommended shared primitives:
- `RhythmSurface`
- `RhythmPanel`
- `RhythmSection`
- `RhythmToolbar`
- `RhythmSegmentedControl`
- `RhythmDisclosure`

### Weekly Planner Work Surface

Focus reference:
- `FUICalendarDateWheel`
- `FUICalendarView`
- `FUICalendarItem`
- `FUISectionPlain`
- `FUISectionContainer`

Rhythm adaptation:
- Keep Rhythm's planner workflow centered on a week, not a generic event calendar.
- Adapt the Focus calendar idea into a compact week selector, all-day event lane, day buckets, and time-grid blocks.
- Use a right-side detail pane for task/project/event detail without route changes.
- Reuse the visual ideas of grouped date controls and event blocks, but keep Rhythm's data model and controller flow.

Candidate primitives:
- `RhythmWeekStrip`
- `RhythmPlannerLane`
- `RhythmTimeBlock`
- `RhythmAllDayBar`
- `RhythmDetailPane`

### Task Table And List Controls

Focus reference:
- `FUIDataTable2`
- `FUIPaginatedDataTable2`
- `FUIAsyncPaginatedDataTable2`
- `FUIInputText`
- `FUIInputSelect`
- `FUIInputTags`
- `FUIPopupMenuIconButton`
- `FUITextPill`

Rhythm adaptation:
- Use Focus table density and filter layout as a reference for the Tasks screen.
- Keep the default task workflow list-first, with a table mode only where columns improve scanning.
- Bring search, segmented status filters, assignee filters, source chips, due-date chips, and row action menus into shared primitives.
- Avoid pagination unless data volume demands it. For desktop task triage, fast filtering and stable row height matter more.

Candidate primitives:
- `RhythmFilterBar`
- `RhythmSearchField`
- `RhythmTaskRow`
- `RhythmDataTable`
- `RhythmBadge`
- `RhythmSourceChip`
- `RhythmIconMenuButton`

### Dashboard Signal Cards

Focus reference:
- Dashboard rows in `lib/demo/dashboard/dashboard01`
- `FUIPane`
- `FUIPaceBar`
- status indicators
- small info tiles

Rhythm adaptation:
- Treat dashboard cards as a second-wave consumer of `RhythmPanel`, `RhythmBadge`, and typography tokens.
- Use signal cards for planning state: tasks this week, overdue work, unassigned tasks, calendar conflicts, active rhythms, and blocked project steps.
- Avoid decorative charts unless the data answers an operational planning question.

Candidate primitives:
- `RhythmSignalCard`
- `RhythmProgressMeter`
- `RhythmStatusDelta`

### Setup And Integration Flows

Focus reference:
- `FUIWizard`
- `FUIModal`
- `FUIToast`
- `FUIInputText`
- `FUIInputSelect`
- `FUIInputToggleSwitch`
- `FUIInputCheckbox`

Rhythm adaptation:
- Treat setup flows as a second-wave target for imports, integrations, and automation rule setup.
- Prefer inline setup panels or drawers over modal-heavy workflows.
- Use wizards only for truly sequential tasks, such as connecting a provider and choosing sync preferences.

Candidate primitives:
- `RhythmWizard`
- `RhythmDialog`
- `RhythmToast`
- `RhythmFormField`
- `RhythmToggle`

## Components Not To Copy

- Focus theme system wholesale. The docs describe Focus as themable through its own extension and widget-specific theme classes, while Rhythm needs a first-party Material-compatible token layer.
- Focus light palette. Issue 243 targets a dark-mode-first overhaul, and Focus currently documents only a light theme.
- Focus scaffold, router, and menu shell. Rhythm already has a desktop app shell and navigation sidebar.
- Focus demo business/finance widgets. Their visual structure can inspire dashboard density, but their domain does not map cleanly to Rhythm planning workflows.
- Focus demo background imagery, avatars, and sample data.
- Focus chart catalog as a default dependency. Only introduce charts when a Rhythm screen has a concrete planning metric to visualize.
- Calendar behavior that replaces Rhythm's weekly planning model with a generic event-calendar model.
- Pagination-first task tables. Rhythm should optimize for triage, filtering, and quick editing first.

## Shared UI Primitives To Create

Create these under `apps/desktop_flutter/lib/app/core/ui/` before screen rewrites:

- `tokens/`: dark and light color roles, spacing, radius, typography, elevation, focus rings, state layers
- `rhythm_surface.dart`: page and section surfaces
- `rhythm_panel.dart`: framed content panels
- `rhythm_toolbar.dart`: dense toolbar with search, filters, and actions
- `rhythm_badge.dart`: status/source/priority chips
- `rhythm_button.dart`: icon, filled, outlined, and quiet button variants
- `rhythm_menu_button.dart`: compact row and toolbar action menus
- `rhythm_search_field.dart`: search input with clear affordance
- `rhythm_empty_state.dart`: reusable empty/error/loading states
- `rhythm_dialog.dart`: confirmation and focused edit dialogs
- `rhythm_detail_pane.dart`: right-side detail surface shared by planner and tasks

Screen-specific primitives can follow:

- Weekly Planner: `RhythmWeekStrip`, `RhythmPlannerLane`, `RhythmTimeBlock`, `RhythmAllDayBar`
- Tasks: `RhythmTaskRow`, `RhythmTaskTable`, `RhythmFilterBar`
- Dashboard: `RhythmSignalCard`, `RhythmProgressMeter`

## Dark-Mode Theme Recommendation

Replace the current light-only `RhythmTokens` model with OS-aware theme structure:

- `RhythmTheme.light()`
- `RhythmTheme.dark()`
- `RhythmTheme.system()` wiring through `MaterialApp.theme`, `darkTheme`, and `themeMode`
- `RhythmColorRoles` for semantic colors instead of single-use screen constants
- `ThemeExtension` for Rhythm-specific roles that Material `ColorScheme` does not cover

Recommended dark roles:

- `canvas`: app background
- `surface`: major panels
- `surfaceMuted`: secondary panels and disabled regions
- `surfaceRaised`: popovers, dialogs, floating panels
- `border`: default outline
- `borderSubtle`: low-emphasis dividers
- `textPrimary`
- `textSecondary`
- `textMuted`
- `accent`
- `accentMuted`
- `success`
- `warning`
- `danger`
- `info`
- `focusRing`

Theme structure should keep Material 3 compatibility but let Rhythm widgets read first-party roles from a `ThemeExtension`.

## Screen Mapping

### Weekly Planner

First screen to consume the new primitives after foundation work.

Recommended changes:
- Replace ad hoc panel styling with `RhythmSurface`, `RhythmPanel`, and `RhythmDetailPane`.
- Introduce `RhythmWeekStrip` for week/date selection.
- Normalize all-day events, day task lanes, time-grid event blocks, and selected detail state.
- Keep the planner desktop-first and dense, with stable row/block dimensions.

### Tasks

Second screen to consume the new primitives.

Recommended changes:
- Replace custom filter/search styling with `RhythmToolbar`, `RhythmFilterBar`, and `RhythmSearchField`.
- Add consistent `RhythmBadge` variants for status, source, priority, and assignee state.
- Use stable `RhythmTaskRow` layout before considering a full table mode.
- Add row action menus through `RhythmIconMenuButton`.

### Dashboard

Second-wave target after planner/tasks prove the primitive set.

Recommended changes:
- Build planning signal cards from `RhythmPanel` and `RhythmBadge`.
- Add dashboard metrics only when they directly explain team workload, risk, or planning status.

## Implementation Order

1. Add dark/light token roles and `ThemeExtension`.
2. Add core primitives under `apps/desktop_flutter/lib/app/core/ui/`.
3. Convert Weekly Planner shell and detail pane to primitives.
4. Convert Tasks filters, rows, badges, and menus to primitives.
5. Revisit Dashboard cards once planner/tasks establish the visual language.
6. Revisit setup flows for integrations/imports if the same primitives are holding up.

## Preview Artifact

The interactive planning preview is available at:

`docs/plans/issue-243-focus-options-preview.html`

It demonstrates the selected first-pass recommendation (`D + B + C`) along with second-wave candidates (`A + E`).
