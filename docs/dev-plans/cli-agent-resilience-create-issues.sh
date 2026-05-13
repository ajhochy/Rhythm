#!/usr/bin/env bash
# Creates milestones and issues for the CLI Agent Resilience plan.
# Run from inside the Rhythm repo: bash docs/dev-plans/cli-agent-resilience-create-issues.sh
#
# Prereqs: gh authenticated against the Rhythm repo.
# Idempotency: not idempotent — re-running creates duplicates. Delete prior issues/milestones
# manually if you need to redo.

set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
echo "Creating in repo: $REPO"

# Idempotent: reuse existing milestone with same title; create only if missing.
mk_milestone() {
  local title="$1"
  local description="$2"
  local existing
  existing=$(gh api "repos/$REPO/milestones?state=all&per_page=100" \
    --jq ".[] | select(.title == \"$title\") | .number" | head -n1)
  if [[ -n "$existing" ]]; then
    echo "$existing"
    return 0
  fi
  gh api "repos/$REPO/milestones" \
    --method POST \
    --field title="$title" \
    --field description="$description" \
    --jq '.number'
}

echo "Resolving milestones..."
M1_TITLE="CLI Agent Resilience – Phase 1: Foundation"
M2_TITLE="CLI Agent Resilience – Phase 2: Controller logic"
M3_TITLE="CLI Agent Resilience – Phase 3: UI"
M1=$(mk_milestone "$M1_TITLE" "HealthPoller utility, lostConnection reason, server health polling, WS connectivity stream.")
M2=$(mk_milestone "$M2_TITLE" "AgentSessionConnectivity, stuck-session tracking, reconnectSession, offline closeSession fallback.")
M3=$(mk_milestone "$M3_TITLE" "Status dot, inline banner, Reconnect button, stuck hint, dynamic agent list in New Session dialog.")

echo "Milestones: P1=$M1 P2=$M2 P3=$M3"

# Pre-load existing issue titles so we don't recreate duplicates.
EXISTING_TITLES=$(gh issue list --state all --limit 500 --json title --jq '.[].title')

# Idempotent: skip if an issue with the same title already exists.
mk_issue() {
  local title="$1"
  local body="$2"
  local milestone="$3"
  if grep -Fxq -- "$title" <<<"$EXISTING_TITLES"; then
    echo "(exists) $title"
    return 0
  fi
  gh issue create --title "$title" --milestone "$milestone" --body "$body" | tail -n1
}

# ---------------------------------------------------------------------------
# Issue 1
# ---------------------------------------------------------------------------
read -r -d '' BODY_1 <<'EOF' || true
## Goal

Add a reusable utility class that periodically calls an async health-check function, pauses while the app is backgrounded, fires a callback only on health-state transitions, and tolerates transient flaps via a 2-consecutive-failure guard.

## Files to touch

- CREATE `apps/desktop_flutter/lib/app/core/agents/health_poller.dart`
- CREATE `apps/desktop_flutter/test/app/core/agents/health_poller_test.dart`

## Requirements

Public surface:

```dart
class HealthPoller with WidgetsBindingObserver {
  HealthPoller({
    required Future<bool> Function() checkFn,
    required void Function(bool isHealthy) onHealthChanged,
    Duration interval = const Duration(seconds: 15),
    int failureThreshold = 2,
  });

  void start();
  void dispose();
}
```

Behavior:

- On `start()`: register as `WidgetsBindingObserver`, run a check immediately, then `Timer.periodic(interval, ...)`.
- Each tick: call `checkFn()`. `true` resets the consecutive-failure counter. `false` increments it; once it reaches `failureThreshold`, transition health from `true` → `false` and fire `onHealthChanged(false)`. First `true` after a `false` state fires `onHealthChanged(true)`.
- `onHealthChanged` fires only on transitions.
- On `didChangeAppLifecycleState(AppLifecycleState != resumed)`: cancel the timer. On `resumed`: immediate check + restart periodic timer.
- `dispose()`: cancel timer, remove observer. Idempotent.

## Constraints

- Pure Dart + `package:flutter/widgets.dart`. `checkFn` is injected; no `http` or `dart:io` here.
- Leaf utility; no controller dependencies.

