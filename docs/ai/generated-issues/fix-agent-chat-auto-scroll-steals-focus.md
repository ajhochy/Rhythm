# fix(agents): chat view auto-scrolls to bottom even when user has scrolled up to read history

## Problem

In the agent chat view, while a session is streaming or even after it completes, scrolling UP to read earlier messages is immediately undone — the view auto-jumps back to the most recent message after a brief delay. Reading history becomes impossible without pausing the agent or detaching from the session.

This was not present in earlier shipped builds; it appeared after PR #617's composer / action-row / ticker work.

## Reproduction (vbeta.18.36)

1. Open a session with a long transcript (5+ messages, ideally several screenfuls).
2. Send a prompt; agent starts streaming a long response.
3. Scroll up to read an earlier message.
4. Within ~1–2s the view scrolls itself back to the bottom, overriding the user's manual scroll position.

Also happens **after** the response completes (i.e. it's not just a streaming behavior).

## Likely cause

Most likely a `ScrollController.jumpTo()` / `animateTo()` call that fires on every:
- WS event (`output`, `output.flush`, `message.updated`, `message.part.updated`, etc.)
- Per-message action-row ticker tick (#606 added a single periodic ticker for relative timestamps — if a build is triggered on every tick, scroll-to-bottom may run)
- Setstate after notifyListeners() in `AgentsController`

The fix is the standard "auto-scroll if user is already near the bottom, otherwise leave alone" pattern: track whether the user's scroll position is within ~50–100 px of the bottom edge before issuing the auto-scroll. If they're further up, they've intentionally scrolled to read — skip the call.

## Scope

`apps/desktop_flutter/lib/features/agents/views/` — wherever the chat transcript ListView/ScrollView lives. Probably a controller method like `_scrollToBottom()` that needs a bottom-pinned check.

## Acceptance criteria

- [ ] User can scroll up freely while a turn is streaming; auto-scroll does not interrupt.
- [ ] When user is already pinned at the bottom (within ~100 px), new messages still auto-scroll into view as before.
- [ ] No regression in: new-turn auto-scroll on send, jump-to-bottom button (if one exists), tool-call cards expanding.
- [ ] Works for both incoming agent messages and outgoing user messages.

## Severity

Medium — meaningfully degrades the chat UX for any session longer than one screen. Doesn't lose data, but makes the app feel hostile to read.
