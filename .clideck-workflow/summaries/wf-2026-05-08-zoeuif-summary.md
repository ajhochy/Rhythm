# Issue 464 — Inline error feedback in agent trigger bubble

## Description

Surfaces inline error feedback in the agent trigger bubble when `AgentsController.createSession()` returns null. Converts `_ExpandedTriggerBubble` from a `StatelessWidget` to a `StatefulWidget`, holds a local `_errorMessage`, and renders it inline below the action buttons using `context.rhythm.danger`. Scope is strictly limited to error feedback — no loading state, no spinner, no SnackBar.

**File touched:** `apps/desktop_flutter/lib/app/core/agents/agent_bubble_overlay.dart`

## Issues completed

- #469 — Convert `_ExpandedTriggerBubble` to a `StatefulWidget` with local `_errorMessage` state
- #470 — Render the inline error message below the action buttons and adjust bubble height (`220` → `260` when error is shown)
- #471 — Verified `dart format .` (0 changes) and `flutter analyze --no-fatal-infos` clean on the modified file; CI `desktop-checks` passes green
- #472 — Implementation complete; manual smoke test deferred to human (see Manual setup below)

## Manual setup needed

Before merging, please run the manual smoke test:

1. `cd apps/desktop_flutter`
2. Stop the local agent server (kill the process listening on `:4001`) so `createSession` will fail.
3. `flutter run -d macos`
4. Open a trigger bubble on a task that has a `claude-trigger`.
5. Click **Start with Claude** — confirm inline red error text appears under the buttons and the bubble does not dismiss.
6. Click **Start with Codex** — confirm same inline error behavior.
7. Click a Start button again — confirm the prior error clears before the retry.
8. Restart the local agent server on `:4001` and click a Start button — confirm the success path still dismisses the bubble and navigates to Agents.