## Acceptance criteria

- [ ] Class compiles; `dart format` clean; `flutter analyze --no-fatal-infos` clean.
- [ ] Unit tests cover: state-change callback fires only on transition; 2 consecutive failures required before signalling false; lifecycle pause stops timer; lifecycle resume restarts timer with an immediate check; `dispose()` is idempotent.

## Tests to update

- New: `apps/desktop_flutter/test/app/core/agents/health_poller_test.dart`
EOF

# ---------------------------------------------------------------------------
# Issue 2
# ---------------------------------------------------------------------------
read -r -d '' BODY_2 <<'EOF' || true
## Goal

Distinguish "the agent server stopped responding after it was once healthy" from existing startup failure reasons so the UI shows an actionable message.

## Files to touch

- `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` (line ~7) — add `lostConnection` to `AgentServerFailureReason` enum.
- `apps/desktop_flutter/lib/app/core/agents/agent_server_controller.dart` (line ~26) — extend the `errorMessage` switch with a case for `lostConnection`: "The agent server stopped responding. Click Restart to bring it back."

## Requirements

- Enum gains exactly one value: `lostConnection`.
- `errorMessage` getter returns the new message for `lostConnection`.
- No call site sets the new reason yet — that comes in Issue 3.

## Acceptance criteria

- [ ] `dart analyze` finds no missing switch case.
- [ ] Existing tests still pass.

## Tests to update

- `apps/desktop_flutter/test/features/agents/agent_server_controller_test.dart` — add a test that `errorMessage` returns the expected text when `_failureReason = lostConnection`.
EOF

# ---------------------------------------------------------------------------
# Issue 3
# ---------------------------------------------------------------------------
read -r -d '' BODY_3 <<'EOF' || true
## Goal

After the agent server starts successfully, continuously verify it's reachable. If `/health` fails twice in a row, transition `AgentServerController` to `failed` with `lostConnection` reason so the UI reacts.

**Depends on:** Issue 1 (HealthPoller), Issue 2 (lostConnection reason).

## Files to touch

- `apps/desktop_flutter/lib/app/core/agents/agent_server_controller.dart`

## Requirements

- Add `HealthPoller? _poller` field.
- After the existing `if (result.ok)` block in `initialize()`, construct a `HealthPoller(checkFn: () => _service.checkHealth('http://localhost:4001'), onHealthChanged: _onHealthChanged, interval: const Duration(seconds: 15))` and call `_poller!.start()`.
- Implement `_onHealthChanged(bool healthy)`:
  - If `!healthy` and `_status == ready`: set `_status = failed`, `_failureReason = lostConnection`, `notifyListeners()`.
  - If `healthy` and `_status == failed && _failureReason == lostConnection`: set `_status = ready`, `_failureReason = null`, `notifyListeners()`.
- `retry()` disposes any existing poller before re-calling `initialize()`.
- `dispose()` disposes the poller in addition to stopping the service.

## Constraints

- Use `AppConstants.agentLocalBaseUrl` if available; else hardcode `http://localhost:4001`.
- Do not change the existing startup sequence (start → wait for ready → fetch capabilities). Polling begins after capabilities fetch is dispatched.

## Acceptance criteria

- [ ] Once server is up, `_poller` is non-null and started.
- [ ] When `_service.checkHealth` returns false twice consecutively, status transitions to `failed` with `lostConnection` reason.
- [ ] When health recovers, status transitions back to `ready`.
- [ ] `retry()` cancels the old poller before starting a new lifecycle.
- [ ] No regressions in existing tests.

## Tests to update

- `apps/desktop_flutter/test/features/agents/agent_server_controller_test.dart` — fake `ApiServerService` whose `checkHealth` returns a scripted bool sequence; verify status transitions and retry resets the poller.
EOF

# ---------------------------------------------------------------------------
# Issue 4
# ---------------------------------------------------------------------------
read -r -d '' BODY_4 <<'EOF' || true
## Goal

Let `AgentsController` know when the WebSocket has been down long enough to warrant user-visible action, without forcing it to peek at private reconnect state in the data source.

## Files to touch

