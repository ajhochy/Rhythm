# A5 — Surface Profiles as a TOOLS nav row

**Labels:** `feature`, `flutter`, `phase-a`
**Depends on:** A1, A2

## Context

The old `ProjectsRail` had a profiles section at the bottom (opened via `showAgentProfileSheet`). That section is now retired (rail removed in A2). This issue adds a 🤖 Profiles nav row to the TOOLS group in the new column, wiring it to the same `showAgentProfileSheet(context)` call. The profile sheet itself is unchanged.

## Likely files

- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart`
- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart` (reuse `showAgentProfileSheet` — no changes to the sheet itself)
- `apps/desktop_flutter/lib/features/agents/views/_projects_rail.dart` (remove profiles section if not already fully retired by A2)

## Acceptance criteria

- [ ] The TOOLS group in the nav column includes a 🤖 Profiles row (positioned after the four rows from A4: Brain, Deep Research, Tasks, Webhooks, and before the future Cookbook/Email/Gallery rows).
- [ ] Tapping 🤖 Profiles calls `showAgentProfileSheet(context)` and the profile sheet opens.
- [ ] The profiles section that previously lived at the bottom of `_ProjectsRail` is not rendered anywhere else in the Agents screen.
- [ ] `_agent_profile_sheet.dart` is not modified.
- [ ] `dart format` and `flutter analyze --no-fatal-infos` pass with zero new errors.

## Widget test requirement (real-mounted surface)

Pump the REAL mounted Agents surface:
- Assert the 🤖 Profiles row renders in the TOOLS group.
- Tap the Profiles row and assert the profile sheet dialog/bottom-sheet appears.

## Required validation commands

```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos && flutter test
```

## Safety notes

- Do NOT modify the profile sheet internals.
- No backend changes in this issue.

## Data-safety out-of-scope

No API calls, no new tables, no schema changes in this issue.
