# Smoketest — Issue #464: Agent trigger bubble error feedback

Project: Rhythm (Flutter desktop app at `/Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter/`)
Scope: Verify that agent start buttons in the trigger bubble surface inline error feedback when session creation fails, while preserving the success path. Strictly UI/error feedback — no loading states, no SnackBar.

## Pre-flight required: export RHYTHM_LOCAL_SMOKE=1

**Always run the following before `flutter run` smoke sessions** to prevent
accidental DELETE requests against the production `claude-triggers` endpoint:

```bash
export RHYTHM_LOCAL_SMOKE=1
```

Or pass it as a dart-define:
```bash
flutter run -d macos --dart-define=RHYTHM_LOCAL_SMOKE=1
```

When set, `AgentTriggerWatcher` is silenced and logs
`[AgentTriggerWatcher] RHYTHM_LOCAL_SMOKE=1 detected — watcher is disabled for this run.`

---

## manualSetup — Seed a synthetic pending trigger (issue #477)

The inline-error checks in Step 2 require an open trigger bubble. Computer
Use is unreliable (Apple event error `-1743`) and we will not touch
production triggers. Instead, use the **debug-only seed entry point** added
in issue #477 to inject a synthetic `PendingTrigger` directly into the local
`AgentsController` store at app startup.

This entry point is gated by `kDebugMode` (release builds ignore it) and
must be paired with `RHYTHM_LOCAL_SMOKE=1` so the watcher does not
reconcile the seeded trigger away.

### One-liner

```bash
cd apps/desktop_flutter
flutter run -d macos \
  --dart-define=RHYTHM_LOCAL_SMOKE=1 \
  --dart-define=RHYTHM_LOCAL_SEED_TRIGGER=1 \
  --dart-define=RHYTHM_LOCAL_SEED_TASK_ID=debug-seed-task \
  --dart-define=RHYTHM_LOCAL_SEED_TASK_TITLE="Debug seeded trigger"
```

### What to expect

- About 500 ms after launch, a trigger bubble titled **"Debug seeded
  trigger"** appears in the agent overlay (expanded by default).
- The Flutter run console logs:
  `[main] RHYTHM_LOCAL_SEED_TRIGGER=1 — seeded synthetic pending trigger taskId=debug-seed-task title="Debug seeded trigger".`
- No `DELETE /claude-triggers/*` requests are issued (watcher is silent due
  to `RHYTHM_LOCAL_SMOKE=1`).

### Driving the inline-error path

1. Kill the local agent server so `createSession` will fail:
   `lsof -nP -iTCP:4001 -sTCP:LISTEN | awk 'NR>1{print $2}' | xargs -r kill -9`
2. Click **Start with Claude** in the seeded bubble.
3. Verify the inline red error renders below the action buttons (per Step 2
   of this smoketest). The bubble must not dismiss.
4. Click **Start with Codex** and verify the same path.
5. Click again to confirm the error clears briefly before re-rendering on
   retry.

### Notes

- Only `RHYTHM_LOCAL_SEED_TRIGGER=1` is required to enable seeding; the
  task id/title fall back to `debug-seed-task` / `Debug seeded trigger`.
- Source of truth: `apps/desktop_flutter/lib/main.dart`
  (`_maybeSeedDebugTrigger`) and
  `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
  (`seedTriggerForDebug`).

---

## Pre-flight

- [x] ❌ **Tooling clean**
  - Action: `cd /Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter && dart format --set-exit-if-changed . && flutter analyze --no-fatal-infos`
  - Expected: both commands exit 0; no diff from `dart format`; analyzer reports no issues.
  - Verify in: terminal output.
  - Evidence: `evidence/smoketest/01_dart_format_preflight.log` shows `Formatted 152 files (0 changed)`. `evidence/smoketest/02_flutter_analyze_preflight.log` exits 0 under `--no-fatal-infos` but reports `147 issues found`, so the "no issues" expectation is not met.

- [x] ❌ **App launches**
  - Action: `cd /Users/ajhochhalter/Documents/Rhythm/apps/desktop_flutter && flutter run -d macos`
  - Expected: app reaches the main shell without errors. The local agent server (`http://localhost:4001`) starts as usual.
  - Verify in: macOS app window + Flutter run logs (no red error overlay).
  - Evidence: `evidence/smoketest/03_flutter_run.log` shows the app built and attached, and reused the existing local server on `:4001`. Screenshot `evidence/smoketest/07_app_launch_screen.png` shows only the Rhythm menu bar over the desktop background; the main shell was not visible. Flutter logged `Failed to foreground app; open returned 1` and later a render overflow in `agents_view.dart:1523`.