- `apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart`
- `apps/desktop_flutter/lib/features/agents/repositories/agents_repository.dart` (add a passthrough getter)
- `apps/desktop_flutter/test/features/agents/agents_data_source_connectivity_test.dart` (new)

## Requirements

In `AgentsDataSource`:
- `final StreamController<bool> _connectivityController = StreamController<bool>.broadcast();`
- `Stream<bool> get connectivityStream => _connectivityController.stream;`
- `Timer? _disconnectFailTimer`.
- In `connect()` (after channel is set up successfully): cancel `_disconnectFailTimer` and emit `true`.
- In `_handleDisconnect()`: cancel prior `_disconnectFailTimer`, then `Timer(const Duration(seconds: 10), () => _connectivityController.add(false))` so the disconnected signal is delayed by 10s.
- In `dispose()`: cancel timer; close the controller.

In `AgentsRepository`: `Stream<bool> get connectivityStream => _dataSource.connectivityStream;` (also to the interface if one exists).

## Constraints

- Use a broadcast controller — `AgentsController` will subscribe; future listeners may join.
- Do not change existing reconnect backoff logic; this is purely additive.

## Acceptance criteria

- [ ] After `connect()` succeeds, exactly one `true` event is emitted.
- [ ] On disconnect followed by no reconnect within 10s, exactly one `false` event is emitted.
- [ ] On disconnect followed by successful reconnect within 10s, no `false` event is emitted (timer is cancelled).
- [ ] `dispose()` closes the controller and cancels the timer.

## Tests to update

- New: `apps/desktop_flutter/test/features/agents/agents_data_source_connectivity_test.dart`. Use `FakeAsync` or a stub WS channel.
EOF

# ---------------------------------------------------------------------------
# Issue 5
# ---------------------------------------------------------------------------
read -r -d '' BODY_5 <<'EOF' || true
## Goal

Provide a single typed object the view reads for connectivity-derived UI state.

## Files to touch

- CREATE `apps/desktop_flutter/lib/features/agents/models/agent_session_connectivity.dart`

## Requirements

```dart
class AgentSessionConnectivity {
  const AgentSessionConnectivity({
    this.isWsDisconnected = false,
    this.stuckSessionIds = const <String>{},
  });

  final bool isWsDisconnected;
  final Set<String> stuckSessionIds;

  bool isStuck(String sessionId) => stuckSessionIds.contains(sessionId);

  AgentSessionConnectivity copyWith({
    bool? isWsDisconnected,
    Set<String>? stuckSessionIds,
  });
}
```

Plain value type. No `ChangeNotifier`. No `Equatable`.

## Acceptance criteria

- [ ] Class compiles, `dart format` clean, `flutter analyze` clean.

## Tests to update

- None required for a pure value type.
EOF

# ---------------------------------------------------------------------------
# Issue 6
# ---------------------------------------------------------------------------
read -r -d '' BODY_6 <<'EOF' || true
## Goal

Translate raw WS connectivity events into the `AgentSessionConnectivity` value exposed to the view.

**Depends on:** Issue 4 (connectivityStream), Issue 5 (model).

## Files to touch

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`

## Requirements

- Add `AgentSessionConnectivity _connectivity = const AgentSessionConnectivity();` field.
- Add `AgentSessionConnectivity get connectivity => _connectivity;`.
- Add `StreamSubscription<bool>? _connectivitySub` field.
- In `initialize()` (or equivalent setup): subscribe to `_repository.connectivityStream`:
  - On `true`: if `_connectivity.isWsDisconnected`, set `_connectivity = _connectivity.copyWith(isWsDisconnected: false)`, `notifyListeners()`.
  - On `false`: if `!_connectivity.isWsDisconnected`, set `_connectivity = _connectivity.copyWith(isWsDisconnected: true)`, `notifyListeners()`.
- In `dispose()`: cancel `_connectivitySub`.

## Constraints

- Do not touch session list logic here. Stuck tracking is Issue 7.

## Acceptance criteria

- [ ] When stream emits `false`, `connectivity.isWsDisconnected` becomes `true`; listeners notified.
- [ ] When stream emits `true`, the flag flips back.
- [ ] `dispose()` cancels the subscription.

## Tests to update

- `apps/desktop_flutter/test/features/agents/agents_controller_test.dart` — extend `_FakeAgentsRepository` with a `StreamController<bool>` and a `void emitConnectivity(bool)` helper. Assert transitions.
EOF

# ---------------------------------------------------------------------------
# Issue 7
# ---------------------------------------------------------------------------
read -r -d '' BODY_7 <<'EOF' || true
## Goal

Identify sessions where status is `starting`, the live output buffer is empty, and >30s have elapsed since the session was first observed — without changing the session's stored status.

**Depends on:** Issue 6 (connectivity getter).

## Files to touch

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`

