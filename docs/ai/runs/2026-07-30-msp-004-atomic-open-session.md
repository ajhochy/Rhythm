---
date: 2026-07-30
repo: Rhythm
branch: codex/msp-004-atomic-open-session
pr: null
issues: [MSP-004]
status: implemented
tags: [run, Rhythm, mobile]
---

# MSP-004 atomic mobile session opening

## Files

- `apps/mobile/providers/open-project-session.ts` — 15-second,
  generation-guarded atomic opening controller and terminal-state copy.
- `apps/mobile/providers/opencode-provider.tsx` — scoped loading and one-shot
  commit through the MSP-001 session hydration seams.
- `apps/mobile/providers/opencode-provider-types.ts` — opening API/state
  context contract.
- `apps/mobile/app/agents/chats/[sessionId].tsx` — single route effect plus
  distinct Retry/Back terminal UI.
- `apps/mobile/tests/contract/msp-004-atomic-open-session.test.mjs` — fake
  transport coverage.
- `docs/ai/contracts/msp-004-atomic-open-session.json` — acceptance contract.

## Checks

- RED/base: `node --test ./tests/contract/msp-004-atomic-open-session.test.mjs`
  from `apps/mobile` — 0 passed, 10 failed.
- GREEN/fixed: same command — 10 passed, 0 failed.
- `./node_modules/.bin/tsc --noEmit` from `apps/mobile` — passed.
- `npm run lint` from `apps/mobile` — passed.
- No server, sandbox, production database, or ports were used.

## Decisions

- The loading deadline is 15 seconds. It is long enough for a paired mobile
  gateway cold read but bounded so every open reaches a recoverable state.
- The previous coherent project/session remains observable while opening.
  Project, session list, transcript, todos, diffs, pending interactions, and
  MSP-001 preferences commit together only after the target is verified.
- Retrying starts a new generation against the existing session. It does not
  call session creation; project event subscription changes only after the
  successful commit.

## Manual native parity checks

These require a physical iPhone/native Expo lifecycle and were not run here:

1. From a fully terminated app, open a cross-project chat deep link and verify
   only the requested chat appears.
2. Rapidly open chats from two projects; verify the last tap wins after both
   gateways have had time to respond.
3. Background and resume during opening, then after opening; verify no fallback
   chat appears and no duplicate transcript/event updates occur.
4. Make the paired Mac unreachable during opening. Verify the offline screen
   shows both Retry and Back to chats; reconnect and Retry the same session.
5. Exercise deleted-session and stale-project links. Verify their titles/copy
   differ and both recovery buttons remain available.
6. Hold a test transport request beyond 15 seconds and verify the timeout
   screen appears; then verify Back returns to the Chats list.
7. With VoiceOver enabled, verify focus announces each terminal title/message
   and both recovery buttons.
