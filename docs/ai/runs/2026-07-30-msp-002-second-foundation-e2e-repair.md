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
  paired profile catalog, and pin on-demand profile resolution for automatic
  creation plus the direct Chats sheet.
- `apps/mobile/providers/opencode-provider.tsx` — return hydrated profiles from
  capability refresh, add `loadSessionProfiles(projectId)`, and use it before
  Secretary-default creation when capability state is initially empty.
- `apps/mobile/providers/opencode-provider-types.ts` — expose the shared
  project-profile loader through the provider context.
- `apps/mobile/components/chat/chat-list.tsx` — await the shared profile loader
  instead of substituting an empty direct-mode catalog while hydration is
  pending.
- `docs/ai/project-state.md` — replace the stale first-repair snapshot with
  the second-pass status and remaining external rerun.

## Checks run

- Before implementation:
  `cd apps/mobile && node --test tests/contract/msp-002-profile-first-sessions.test.mjs`
  — 6/7 passed; issue-2-c1 failed because `/agent` omitted Secretary.
- Before the timing follow-up, the strengthened same command again passed 6/7;
  issue-2-c1 failed because `createSession` and the direct sheet did not load
  profiles when `availableAgents` was still empty.
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
- Failure triage found a startup dependency cycle: capability refresh occurred
  only after a usable session existed, while MSP-002 required Secretary from
  those capabilities before creating the first session. The direct sheet also
  converted pending hydration to an empty catalog.
- Product code was not relaxed. `getNewSessionPreferences` still requires
  Secretary; the optional picker and three-dot session configuration remain
  intact; issue #1270's no-Secretary behavior is unchanged.
- No follow-up issue was filed. The orchestrator must rerun Playwright and the
  fake-server self-test in a loopback-capable environment.
