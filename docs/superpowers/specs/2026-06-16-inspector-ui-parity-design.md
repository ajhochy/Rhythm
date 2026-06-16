# Agent Inspector — UI Parity (Spec A)

Date: 2026-06-16
Status: Approved for planning
Scope: Flutter desktop only (`apps/desktop_flutter`). No backend changes.

## Summary

Bring the agent session side panel (Context / Changes / Terminal tabs) closer to
opencode parity, in three UI areas. The underlying data already flows to the
app — token/cost over the WebSocket (`message.updated`), diffs via
`GET /agent-sessions/:id/diff` — so this is presentation + light aggregation,
not new backend wiring.

This is **Spec A** of a two-part effort. **Spec B** (separate) covers the
streaming + interactive PTY terminal, which needs backend PTY-event relay.

### In scope
1. Collapse/expand the side panel (persisted).
2. Context tab: cumulative cost, full token breakdown, session metadata.
3. Changes tab: diff summary header + surfaced revert/restore controls.

### Out of scope
- Anything terminal/PTY (Spec B).
- Any backend / api_server change.

## Background (verified in code)

- Panel widget: `lib/features/agents/views/_session_side_panel.dart` (tabs at
  ~21–370; Context renderer ~190–370).
- Mounted in `lib/features/agents/views/agents_view.dart:110–115` (320px,
  rendered when `AgentsController.selectedSession != null`).
- Changes tab: `lib/features/agents/views/_changes_tab.dart`; diffs via
  `AgentsController.sessionDiffFor` / `fetchSessionDiff` →
  `/agent-sessions/:id/diff`. Revert/unrevert exist in the controller
  (`revert`/`unrevert`, ~lines 470–490) and refetch the diff.
- Context token usage: `AgentsController.sessionContextTokens` (sums **input**
  from the latest message's `tokens` map) + `contextWindowForSession` (catalog
  lookup, 200k fallback).
- Token/cost source: assistant messages carry `tokens` (input/output/
  reasoning/cache.read/cache.write) and `cost`; persisted to
  `agent_session_messages.{tokens_json,cost}`, broadcast via `message.updated`.
- Catalog (`_catalog`, `CatalogModelEntry`) provides model/provider display +
  `contextLimit`.

## Design

### 1. Collapse/expand the panel

- Add a collapse toggle (chevron `IconButton`) in the panel header
  (`_session_side_panel.dart`).
- **Expanded:** current 320px full panel. **Collapsed:** a ~44px rail showing
  the three tab icons (no labels/body) + an expand chevron. Tapping a tab icon
  while collapsed expands the panel to that tab.
- State: a `bool panelCollapsed` on `AgentsController` (or a dedicated
  `InspectorUiState` `ChangeNotifier` if cleaner), with
  `setPanelCollapsed(bool)` that persists to `shared_preferences` under a
  single global key (`agents.inspector.collapsed`) and `notifyListeners()`.
- Load the persisted value on controller init. Width stays fixed at 320.
- `agents_view.dart:110–115` switches between the rail and full panel on the
  collapsed flag.

### 2. Context tab parity

All additions render in the Context tab below the existing context-window
gauge; the "No messages yet" empty state stays for sessions with no assistant
messages.

- **Cumulative cost:** `AgentsController.sessionCostTotal(String sessionId)` →
  `double` summing `cost` across the session's assistant messages. Render
  "Session cost: $X.XXXX" (4 dp; show "$0.00" when zero). If `ChatMessage` does
  not already parse a `cost` field, add `final double cost;` (default 0) and
  parse `json['cost'] as num? ?? 0`.
- **Token breakdown:** `AgentsController.sessionTokenBreakdown(String sessionId)`
  → a small record/struct `{input, output, cacheRead, cacheWrite, reasoning}`
  from the latest assistant message's `tokens` map (0 when absent). Render as a
  compact labeled list under the gauge.
- **Session metadata:** model + provider **display name** (catalog lookup by
  `session.providerId`/`modelId`, falling back to the raw ids), `createdAt` /
  `updatedAt` (formatted with the app's existing date formatter), and message
  count (`_chatMessagesBySession[sessionId].length`). Render as labeled rows in
  the existing Context layout (reuse the Agent/Cwd/Status row style).

### 3. Changes tab parity

- **Summary header:** above the file list, render "N files · +A −D" computed
  from the already-fetched diff entries (count entries, sum `additions`/
  `deletions`). Hidden when there are no entries (the empty state stays).
- **Revert / Restore controls:** surface the existing controller revert path in
  the Changes tab header:
  - A "Revert changes" button (enabled when there are diff entries) that calls
    the existing revert flow to roll the session back to its base/first
    assistant message — exact target message resolved in planning by reading
    `AgentsController.revert`/session message ordering.
  - A "Restore" button (enabled when the session is in a reverted state) calling
    `unrevert`.
  - Both behind a confirm dialog (they mutate the working tree). After either,
    the existing diff refetch updates the summary + list.
- If determining a safe single revert target proves ambiguous, fall back to
  surfacing revert/restore only when the controller already exposes a clear
  session-level revert state, and note the limitation — do not invent new
  backend semantics.

## Error handling

- Cost/token getters return zeros for sessions with no assistant messages (no
  throw); the empty state renders.
- Revert/restore failures surface via the controller's existing error channel
  (same pattern as the current revert/unrevert handling); the confirm dialog
  prevents accidental invocation.
- Collapse persistence failures (shared_preferences) are non-fatal: fall back to
  expanded (default) and log.

## Testing

Given this inspector's history of being built as isolated, unmounted widgets,
**every UI piece is tested through the mounted surface**:

- Pump `AgentsView` (or the smallest real surface that mounts
  `_session_side_panel`) with a real `AgentsController` seeded with a selected
  session + fake messages/diff, and assert:
  - Collapsed rail renders tab icons and hides the body; expand restores it; the
    persisted flag round-trips (set → reload → state).
  - Context shows the cost line, the token breakdown values, and the metadata
    rows for a session with assistant messages; shows the empty state otherwise.
  - Changes shows the "N files · +A −D" summary for seeded diff entries and the
    revert/restore controls in the correct enabled/disabled states.
- Unit tests for the pure getters: `sessionCostTotal`, `sessionTokenBreakdown`
  (including zero/empty cases).

## File structure (touch list)

- Modify: `lib/features/agents/controllers/agents_controller.dart` — add
  `panelCollapsed` + `setPanelCollapsed`, `sessionCostTotal`,
  `sessionTokenBreakdown`, metadata helpers; load persisted collapse on init.
- Modify: `lib/features/agents/views/_session_side_panel.dart` — collapse
  toggle + rail; Context tab cost/breakdown/metadata.
- Modify: `lib/features/agents/views/_changes_tab.dart` — summary header +
  revert/restore controls.
- Modify: `lib/features/agents/views/agents_view.dart` — render rail vs. full
  panel on the collapsed flag.
- Modify (if needed): `lib/features/agents/models/chat_message.dart` (or
  equivalent) — add `cost` field if not already parsed.
- Tests: `test/features/agents/inspector_ui_parity_test.dart` (mounted-surface)
  + getter unit tests.