## Step 1 — _ExpandedTriggerBubble is now Stateful and tracks `_errorMessage`

- [x] ✅ **Source-level check**
  - Action: open `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart`.
  - Expected: `_ExpandedTriggerBubble` extends `StatefulWidget`; a `_ExpandedTriggerBubbleState` class exists with a `String? _errorMessage` field; `startAgent()` lives on the State and clears `_errorMessage` before awaiting `agents.createSession(...)`.
  - Verify in: file contents.
  - Evidence: `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart:362-388` has `_ExpandedTriggerBubble extends StatefulWidget`, `_ExpandedTriggerBubbleState`, `String? _errorMessage`, and `setState(() => _errorMessage = null)` before `await agents.createSession(...)`.

- [x] ✅ **`mounted` guard present**
  - Action: read the post-await branches in `startAgent`.
  - Expected: an `if (!mounted) return;` precedes any `setState` that runs after `await agents.createSession(...)`.
  - Verify in: file contents.
  - Evidence: `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart:386-388` guards the post-await error `setState` with `if (!mounted) return;`.

## Step 2 — Inline error renders below action buttons; bubble height adapts

- [x] ❌ **Trigger a real failure path (server down)**
  - Action: while the desktop app is running, kill the local agent server (`lsof -nP -iTCP:4001 -sTCP:LISTEN | awk 'NR>1{print $2}' | xargs -r kill -9`). Then open a trigger bubble for any task with a pending `claude-trigger`. Click **Start with Claude**.
  - Expected:
    - Inline red error text appears below the two action buttons, above the "Dismiss" link.
    - Text color matches `context.rhythm.danger` (light theme: a red ~`#DC5B58` / dark theme: ~`#FF7A73`).
    - Text wraps to at most 2 lines and ellipsizes if longer.
    - Bubble grows from 220 → 260 in height; outer width remains 360; nothing in surrounding overlays clips.
    - Bubble is **not** dismissed; the user remains on the same view.
  - Verify in: macOS app window + Flutter run logs (no rendering exceptions, no overflow warnings).
  - Evidence: Not executed via UI. Computer Use returned Apple event error `-1743`, and remote `claude-triggers` production delivery was intentionally avoided per user clarification. Local CLI server evidence is in `evidence/smoketest/04_agent_health_initial.log` and `evidence/smoketest/10_agent_capabilities.log`; source-level error rendering is present at `agent_bubble_overlay.dart:487-498`.

- [x] ❌ **Same path with the second button**
  - Action: with the agent server still down, click **Start with Codex** in the same bubble.
  - Expected: error text updates (or stays) accordingly; bubble still does not dismiss.
  - Verify in: macOS app window.
  - Evidence: Not executed via UI for the same blockers as above. Source shows the Codex button calls `startAgent(AgentKind.codex)` at `agent_bubble_overlay.dart:479-482`.

- [x] ❌ **Error clears on retry**
  - Action: while the error text is displayed, click either Start button again (still with the agent server down — failure persists).
  - Expected: in the moment before `await` resolves, the error text disappears (cleared by `setState(() => _errorMessage = null)`); when the failure returns, the error text re-renders. Visually this manifests as a brief flicker / re-population of the error line.
  - Verify in: macOS app window.
  - Evidence: Not visually verified. Source confirms the retry-clearing implementation at `agent_bubble_overlay.dart:372-376`.

- [x] ✅ **No SnackBar appears**
  - Action: observe the bottom of the application window during the failure.
  - Expected: no Material SnackBar/toast slides in. Error UX is strictly inline within the bubble.
  - Verify in: macOS app window.
  - Evidence: `evidence/smoketest/19_no_new_spinner_snackbar_diff.log` has no added `ScaffoldMessenger` or `SnackBar` lines; the error block is inline at `agent_bubble_overlay.dart:487-498`.

## Step 2b — Success path is unchanged

- [x] ❌ **Restore agent server and confirm success flow**
  - Action: restart the desktop app (or restart the local agent server by relaunching). Confirm `GET http://localhost:4001/health` returns 200. Open a trigger bubble and click **Start with Claude**.
  - Expected:
    - Bubble dismisses immediately on success.
    - App navigates to the Agents view (`AppConstants.navAgents`).
    - The newly-created session is the selected session in the Agents view.
    - Inline error text never appears on the success path.
  - Verify in: macOS app window + Flutter run logs.
  - Evidence: `evidence/smoketest/04_agent_health_initial.log` confirms local CLI server health returns 200, but direct local `POST /agent-sessions` for `claude-code` returns HTTP 500 in `evidence/smoketest/14_direct_agent_session_claude_success_retry.log`. UI success path could not be clicked.

