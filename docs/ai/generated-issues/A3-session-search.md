# A3 — Add session Search to the nav

**Labels:** `feature`, `flutter`, `phase-a`
**Depends on:** A1

## Context

The CHATS list in the new nav column needs a quick client-side filter. This issue adds a 🔍 Search field (below the "+ New Session" button, above "CHATS") that filters the visible session list by name or preview text. All filtering is client-side over `AgentsController.sessions` — no new API endpoint.

## Likely files

- `apps/desktop_flutter/lib/features/agents/views/_agents_nav_column.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` (read `sessions`; add a `searchQuery` filter helper if not already present)

## Acceptance criteria

- [ ] A search input field (with a leading 🔍 icon) appears below the "+ New Session" button and above the CHATS section label in the nav column.
- [ ] Typing in the search field filters the CHATS session list to rows whose name or preview text contains the query (case-insensitive).
- [ ] When the search field is empty the full unfiltered session list is shown.
- [ ] Clearing the search field (via an × clear button or backspace to empty) restores the full list without requiring a tap elsewhere.
- [ ] The search filter composes with the "By Project" filter introduced in A2: both can be active simultaneously, narrowing the list to sessions matching both project and query.
- [ ] Search is entirely client-side — no extra HTTP requests.
- [ ] `dart format` and `flutter analyze --no-fatal-infos` pass with zero new errors.

## Widget test requirement (real-mounted surface)

Pump the REAL mounted Agents surface:
- Pre-populate `AgentsController.sessions` with test stubs whose names differ.
- Simulate typing a query; assert only matching rows are visible.
- Simulate clearing the query; assert all rows are restored.

## Required validation commands

```bash
cd apps/desktop_flutter && dart format . && flutter analyze --no-fatal-infos && flutter test
```

## Safety notes

- No backend changes in this issue.
- The search filter must NOT trigger `AgentsController.loadSessions()` (no extra network calls).

## Data-safety out-of-scope

No API calls, no new tables, no schema changes in this issue.
