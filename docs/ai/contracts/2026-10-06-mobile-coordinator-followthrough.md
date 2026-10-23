---
date: 2026-10-06
repo: rhythm
scope: apps/mobile delayed coordinator result follow-through
tags: [contract, rhythm]
---

# Acceptance contract: mobile delayed coordinator result

Plan: `task-4/rhythm-mobile-integration-plan.md` (Sol-authored, Astra-reviewed). Baseline `5da2f764b5f240bb9650c58ce558a32aac2381e1`.

## Behavior
1. With coordinator mode enabled and no prompt/Refresh, a qualified session event for the exact current root causes a read-only status + canonical-history read, so a later terminal result appears.
2. SDK-backed primary qualifies on `event.sessionId === binding.uiSessionId` and `event.projectId === binding.projectId`.
3. Inert `server-primary:<root>` qualifies only when the event's session is a current catalog root row carrying `rhythm.localSessionId === binding.sessionId` (same project). Ordinary-chat and unknown-session events never fetch; no ordinary transcript is read or merged.
4. Foreground (AppState `active`) revalidates the current enabled binding only.
5. Normal mode, scope change, disposal, and any scoped operation discard/skip the read. Bursts coalesce to one in-flight read plus one trailing read.
6. Revalidation never sends a command, never changes phase/notice/pending command/draft, never grants authority, adds no scheduler/store.

## Out of scope / unchanged
Auth/permission source, API/fork, tests/e2e, tests/fake-opencode, chat-view identity join, history persistence, profiles/grants, build/release.

## Corrections C1/C2 (accepted by Astra, `rhythm-mobile-followthrough-correction-plan.md`)
7. C1: a different paired-client object for the same actor/project/root/UI scope advances the controller epoch and aborts reads, so old status/history are refused even if transport ignores abort. Journal, pending command and drafts are untouched; the client is never a storage key.
8. C2: a qualified event during a scoped operation marks at most one read-only trailing reconciliation, drained after that operation settles; dropped on normal-mode exit, scope/client change or teardown. It never resends, retires pending state, or grants anything.
9. C3 (inert primary without catalog row) and C4 (SSE-down fallback) are NOT in this contract; Sol's red tests for them stay red until a reviewed notification decision.

## Evidence required
`tests/coordinator-delayed-result.test.ts` red before change, green after; `tests/coordinator-conversation.test.ts` unchanged and green; mobile lint/typecheck.