## Requirements

- Add `final Map<String, DateTime> _sessionFirstSeenAt = {};`.
- Add `Timer? _stuckCheckTimer;`.
- Populate `_sessionFirstSeenAt[id] = DateTime.now()`:
  - On `createSession()` success.
  - On `_onWsMessage → SessionCreatedMessage`: `??= DateTime.now()`.
  - On `_onWsMessage → SessionsListMessage`: for each newly observed `starting` session, `??= DateTime.now()`.
- Remove from `_sessionFirstSeenAt`:
  - On `_onWsMessage → SessionClosedMessage`.
  - On `_onWsMessage → OutputMessage` if the session is in `starting`.
- In `initialize()`: start `_stuckCheckTimer = Timer.periodic(const Duration(seconds: 5), (_) => _recomputeStuck())`.
- Implement `_recomputeStuck()`:
  - Compute new `Set<String>` of session IDs where status is `starting`, `_liveOutputBuffer[id]` is empty, and `DateTime.now().difference(_sessionFirstSeenAt[id]!) > Duration(seconds: 30)`.
  - If different from `_connectivity.stuckSessionIds`, update via `copyWith` and `notifyListeners()`.
- In `dispose()`: cancel `_stuckCheckTimer`.

## Constraints

- Do NOT mutate `AgentSession.status` on the model. Stuck is view-only.
- Periodic check must be cheap (set comparison, no allocations in steady state).

## Acceptance criteria

- [ ] A starting session with no output for >30s appears in `connectivity.stuckSessionIds`.
- [ ] When output arrives, the session is removed on the next tick (or immediately in the output handler).
- [ ] When the session is closed, it is removed from `_sessionFirstSeenAt` and from `stuckSessionIds`.

## Tests to update

- `agents_controller_test.dart` — use `FakeAsync` or expose an `@visibleForTesting` setter on `_sessionFirstSeenAt`. Assert detection at 30s, clearance on output, clearance on close.
EOF

# ---------------------------------------------------------------------------
# Issue 8
# ---------------------------------------------------------------------------
read -r -d '' BODY_8 <<'EOF' || true
## Goal

A single button on a stuck session that does the right thing whether the local server is down or just the session is stale.

**Depends on:** Issue 6.

## Files to touch

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`

## Requirements

- Add `bool _reconnecting = false` guard.
- New method:

  ```dart
  Future<void> reconnectSession(String id) async {
    if (_reconnecting) return;
    _reconnecting = true;
    try {
      if (!_agentServerController.isReady) {
        await _agentServerController.retry();
        await load();
        return;
      }
      _repository.send({'type': 'session.subscribe', 'id': id});
      final result = await _repository.getSession(id);
      if (_selectedSessionId == id) {
        _transcript = result.messages;
        notifyListeners();
      }
    } catch (e) {
      _error = e.toString();
      notifyListeners();
    } finally {
      _reconnecting = false;
    }
  }
  ```

## Constraints

- `_reconnecting` guard prevents double-clicks from triggering two concurrent retries.
- Do not add a separate "reconnect server only" path.

## Acceptance criteria

- [ ] Calling `reconnectSession` while server is not ready calls `agentServerController.retry()` then `load()`.
- [ ] Calling `reconnectSession` while server is ready issues `session.subscribe` and refreshes the transcript.
- [ ] Concurrent calls are coalesced via `_reconnecting`.

## Tests to update

- `agents_controller_test.dart` — extend `_FakeAgentServerController` with `retryCallCount`; verify both branches.
EOF

# ---------------------------------------------------------------------------
# Issue 9
# ---------------------------------------------------------------------------
read -r -d '' BODY_9 <<'EOF' || true
## Goal

When the local agent server is down, the existing Close button quietly fails (DELETE returns connection refused) and the stale session is stuck in the UI. Fall back to removing the session from the in-memory list when the server isn't reachable.

## Files to touch

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`

