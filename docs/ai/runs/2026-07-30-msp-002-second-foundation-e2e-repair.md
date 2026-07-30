---
date: 2026-07-30
repo: Rhythm
branch: codex/msp-002-profile-first-sessions
pr: 1266
issues: [MSP-002]
status: awaiting-playwright-rerun
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# MSP-002 second foundation E2E repair

## Files changed

- `apps/mobile/tests/fake-opencode/server.mjs` — add Secretary to the direct
  web harness `/agent` response. The first repair changed only the paired
  mobile profile catalog, while the failing foundation specs use direct
  OpenCode transport.
- `apps/mobile/tests/contract/msp-002-profile-first-sessions.test.mjs` — extend
  issue-2-c1 to require Secretary in the direct harness catalog as well as the
  paired profile catalog.
- `docs/ai/project-state.md` — replace the stale first-repair snapshot with
  the second-pass status and remaining external rerun.

## Checks run

- Before implementation:
  `cd apps/mobile && node --test tests/contract/msp-002-profile-first-sessions.test.mjs`
  — 6/7 passed; issue-2-c1 failed because `/agent` omitted Secretary.
- `cd apps/mobile && ./node_modules/.bin/tsc --noEmit` — passed.
- `cd apps/mobile && npm run lint` — passed.
- `cd apps/mobile && node --test tests/contract/msp-002-profile-first-sessions.test.mjs tests/contract/msp-001-session-profile-contract.test.mjs`
  — 13/13 passed.
- `cd apps/mobile && npm test -- --runInBand tests/chat/chat-composer.test.tsx`
  — 4/4 passed.
- `cd apps/mobile && node ./tests/fake-opencode/self-test.mjs` — blocked before
  assertions by sandbox `listen EPERM` on `127.0.0.1:4196`.
- `git diff --check` — passed.

## Notes

- Happy-path evidence at
  `apps/mobile/test-results/flows-happy-path-keeps-the-main-chat-flow-stable-chromium/error-context.md`
  showed the New chat sheet over an empty Chats list, a visible
  Secretary-unavailable message, and Playwright waiting on the disabled exact
  `Create` button.
- All inspected fresh error contexts shared the same message and stalled
  Create locator, confirming one upstream capability-catalog blocker.
- Product code was not relaxed. `getNewSessionPreferences` still requires
  Secretary; the optional picker and three-dot session configuration remain
  intact; issue #1270's no-Secretary behavior is unchanged.
- No follow-up issue was filed. The orchestrator must rerun Playwright and the
  fake-server self-test in a loopback-capable environment.
