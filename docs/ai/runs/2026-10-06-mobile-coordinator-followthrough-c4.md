---
date: 2026-10-06
repo: rhythm
branch: codex/memory-search-cloud-auth-20261005
pr: none
issues: []
status: unverified
tags: [run, rhythm]
---

# Mobile follow-through C4: SSE-down delivery (after C1/C2 checkpoint)

Base `5da2f764`. Source-only, not committed. Not whole-mobile acceptance; C3 remains failing.

## Red first
`tests/sol-coordinator-followthrough-verification.test.ts -t "SSE-down"` failed before edits (history stayed `[1]`).

## Change
- `providers/opencode-provider-types.ts`: `ProjectReadListener` and `subscribeProjectReads` (documented as read-invalidation, not a session event; payload `{projectId}` only, no session id).
- `providers/opencode-provider.tsx`: listener set + `subscribeProjectReads`; `notifyProjectReadCompleted(projectId, client)` fans out only if `isCurrentClient(client)` and `activeProjectPathRef.current === projectId`. In the EXISTING 5s safety callback the sessions read became `refreshSessions(true).then(notify)`: a rejected read emits nothing; a `cancelled` flag set in the effect cleanup suppresses emission after teardown; `client` and the notifier added to the effect deps (a replaced client re-arms the same interval; no new interval/scheduler).
- `providers/coordinator-conversation-provider.tsx`: subscriber calls `controller.revalidate(binding)` only when `read.projectId === binding.projectId` and the active project matches. Revalidate is the C1/C2 read-only, coalesced, epoch-fenced path (status + canonical history via the binding's own paired-client reads). No command, consent, merge or SDK identity.
- Tests: Sol's file only gained the mock `subscribeProjectReads` and two extraction dependencies (`client`, `notifyProjectReadCompleted`, mirroring just the production currency gate); no assertion changed. `tests/coordinator-delayed-result.test.ts` +3: wrong project / normal mode / unmount; actual fallback callback emits exactly once for the current client after success; rejected read and cleanup-before-settle emit nothing.

## Results
- Sol file: 11 pass, 1 FAIL = **C3 inert primary without catalog row** (unchanged, explicit remaining gate). SSE-down case now passes.
- `tests/coordinator-delayed-result.test.ts`: 11/11. `coordinator-conversation`, `global-event-stream`, `session-refresh-pinning`, `post-prompt-refresh`: 49 pass.
- `npm run typecheck` clean; `npm run lint` 0 errors, 7 pre-existing warnings.

## Limits
- The production stale-client/project gate inside `notifyProjectReadCompleted` is not directly executed by tests (it is a `useCallback`, mirrored in Sol's harness); only the cancelled/rejected paths run real code.
- The signal fires only when the existing safety interval runs (stream not connected, or busy session/conversation/sending); with healthy SSE and idle sessions no signal exists. It only proves a project session read completed, not that a canonical row was committed.
- No e2e/live proof.

## Info for builder's C3 trace
Mobile sources of coordinator invalidation are now: SDK session events (`session.status|idle|error|updated`, `message.updated`) qualified by exact SDK id / catalog row with matching `rhythm.localSessionId`; AppState foreground; safety-fallback project read. The inert/no-row/healthy-SSE case has none. A trusted producer would need to arrive on `/mobile-gateway/events` (decoded in `handleEvent`, project-filtered by envelope `directory`) carrying the local root id and revision, which can feed a third identity-only listener in the same seam; no such event type exists in `GlobalEvent['payload']` handling today.
