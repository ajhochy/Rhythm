---
date: 2026-10-06
repo: rhythm
branch: codex/memory-search-cloud-auth-20261005
pr: none
issues: []
status: unverified
tags: [run, rhythm]
---

# Mobile coordinator delayed-result follow-through

Baseline: parent `5da2f764b5f240bb9650c58ce558a32aac2381e1`. Contract: `docs/ai/contracts/2026-10-06-mobile-coordinator-followthrough.md`. Not committed/pushed; no PR.

## Finding (red first)
Read of `coordinator-conversation-provider.tsx` / controller: canonical history/status were read only on open, refresh and after send. The provider consumed no event feed (`useOpencode()` exposed none; SSE `handleEvent` only updated ordinary caches). New focused test `tests/coordinator-delayed-result.test.ts` was run against unmodified source: 4 of 5 failed (delayed row `2` never appeared for SDK primary, inert primary, foreground, burst); the negative guard case passed. Setup assertions (initial row `[1]`, inert binding source) passed, so the failure is the missing behavior, not harness wiring.

## Files
- `providers/opencode-provider-types.ts` — `SessionActivityListener` type, `subscribeSessionActivity` on context (identity-only feed).
- `providers/opencode-provider.tsx` — listener set + stable subscribe; `handleEvent` forwards `{projectId, sessionId}` for `session.status|idle|error|updated`, `message.updated` (events already filtered to current project directory). No change to existing event handling.
- `providers/coordinator-conversation-controller.ts` — `revalidate(binding)`: quiet status read then canonical history; coalesced (in-flight + one trailing), epoch/key/enabled scoped, abort wired through existing `controllers`; no phase/notice/pending changes; `clear()` resets its map.
- `providers/coordinator-conversation-provider.tsx` — subscribes to activity (exact-root qualification, see contract) and AppState `active`.
- `tests/coordinator-delayed-result.test.ts` — new (5 tests).
Not touched: chat-view, service, tests/e2e, tests/fake-opencode, auth/permission source, docs/ai/project-state.

## Checks (run in apps/mobile, HEAD 5da2f764 + working tree)
- Red: `npx jest --runInBand tests/coordinator-delayed-result.test.ts` → 4 failed, 1 passed (before app change).
- Green: same → 5 passed.
- `npx jest --runInBand tests/coordinator-conversation.test.ts tests/coordinator-delayed-result.test.ts tests/global-event-stream.test.ts tests/session-refresh-pinning.test.ts tests/post-prompt-refresh.test.ts` → 5 suites, 54 tests passed.
- `npm run typecheck` → clean.
- `npm run lint` → 0 errors, 7 pre-existing warnings, none in changed files.
- NOT run: `npm run test:e2e:web` (starts fake server/web server; user said not to start servers silently — owner runs after composition). No screenshots, no build, no live/device.
- Not captured: patch/file SHA-256 (piped hashing was denied by the sandbox); use `git diff -- apps/mobile` + the untracked test file.

## Limits / risks
- Tested at unit/provider level with mocked gateway/opencode; not installed or live-proven. Real gateway event delivery for an inert primary (events only qualify once the catalog exposes its row) and foreground behavior need owner integration/device proof; before that, Refresh/foreground remain the fallback.
- When SSE is down, no event fires; only foreground/manual refresh reconcile (no new polling by design).
