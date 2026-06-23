# A4 — Relocate Brain / Deep Research / Tasks / Webhooks into TOOLS nav rows; remove Settings tiles and toolbar icons

**Labels:** `feature`, `flutter`, `phase-a`
**Depends on:** A1

## Context

Four existing agent views — `AgentMemoryView` (Brain), `AgentResearchView` (Deep Research), `AgentSchedulesView` (Tasks), `AgentWebhooksView` (Webhooks) — are currently reached via Settings tiles or toolbar icons. This issue adds them as TOOLS nav rows in the nav column and removes the old entry points. All four controllers are already registered in `main.dart` MultiProvider; no new provider wiring is required. All four view constructors are `const X({super.key})`.

## Likely files

- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (remove `Icons.schedule`/`Icons.travel_explore` from `_SessionListHeader` ~lines 776–801)
- `apps/desktop_flutter/lib/features/settings/views/settings_view.dart` (remove tiles ~lines 1465–1517: `_OdysseusSection` / `_OdysseusNavTile` entries for Schedules, Memory, Webhooks)

## Acceptance criteria

- [ ] The TOOLS group in the nav column contains four nav rows in this order: 🧠 Brain, 🔬 Deep Research, ⏰ Tasks, 🪝 Webhooks.
- [ ] Tapping 🧠 Brain opens `AgentMemoryView`.
- [ ] Tapping 🔬 Deep Research opens `AgentResearchView`.
- [ ] Tapping ⏰ Tasks opens `AgentSchedulesView`. (Label "Tasks" — clarification: these are scheduled AI jobs, not church tasks.)
- [ ] Tapping 🪝 Webhooks opens `AgentWebhooksView`.
- [ ] Each nav row opens its target via `Navigator.push` (existing push-route behavior — inline embedding is a non-goal per spec).
- [ ] The `Icons.schedule` and `Icons.travel_explore` icon buttons previously rendered in `_SessionListHeader` (~lines 776–801) are removed.
- [ ] The Settings tiles in `settings_view.dart` `_OdysseusSection` / `_OdysseusNavTile` entries for Schedules (~1487–1491), Memory (~1498–1502), and Webhooks (~1509–1513) are removed. If `_OdysseusSection` becomes empty, remove the entire section.
- [ ] `AgentSchedulesView`, `AgentResearchView`, `AgentMemoryView`, `AgentWebhooksView` are NOT modified — only their entry points change.
- [ ] `dart format` and `flutter analyze --no-fatal-infos` pass with zero new errors.

## Widget test requirement (real-mounted surface)

Pump the REAL mounted Agents surface:
- Assert each of the four TOOLS rows renders with its correct label.
- Tap each row and assert `Navigator` pushed the expected route (use `NavigatorObserver` or named-route assertions).
- Assert the Settings view does NOT render the removed tiles.

## Required validation commands

```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos && flutter test
```

## Safety notes

- Do NOT modify `AgentSchedulesView`, `AgentResearchView`, `AgentMemoryView`, or `AgentWebhooksView` internals.
- Do NOT remove the controllers from `main.dart` — they are still needed.
- No backend changes in this issue.

## Data-safety out-of-scope

No API calls, no new tables, no schema changes in this issue.