## Requirements

At the top of `closeSession(String id)`:

```dart
if (!_agentServerController.isReady) {
  _sessions = _sessions.where((s) => s.id != id).toList();
  if (_selectedSessionId == id) _selectedSessionId = null;
  _liveOutputBuffer.remove(id);
  _sessionFirstSeenAt.remove(id);
  notifyListeners();
  return;
}
```

The existing online path remains unchanged.

## Constraints

- The DB row may already be `closed`; that's fine. Next successful `sessions.list` reconciles.

## Acceptance criteria

- [ ] When `agentServerController.status != ready`, `closeSession` removes the session synchronously and clears related maps.
- [ ] When `agentServerController.status == ready`, the existing DELETE path is taken unchanged.

## Tests to update

- `agents_controller_test.dart` — assert both paths.
EOF

# ---------------------------------------------------------------------------
# Issue 10
# ---------------------------------------------------------------------------
read -r -d '' BODY_10 <<'EOF' || true
## Goal

At-a-glance visibility of agent-server health from the Agents screen.

**Depends on:** Issue 3.

## Files to touch

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`

## Requirements

- Define a new private `_AgentServerStatusDot` `StatelessWidget` at the bottom of the file.
  - Reads `context.watch<AgentServerController>().status`.
  - Renders an 8×8 circle: `rhythm.success` (ready), `rhythm.warning` (starting), `rhythm.danger` (failed).
  - Wraps in `Tooltip` with the status text.
- In `_SessionListHeader.build`, append the dot to the Row containing the "Manage agents" `TextButton.icon` (around line 460), separated by `SizedBox(width: 8)`.

## Constraints

- Keep the widget private; do not extract to a separate file (matches existing `_StatusDot` convention).

## Acceptance criteria

- [ ] Dot appears next to "Manage agents".
- [ ] Color reflects status via the rhythm theme tokens.
- [ ] Tooltip present on hover.

## Tests to update

- None (pure widget rendering — covered by manual smoke test).
EOF

# ---------------------------------------------------------------------------
# Issue 11
# ---------------------------------------------------------------------------
read -r -d '' BODY_11 <<'EOF' || true
## Goal

When `AgentServerController.status != ready` or `controller.connectivity.isWsDisconnected`, show a banner inside the Agents view with a "Restart agent server" button.

**Depends on:** Issue 3, Issue 6.

## Files to touch

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`

## Requirements

- New private `_DisconnectedBanner` `StatelessWidget` at the bottom of the file.
  - Reads `AgentServerController` and `AgentsController` via `context.watch`.
  - Returns `const SizedBox.shrink()` when `status == ready && !connectivity.isWsDisconnected`.
  - Otherwise: a `Container` with `rhythm.danger`-tinted background, horizontal padding, 1px border, an icon + message + `TextButton('Restart agent server', onPressed: () => context.read<AgentServerController>().retry())`.
  - Message: if `status != ready`, use `agentServerController.errorMessage` (or "Agent server unavailable" if null). If only `isWsDisconnected`, use "Connection lost — reconnecting…".
- Insert `const _DisconnectedBanner()` inside `_SessionListPanel`, after the existing `Divider` and before the `Expanded` session list.

## Constraints

- Banner consumes vertical space only when visible.
- Does not block list interactions when shown.

## Acceptance criteria

- [ ] Banner appears when status is `starting`, `failed`, or when WS is disconnected for >10s.
- [ ] "Restart agent server" calls `AgentServerController.retry()`.
- [ ] Banner disappears once status returns to `ready` and connectivity is restored.

## Tests to update

- None (covered by manual smoke test).
EOF

# ---------------------------------------------------------------------------
# Issue 12
# ---------------------------------------------------------------------------
read -r -d '' BODY_12 <<'EOF' || true
## Goal

Give the user a one-click way to recover from a stuck `Starting` session or a disconnected WS without manually closing the session.

**Depends on:** Issue 6, Issue 8.

