# fix(agents): Archived section doesn't update live when row is archived — requires manual list refresh

## Problem

PR #617's #601/#605 claim:
> "session.updated / session.removed WS events emitted from every status / archive / PATCH / hard-delete touchpoint; Flutter dedupes and routes rows into sessions/resumable/**archived** live."

In reality, only the **active list removal** is live. The **archived list insertion** is not. After archiving a session via the three-dot menu → Archive:
- The row vanishes from the active section immediately (✅ live)
- The Archived section stays empty (❌ not updated)
- The row only appears in Archived after some other action triggers a list re-fetch (e.g., creating a new session)

## Reproduction (vbeta.18.36)

1. Have at least one active session.
2. Three-dot menu → Archive.
3. Row disappears from active list (correct).
4. Expand Archived section → empty (incorrect — should show the just-archived row).
5. Create a new session (or do anything that triggers `loadSessions`) → Archived section now shows the row.

## Diagnosis

The server-side `session.updated` WS event likely carries the new `archived: true` (or `archivedAt: <ts>`) state correctly — otherwise the active list wouldn't update. The Flutter `agents_controller.dart` WS handler is updating the active-list state (removing the row) but **not inserting into `_archivedSessions`** (or whatever the local list cache is named). Likely a one-line oversight in the handler — when an existing session's `archivedAt` flips from null to non-null, add it to the archived list cache.

## Scope

`apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — find the `session.updated` WS event handler that already removes from active list when archived, extend it to also push into the archived list state and `notifyListeners()`.

## Acceptance criteria

- [ ] After three-dot menu → Archive: row appears in Archived section within ~1s, without any list refresh / page navigation / new-session creation.
- [ ] Unarchive round-trip also live (moves back to active list immediately).
- [ ] No duplicate rows after the live update.
- [ ] Existing Sessions 1 / Sessions 2 smoke items still pass.

## Severity

Low — functional flow is correct, behavior is "delayed live" not "broken." Not a #617 merge blocker.
