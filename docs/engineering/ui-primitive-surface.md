# UI Primitive Surface

Source-of-truth note for the shared UI primitive layer that satisfies issue #244 after the issue #244, #292, and #293 extractions.

Location: `apps/desktop_flutter/lib/app/core/ui/`

Barrel export: `rhythm_ui.dart` — re-exports every primitive in this doc plus the theme tokens. Import it instead of cherry-picking individual files.

## Tokens

| File | What it provides |
|------|------------------|
| `tokens/rhythm_theme.dart` | `RhythmTheme.*` color, spacing, radius, and typography tokens. Light theme is the polished default; dark mode structure is in place but not the Phase 1 target. |

Do not hand-roll colors, spacing, or radii in feature code. Read from the tokens.

## Core Shared Primitives

These are the building blocks every screen should compose. They have no feature-domain dependencies and are safe to use anywhere.

### Surfaces and layout
| File | Public API |
|------|------------|
| `rhythm_surface.dart` | `RhythmSurface`, `RhythmSurfaceTone` |
| `rhythm_panel.dart` | `RhythmPanel` |
| `rhythm_section_header.dart` | `RhythmSectionHeader` |
| `rhythm_disclosure.dart` | `RhythmDisclosure` |
| `rhythm_toolbar.dart` | `RhythmToolbar` |
| `rhythm_detail_pane.dart` | `RhythmDetailPane` |

### Controls and inputs
| File | Public API |
|------|------------|
| `rhythm_button.dart` | `RhythmButton`, `RhythmButtonVariant` |
| `rhythm_menu_button.dart` | `RhythmMenuButton<T>`, `RhythmMenuAction<T>` |
| `rhythm_segmented_control.dart` | `RhythmSegmentedControl<T>`, `RhythmSegment<T>` |
| `rhythm_search_field.dart` | `RhythmSearchField` |
| `rhythm_filter_bar.dart` | `RhythmFilterBar<T>` |
| `rhythm_assignee_field.dart` | `RhythmAssigneeField` |
| `rhythm_date_button.dart` | `RhythmDateButton` (pair with `pickRhythmDate` from `core/formatters/date_formatters.dart`) |

### Display and data presentation
| File | Public API |
|------|------------|
| `rhythm_badge.dart` | `RhythmBadge`, `RhythmBadgeTone` |
| `rhythm_meta_chip.dart` | `RhythmMetaChip`, `RhythmMetaChipTone` |
| `rhythm_compact_row.dart` | `RhythmCompactRow`, `RhythmCompactRowTone` |
| `rhythm_preview_row.dart` | `RhythmPreviewRow` |
| `rhythm_empty_state.dart` | `RhythmEmptyState`, `RhythmEmptyStateTone` (covers empty, loading, and error variants) |

### Modals
| File | Public API |
|------|------------|
| `rhythm_dialog.dart` | `RhythmDialog`, `RhythmDialog.confirm(...)` |

## Shared Composite Surfaces

These are pre-built composites that bundle several primitives into a complete domain interaction. They live in `core/ui/` because they are reused by multiple screens (Dashboard, Tasks, Weekly Planner). Treat them as the canonical entry points — do not re-implement task creation or inspection inside a feature.

| File | Public API |
|------|------------|
| `rhythm_task_create_bar.dart` | `RhythmTaskCreateBar` (inline create input) |
| `rhythm_task_create_dialog.dart` | `showRhythmTaskCreateDialog(...)`, `RhythmTaskCreateResult` |
| `rhythm_inspector.dart` | `showRhythmTaskInspector(...)`, `showRhythmProjectStepInspector(...)`, `RhythmTaskInspectorSaveRequest`, `RhythmProjectStepInspectorSaveRequest` |

## Upstream-Derived Reference

| File | Notes |
|------|-------|
| `focus_business_widgets.dart` | Focus Flutter UI Kit-derived widgets used by the Dashboard signal cards. License pointer at the top of the file. Compose into screens, do not modify ad-hoc — adapt by extracting a new Rhythm primitive instead. |

## Screen-Specific Composition (NOT primitives)

Anything under `apps/desktop_flutter/lib/features/<feature>/views/` is screen composition, not primitive surface. Examples that look reusable but are not:

- `features/dashboard/views/*` — Dashboard layout and signal arrangement
- `features/weekly_planner/views/*` — planner-specific board and column layouts
- `features/tasks/views/*` — task list/table chrome
- Any private widget prefixed with `_` — by convention, screen-local

If a screen widget starts being copied across features, extract it to `core/ui/` as a new `Rhythm*` primitive and add it to the `rhythm_ui.dart` barrel. Do not import across feature boundaries.

## Adding a New Primitive

1. File goes under `apps/desktop_flutter/lib/app/core/ui/<name>.dart`.
2. Imports allowed: `flutter/material.dart`, sibling primitives, `tokens/rhythm_theme.dart`, and `core/formatters/`. No `features/` imports.
3. Read all colors/spacing/typography from `tokens/rhythm_theme.dart`.
4. Add the file to the `rhythm_ui.dart` barrel export.
5. Update this doc's tables.

## Verification

- `flutter analyze apps/desktop_flutter` — no errors.
- `flutter test` in `apps/desktop_flutter` — all tests pass.
- Run the app: `flutter run -d macos` from `apps/desktop_flutter`.
