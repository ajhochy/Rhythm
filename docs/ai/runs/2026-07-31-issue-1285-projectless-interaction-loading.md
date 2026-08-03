---
date: 2026-07-31
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1285]
status: verified-pending-device-smoke
tags: [run, Rhythm]
---

# Issue 1285 — projectless interaction and loading corrective

## Files

- Mobile chat discovery now preserves `projectId: null`, carries a separate
  registered-project routing context, publishes the first 10 owner chats, and
  merges later pages/project batches progressively.
- Projectless exact-owner chats no longer render or behave as read-only.
- Chat opening waits only for the bounded 20-message page; diffs, todos,
  permissions, and questions hydrate afterward.
- The Opening chat state exposes a working Back to chats action.
- API discovery returns null project identity plus routing context, while the
  existing exact-owner authoritative-cwd check continues to authorize addressed
  reads and mutations.
- Added corrective c8-c11 acceptance coverage and a physical-smoke postmortem.

## Checks

- `node --test tests/contract/issue-1285-device-parity.test.mjs tests/contract/msp-004-atomic-open-session.test.mjs` — 18/18 passed.
- `npm test -- --runInBand tests/session-discovery.test.ts tests/chat/agent-chat-detail.test.tsx` — 3/3 passed.
- Focused mobile service regression — 3/3 passed.
- Focused API discovery regression — 3/3 passed.
- Mobile `npm run typecheck` — passed.
- Targeted mobile ESLint — 0 errors, one pre-existing array-style warning.
- API `npm run build` — passed.
- `ai-workflow checks --level issue` — passed Flutter analyze/format and API/MCP TypeScript.
- `PYTHONUNBUFFERED=1 ai-workflow checks --level pr` — passed Flutter tests,
  serial API tests/build, MCP tests/build, fork typecheck/session tests, mobile
  static/contract/fake-server, and mobile web E2E.
- Fresh isolated API 4698 + engine 4697 + gateway 4699 live test — 1/1 passed:
  exact-owner projectless discovery retained null identity, a no-model mobile
  prompt was read back from the same transcript, and a second owner received
  HTTP 404.
- GitNexus working-diff scan — LOW, 15 indexed files / 28 symbols / 0 affected
  processes. Stacked PR-base scan remains MEDIUM due to the existing rollup.

## Notes

- The initial live assertion read immediately after `prompt_async`; bounded
  polling corrected that P4 test-timing assumption without changing product
  behavior.
- Two buffered PR-gate attempts exited without durable summaries. The final
  unbuffered invocation recorded every stage and exited 0.
- Physical-iPhone screenshot and interaction smoke remain required after the
  exact committed PR build is installed.
