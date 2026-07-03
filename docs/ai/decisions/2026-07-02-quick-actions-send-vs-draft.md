---
date: 2026-07-02
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Quick Actions send the preset prompt immediately instead of staging a draft

## Context

Issue #863 requires one-tap agent actions where "the user types no prompt,
picks no model" — the action must run to completion without further user
input. The existing precedent in this codebase for "launch an agent with
pre-loaded context" is `agent_email_view.dart` and
`agent_gallery_view.dart`: both call
`AgentsController.createSession(mcpRole: ...)`, then `selectSession`, then
`setComposerDraft(sessionId, text)` — which stages text into the composer
input but requires the user to review and press Enter to actually send it.
That pattern was itself a deliberate design decision from issue #653 ("no
server-seeded system message, no auto-prompt" — see the doc comment on
`AgentsController.setComposerDraft`).

Investigation (source read + a dispatched background research agent)
confirmed:
- `AgentsController.sendInput(sessionId, text)` is the actual WS-send path
  used when the user presses Enter. It takes an explicit `sessionId` and
  does not require the session to be "selected" — it can be called
  directly after `createSession()` resolves.
- `AgentsDataSource.send()` silently no-ops (drops the message, no
  exception, no error) if the WebSocket channel is `null` — there is no
  built-in delivery confirmation.
- No existing call site in the codebase has ever called `sendInput`
  programmatically outside of direct user keystroke handling; every
  "create + stage" precedent (email assistant, graphic designer, the
  `PendingTrigger` flow) deliberately stops at the draft stage.

## Decision

Quick Actions calls `createSession` → `await selectSession(id)` →
`sendInput(id, presetPrompt)` — a true auto-send, not a draft — because
#863's acceptance criteria are explicit that no typing may be required.
Before sending, the widget checks
`agentsController.connectivity.isWsDisconnected` (already publicly
exposed) and shows a SnackBar failure if the connection is down, since
`sendInput`'s silent-drop behavor on a closed socket would otherwise
violate the "failure is visible" acceptance criterion.

## Alternatives considered

1. **Keep the draft-and-let-user-send pattern** (matching #653's existing
   design intent). Rejected: violates #863's explicit "user types no
   prompt" requirement — a draft still needs an Enter keypress.
2. **Add a new "send now" helper method to `AgentsController`** wrapping
   `sendInput` with a connectivity check baked in. Considered but not
   done — the connectivity check is only 2 lines and needed in exactly one
   new call site; adding a new public controller method for a single
   caller was judged unnecessary surface area for a "smallest correct
   change" issue.
3. **Poll/await some delivery-confirmation signal after `sendInput`**
   (e.g. wait for the first assistant response chunk). Rejected as
   over-engineering: there is no existing "message delivered" signal in
   the protocol, and building one is out of scope for this issue.

## Consequences

- Quick Actions is the first caller in this codebase to auto-send a
  message immediately after session creation, without user review. This
  is intentional per #863, but is a UX pattern divergence from the
  email/gallery launchers — a future reviewer auditing "why does this
  flow skip the draft stage" should read this doc.
- The `isWsDisconnected` guard reduces but does not eliminate the
  silent-drop risk (a disconnect between the check and the `send()` call
  is still possible, race-condition-style). This residual risk is
  documented in `docs/ai/runs/2026-07-02-issue-863-quick-actions.md` as a
  known limitation, not fixed here, since it is a pre-existing
  architectural property of `AgentsDataSource.send` shared by every
  caller, not something introduced by this change.
