# A1 — Agents left-nav: single Odysseus-style column shell

**Labels:** `feature`, `flutter`, `phase-a`
**Depends on:** —

## Context

The current Agents screen layout (`_buildWorkspace`) is a `Row` of `ProjectsRail(64px)` + `_SessionListPanel(320px)` + transcript + inspector. This issue replaces the first two children with a single Odysseus-style nav column — header, New Session button, CHATS section (hosting the existing session list), an empty TOOLS group placeholder, and a footer row — while leaving the transcript and inspector completely untouched.

## Likely files

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (`_buildWorkspace`, `_SessionListPanel`, `_SessionListHeader`)
- NEW `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart`
- `apps/desktop_flutter/lib/app/core/ui/tokens/rhythm_theme.dart` (read only — source of token values)

## Acceptance criteria

- [ ] `_buildWorkspace` renders a `Row[ _AgentsNavColumn · Expanded(_TranscriptPanel) · (inspector if open) ]` — the 64px `ProjectsRail` and the old `_SessionListPanel` are gone from this Row.
- [ ] `_AgentsNavColumn` has a fixed width of ≤ 280 px and a header row containing a collapse/expand toggle icon (`Icons.menu`) and the wordmark "Agents".
- [ ] Below the header is a "+ New Session" button that calls the existing `_instantCreateSession` handler.
- [ ] Below New Session is a "CHATS" section label followed by the existing session list (sessions remain selectable and highlight the active session).
- [ ] Below CHATS is a "TOOLS" section label with an empty placeholder container (no rows yet — populated by A4/A5).
- [ ] At the bottom is a footer row with an "Account" placeholder and a ⚙ Settings icon that navigates to `SettingsView`.
- [ ] All background/border/text colors use the Rhythm 2.0 light theme tokens: sidebar bg `#F8F9FA`, border `#E5E7EB`, primary `#4F6AF5`, text `#111827`/`#6B7280`.
- [ ] Collapse toggle hides the nav column (0 width or hidden) and expands it again — the transcript panel takes the full width when collapsed.
- [ ] Selecting a session in the CHATS list still loads the transcript on the right (no regression in existing selection behavior).
- [ ] `dart format` and `flutter analyze --no-fatal-infos` both pass with zero new errors.

## Widget test requirement (real-mounted surface)

Per repo memory "Agents inspector was orphaned": the test MUST pump the REAL mounted Agents surface (not an isolated widget), assert:
- The nav column renders
- The CHATS session list renders at least one row (or an empty-state widget)
- Tapping a session row marks it selected

## Required validation commands

```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos && flutter test
```

## Safety notes

- Do NOT touch `navigation_sidebar.dart` (main app sidebar — Agents remains at index 9, unchanged).
- Do NOT modify the transcript pane (`_TranscriptPanel`) or the inspector/context pane (`SessionSidePanel`).
- No backend changes in this issue.

## Data-safety out-of-scope

No API calls, no new tables, no schema changes in this issue.