## Files to touch

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (lines 878–926 — `_TranscriptHeader`)

## Requirements

- Add `final agentServerController = context.watch<AgentServerController>();` next to the existing controller read.
- Compute `final showReconnect = agentServerController.status != AgentServerStatus.ready || controller.connectivity.isWsDisconnected;`.
- Insert immediately before the existing close `IconButton`:

  ```dart
  if (showReconnect) ...[
    OutlinedButton(
      onPressed: () => context.read<AgentsController>().reconnectSession(session.id),
      style: OutlinedButton.styleFrom(
        foregroundColor: context.rhythm.accent,
        side: BorderSide(color: context.rhythm.border),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        minimumSize: Size.zero,
        tapTargetSize: MaterialTapTargetSize.shrinkWrap,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(RhythmRadius.md)),
      ),
      child: const Text('Reconnect', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
    ),
    const SizedBox(width: 6),
  ],
  ```
- Update the close `IconButton`'s `tooltip` to "Force close" when `!agentServerController.isReady`, else "Close session".

## Constraints

- Reconnect button only renders when needed.
- Close button remains, falling through to the offline path from Issue 9.

## Acceptance criteria

- [ ] Reconnect appears when server is down or WS disconnected.
- [ ] Reconnect calls `AgentsController.reconnectSession(session.id)`.
- [ ] Close button tooltip changes contextually.

## Tests to update

- None (covered by smoke test).
EOF

# ---------------------------------------------------------------------------
# Issue 13
# ---------------------------------------------------------------------------
read -r -d '' BODY_13 <<'EOF' || true
## Goal

Surface the stuck-Starting computed state inline in the session row.

**Depends on:** Issue 7.

## Files to touch

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`

## Requirements

- Extend `_SessionRow` with `required this.isStuck` (bool) constructor parameter.
- In `_SessionListPanel`, pass `isStuck: controller.connectivity.isStuck(session.id)`. Mirrors the existing `isWorking` parameter pattern; keeps `_SessionRow` a `StatelessWidget`.
- In `_SessionRow.build`, after the `lastPreview` text:

  ```dart
  if (isStuck)
    Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text(
        'No output yet — the agent may be stuck',
        style: TextStyle(fontSize: 10, color: context.rhythm.warning, fontStyle: FontStyle.italic),
      ),
    ),
  ```

## Constraints

- Do not convert `_SessionRow` to a `StatefulWidget`.
- Do not change session status; view-layer only.

## Acceptance criteria

- [ ] Hint appears on rows where `connectivity.isStuck(id)` is true.
- [ ] Hint disappears when output arrives or session is closed.

## Tests to update

- None (logic is covered by Issue 7's controller tests).
EOF

# ---------------------------------------------------------------------------
# Issue 14
# ---------------------------------------------------------------------------
read -r -d '' BODY_14 <<'EOF' || true
## Goal

Replace the hardcoded `claude-code` / `codex` branches with a loop over enabled agent configs, showing disabled "(not installed)" buttons for configs whose CLI isn't on the system.

## Files to touch

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`
  - `_showNewSessionDialog` wrapper (~line 344) — add `AgentConfigsController` provider.
  - `_NewSessionDialog` build (lines 1480–1580) — replace branches.
  - `_AgentToggleButton` (lines 1721–1757) — add `enabled` and `disabledLabel` params.
  - Add `_colorForAgent(String id)` helper.

## Requirements

1. **Provider wiring.** In `_showNewSessionDialog`, add `ChangeNotifierProvider.value(value: context.read<AgentConfigsController>(), child: ...)`.
2. **Loop replacement** in `_NewSessionDialog.build`:

   ```dart
   final agentConfigs = context.watch<AgentConfigsController>();
   final agentServerController = context.watch<AgentServerController>();
   final enabledAgents = agentConfigs.enabledAgents;

   if (enabledAgents.isNotEmpty) ...[
     Text('Agent', /* existing style */),
     const SizedBox(height: 6),
     Container(
       decoration: /* existing decoration */,
       child: Row(
         children: [
           for (final config in enabledAgents)
             Expanded(
               child: _AgentToggleButton(
                 label: config.label,
                 selected: _agentId == config.id,
                 color: _colorForAgent(config.id),
                 enabled: agentServerController.isAgentAvailable(config.id),
                 disabledLabel: '(not installed)',
                 onTap: agentServerController.isAgentAvailable(config.id)
                     ? () => setState(() => _agentId = config.id)
                     : null,
               ),
             ),
         ],
       ),
     ),
     const SizedBox(height: 14),
   ],
   ```

