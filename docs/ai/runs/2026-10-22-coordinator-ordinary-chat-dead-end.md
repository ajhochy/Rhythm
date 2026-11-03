---
date: 2026-10-22
repo: Rhythm
branch: fix/coordinator-ordinary-chat-dead-end
pr: null
issues: []
status: draft-pr
tags: [run, rhythm, coordinator, composer]
index: "[[Rhythm]]"
---

# Reply stuck in coordinator mode on an ordinary chat

**Report**: "there is a session in rhythm that I can't respond to" ("WebApp on Tailscale").
Typing and sending did nothing; no error appeared.

**Cause**: a coordinator conversation had been opened on an ordinary (non-primary) chat, so the
composer sent through `/coordinator-conversations/message`. The server refuses ordinary chat there
with `model_integration_unavailable` (503), before writing anything. The client kept the message as
an uncertain pending command (journaled in localStorage, so it survived restarts) and refused every
different message until that one was retried. A retry always got the same refusal. The only notice
was in Details → Runs.

Evidence: zero rows in `coordinator_conversation_commands` for the session; the localStorage journal
held `pendingCommand` with `pendingState: "retry"`.

**Workaround** (old builds): Details → Runs → *Return to normal chat*, then resend.

## Files
- `apps/web/src/components/use-coordinator-conversation.ts`: `model_integration_unavailable` is
  treated as definite non-delivery: the pending command is released with a `refused` retirement, the
  view returns to normal chat, and `send` returns a reason. The hook's `send` repeats the current
  coordinator notice as the reason for any other refusal. `submitCoordinatorComposerInput` passes the
  reason through to the composer (shown in `attachment-feedback`).
- `apps/web/src/gateway/coordinator-conversation-journal.ts`: retirement kind `refused`.
- `apps/web/tests/rhythm-primary-entry.spec.ts`: scope-aware coordinator fixture + regression test.

## Checks
- New Playwright test: red on mega (no notice); red on reload before the `refused` retirement
  (journal save refused to drop the pending command); green after. Full spec 12/12.
- `tsc -b` exit 0; `vite build` exit 0.
- Unit `tests/coordinator-*.test.mjs tests/rhythm-primary-entry.test.mjs`: 57/58 on fix and on
  unmodified mega (#54 pre-existing). Needs `react-test-renderer`, which `apps/web` does not declare.
  It was installed in a scratch dir aliased to the app's React.
- conversation/core-flow/parity-edge-cases specs: the same 5 failures on base and fix (pre-existing).
- Not run: packaged Electron smoke and a live-backend run (Rhythm in daily use). The server is
  unchanged. All four `model_integration_unavailable` return sites are before any repository write.

## Notes
- `apps/mobile` has its own coordinator controller/journal; not checked for the same dead-end.
- A journal stuck by an older build self-heals: retrying that same message now releases it.