- [x] ❌ **Codex success path**
  - Action: open another trigger bubble and click **Start with Codex**.
  - Expected: same dismissal + navigation behavior.
  - Verify in: macOS app window.
  - Evidence: Direct local `POST /agent-sessions` for `codex` returns HTTP 500 in `evidence/smoketest/09_direct_agent_session_codex_success.log`. UI success path could not be clicked.

## Step 3 — Tooling re-validation post-edit

- [x] ✅ **`dart format` is clean**
  - Action: `cd apps/desktop_flutter && dart format --set-exit-if-changed .`
  - Expected: exit 0 with no files reformatted.
  - Verify in: terminal output.
  - Evidence: `evidence/smoketest/01_dart_format_preflight.log` shows `Formatted 152 files (0 changed)`.

- [x] ❌ **`flutter analyze` is clean**
  - Action: `cd apps/desktop_flutter && flutter analyze --no-fatal-infos`
  - Expected: "No issues found!" or 0 errors/warnings.
  - Verify in: terminal output.
  - Evidence: `evidence/smoketest/02_flutter_analyze_preflight.log` exits 0 but reports `147 issues found`; they are info-level under `--no-fatal-infos`.

## Step 4 — Cross-cutting verifications (coherence rules)

- [x] ✅ **Error token used is `danger`, not `error`**
  - Action: `grep -n "context.rhythm" apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart`
  - Expected: any new line referencing the error color uses `context.rhythm.danger`. No occurrences of `context.rhythm.error` or hard-coded `Colors.red`.
  - Verify in: terminal output.
  - Evidence: `evidence/smoketest/15_context_rhythm_grep.log` shows the error text uses `context.rhythm.danger` at line 495 and no `context.rhythm.error` or `Colors.red` occurrences.

- [x] ✅ **`AgentsController` was not modified**
  - Action: `git diff -- apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
  - Expected: no changes — the existing public `String? get error` getter is sufficient.
  - Verify in: terminal output.
  - Evidence: `evidence/smoketest/16_agents_controller_diff.log` is empty.

- [x] ✅ **No new imports added**
  - Action: `git diff apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart | grep '^+import'`
  - Expected: no output (no `+import` lines). In particular, no `ScaffoldMessenger`-related imports.
  - Verify in: terminal output.
  - Evidence: `evidence/smoketest/17_new_imports.log` is empty.

- [x] ✅ **No loading/spinner UI was introduced**
  - Action: visually click the Start buttons rapidly in the success path.
  - Expected: no spinner, no disabled state, no busy indicator. Behavior is unchanged from before the fix on the success path beyond the StatefulWidget conversion.
  - Verify in: macOS app window.
  - Evidence: Visual clickthrough was blocked, but `evidence/smoketest/19_no_new_spinner_snackbar_diff.log` shows no added `CircularProgressIndicator`, disabled state, or busy indicator code in the feature diff.

- [x] ✅ **Bubble width unchanged**
  - Action: in the success path, briefly note the bubble's apparent width before it dismisses; in the failure path, observe with error showing.
  - Expected: width visually identical (360px) in both states; only height varies (220 vs 260).
  - Verify in: macOS app window.
  - Evidence: Visual clickthrough was blocked, but source shows `width: 360` unchanged at `agent_bubble_overlay.dart:397` and conditional height at `agent_bubble_overlay.dart:398`.

## Cross-app side effects

- [x] ❌ **No production API requests change shape**
  - Action: skim Flutter run logs while exercising both failure and success paths.
  - Expected: only the existing `agent-sessions` POST to `http://localhost:4001` is involved. No new requests to `https://api.vcrcapps.com`. No emails, webhooks, or external integrations are triggered by this fix.
  - Verify in: Flutter run console output.
  - Evidence: ❌ `evidence/smoketest/03_flutter_run.log` contains `[AgentTriggerWatcher] DELETE /claude-triggers/5 returned HTTP 404; trigger will be retried.` This came from the running app's existing watcher/auth state, not a manual remote-trigger action in this smoketest. The feature diff itself still only changes `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart`, and the agent start path posts through `AgentsDataSource` to `AppConstants.agentLocalBaseUrl` (`http://localhost:4001`).