3. **Default agent.** Replace the existing `_agentId = 'claude-code'` initializer with a computed default in `initState` (or first build): first `enabledAgents` entry where `isAgentAvailable(id) == true`. Fall back to `enabledAgents.first.id` (button will render disabled) if none installed.
4. **`_AgentToggleButton` signature.** Add `final bool enabled` (default `true`) and `final String? disabledLabel`. When `!enabled`, wrap in `IgnorePointer` (or set `onTap: null`), render label muted, append `disabledLabel` as a smaller muted line.
5. **`_colorForAgent` helper.**

   ```dart
   Color _colorForAgent(String id) => switch (id) {
     'claude-code' => const Color(0xFF6B46C1),
     'codex' => const Color(0xFF059669),
     _ => context.rhythm.accent,
   };
   ```

## Constraints

- All entry paths to the dialog must work (the provider lives in the shared wrapper).
- Keep claude-code / codex colors via the helper.

## Acceptance criteria

- [ ] Dialog renders one toggle per enabled config.
- [ ] Configs whose CLI is not installed render disabled with "(not installed)".
- [ ] Default selection is the first installed enabled config; falls back to first enabled if none installed.
- [ ] Selecting a toggle persists into the create-session payload.
- [ ] No regression when both claude-code and codex are installed.

## Tests to update

- None required for UI. Update any existing widget test that asserts hardcoded toggles.
EOF

echo "Creating issues..."
I1=$(mk_issue "Add HealthPoller utility class" "$BODY_1" "$M1_TITLE")
echo "  Issue 1: $I1"
I2=$(mk_issue "Add lostConnection failure reason for agent server" "$BODY_2" "$M1_TITLE")
echo "  Issue 2: $I2"
I3=$(mk_issue "Poll agent server /health every 15s and transition to failed on loss" "$BODY_3" "$M1_TITLE")
echo "  Issue 3: $I3"
I4=$(mk_issue "Emit WS connectivity stream from AgentsDataSource" "$BODY_4" "$M1_TITLE")
echo "  Issue 4: $I4"
I5=$(mk_issue "Add AgentSessionConnectivity value type" "$BODY_5" "$M2_TITLE")
echo "  Issue 5: $I5"
I6=$(mk_issue "Subscribe to WS connectivity stream in AgentsController" "$BODY_6" "$M2_TITLE")
echo "  Issue 6: $I6"
I7=$(mk_issue "Detect sessions stuck in starting state for >30s with no output" "$BODY_7" "$M2_TITLE")
echo "  Issue 7: $I7"
I8=$(mk_issue "Implement single-button reconnect with server-status branching" "$BODY_8" "$M2_TITLE")
echo "  Issue 8: $I8"
I9=$(mk_issue "Force-close stale sessions client-side when server is unreachable" "$BODY_9" "$M2_TITLE")
echo "  Issue 9: $I9"
I10=$(mk_issue "Show agent server health dot next to Manage agents" "$BODY_10" "$M3_TITLE")
echo "  Issue 10: $I10"
I11=$(mk_issue "Show inline banner with Restart button when agent server is down" "$BODY_11" "$M3_TITLE")
echo "  Issue 11: $I11"
I12=$(mk_issue "Add Reconnect button to transcript header for stuck sessions" "$BODY_12" "$M3_TITLE")
echo "  Issue 12: $I12"
I13=$(mk_issue "Show 'No output yet' hint on stuck sessions" "$BODY_13" "$M3_TITLE")
echo "  Issue 13: $I13"
I14=$(mk_issue "Render New Session agent toggles from AgentConfigsController.enabledAgents" "$BODY_14" "$M3_TITLE")
echo "  Issue 14: $I14"

echo
echo "Done. Created 3 milestones and 14 issues."
echo "Next: review issue numbers above, then run /issue-pipeline in order 1..14."
