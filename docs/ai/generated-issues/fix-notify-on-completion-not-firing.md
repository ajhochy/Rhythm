# fix(#606): per-message action row — notify-on-completion + relative-timestamp ticker both broken

## Composer 6 smoke summary (vbeta.18.36)

- ✅ Copy: works.
- ❌ Notify-on-completion: toggle exists, never fires a macOS notification.
- ❌ Relative timestamp ticker: timestamps don't tick (don't visibly update from "just now" → "30s ago" etc. without a manual refresh).

Both failed deliverables share commit ancestry in `acdc835`. The action row widget is rendered correctly (copy proves it), so the wiring layer is the suspect for both.

---

# Notify-on-completion

## Problem

PR #617's #606 claim:
> "Per-message action row under each chat bubble: copy, notify-on-completion toggle (wired to LocalNotificationService), and a relative timestamp that auto-updates via a single ticker."

The toggle exists. Tapping it changes state. But when the next agent turn completes (after streaming finishes), **no macOS notification is delivered**. Other notification paths in Rhythm work — e.g. the rhythm-mcp-server can fire desktop notifications from an agent message — so the `UNUserNotification` authorization is in place. The bug is specifically in the per-turn completion handler.

## Reproduction (vbeta.18.36)

1. Open any agent session.
2. Send a turn that will take >5s to stream out (e.g. ask Sonnet to write a multi-paragraph response).
3. While the response is streaming, **toggle notify-on-completion ON** on that user-message bubble (or the assistant bubble — confirm which is the canonical anchor).
4. Click away to another app or just look away.
5. **Expected**: when the agent finishes the turn, macOS shows a notification.
6. **Actual**: no notification. The transcript completes normally; no system banner / sound / lock-screen badge.

## What we know works

- `LocalNotificationService` exists (referenced in the #606 commit).
- Rhythm has notification authorization granted by the user (verified by the `[org.visaliacrc.rhythm] Requested authorization didGrant: 0 hasError: 1` log earlier in this session — actually, that says didGrant: 0 which usually means denied; need to confirm).
- The rhythm-mcp-server path can fire notifications, so the Rhythm side has *some* working notification mechanism.

## Likely cause

Top candidates without reading code yet:
1. **Notification authorization was denied** at the system level — the toggle wires up correctly but `requestAuthorization` returned 0. Need to check System Settings > Notifications > Rhythm, and add a clearer UX if authorization is missing (banner: "Enable notifications in System Settings to use this feature").
2. The completion-detection logic doesn't fire for streamed turns — maybe waits for a `session.idle` event that isn't being emitted, or listens for the wrong message-id mapping.
3. The toggle state is per-bubble but the firing logic doesn't lookup which bubble had the toggle on when the turn completed (state-to-event mismatch).
4. The toggle is bound to local UI state only and never reaches the controller / service.

## Scope

`apps/desktop_flutter/lib/features/agents/` — the action row widget for #606, the LocalNotificationService binding, the WS handler that processes turn completion.

## Acceptance criteria

- [ ] Toggle notify ON, send turn, agent finishes — system notification appears with title/body summarizing the agent + a snippet of the response.
- [ ] Toggle defaults to off; per-bubble state.
- [ ] Clicking the notification brings Rhythm into focus on the relevant session.
- [ ] If macOS authorization is missing, show inline guidance instead of silently failing.
- [ ] No double-fire if multiple bubbles have notify on for the same turn.

## Severity

Medium — feature claimed but inert. Doesn't block other functionality.

## Related

The `Requested authorization [didGrant: 0 hasError: 1]` log line earlier in this session strongly suggests Rhythm's notification authorization is denied at the system level. Step 1 of the fix is probably "check / re-request authorization on first use" rather than any code path.

---

# Relative-timestamp ticker

Per #606, a single periodic ticker should drive all relative-timestamp displays in the action row ("just now", "30s ago", "1m ago", "2h ago", etc.). After sending a turn, waiting 30+ seconds, the timestamps under the bubbles do not update — they stay at their initial render value.

## Likely cause

- Ticker stream not subscribed (or unsubscribed too early on widget rebuild).
- Each action-row widget reading from a static value rather than the ticker stream.
- Ticker firing but the relative-format helper isn't being recomputed (cached calc, not a fresh `DateTime.now()` diff).

## Scope

Same widget as the notify toggle. Verify:
- A single `Timer.periodic` (or `Stream.periodic`) is created once at the chat view / controller level.
- It calls `notifyListeners()` (or pushes to a ValueNotifier) per minute.
- Each action-row widget consumes that and recomputes its timestamp on rebuild.

## Acceptance criteria

- [ ] Send a turn, wait 30s — relative timestamp updates without manual interaction.
- [ ] All visible bubbles update on the same tick (single ticker, not one per row).
- [ ] Ticker disposes when the view is destroyed (no leaks).
