---
date: 2026-07-31
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285, 1287]
status: passed
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1285 corrective — native ready/opening loop

## Files

- `apps/mobile/app/agents/chats/[sessionId].tsx`
- `apps/mobile/tests/chat/agent-chat-detail.test.tsx`
- `docs/ai/contracts/issue-1285.json`
- `.agent-stack/postmortems/2026-07-31-issue-1285-native-ready-loop.json`
- `.agent-stack/failure-patterns.md`

## Checks

- Physical-iPhone smoke on pushed commit `6a8a2beb85c1578ee55a9a406f68dd200bcaf70e` — FAIL: the desktop transcript rendered, then continually flashed back to `Opening chat`; desktop runtime logged repeated `AbortError/UNKNOWN` upstream failures.
- New `issue-1285-c14` Jest contract — RED first: two cancellations and one reopen during the ready/provider-selection interleaving.
- `npm test -- --runInBand apps/mobile/tests/chat/agent-chat-detail.test.tsx` — PASS 2/2 after correction.
- `node --test tests/contract/msp-004-atomic-open-session.test.mjs` — PASS 12/12.
- `npm run typecheck` in `apps/mobile` — PASS.
- `ai-workflow checks --level issue` — PASS.
- `ai-workflow checks --level pr` — PASS across all 15 configured stages.
- GitNexus `impact` for `AgentChatDetailScreen` — LOW, zero upstream callers/processes.
- GitNexus working `detect-changes` — LOW, one indexed runtime symbol and zero affected processes.

## Notes

- `createOpenProjectSessionController` commits provider state and then publishes
  `ready`. On native React, the route can observe the matching `ready` state one
  render before `currentSessionId` becomes visible.
- The prior route interpreted that normal frame as inconsistent, cancelled the
  successful open, and immediately called open again. This explains both the
  transcript/loading flash and the corresponding aborted proxy requests.
- The route now returns for any matching `ready` opener and lets its existing
  `isReady` rendering guard wait for provider state to catch up. It never cancels
  or reopens the successful target.
- Failure-postmortem classified the missing lifecycle criterion as C1 and the
  earlier broad open/read contracts as C2. Existing follow-up #1287 was updated
  instead of creating a duplicate.
