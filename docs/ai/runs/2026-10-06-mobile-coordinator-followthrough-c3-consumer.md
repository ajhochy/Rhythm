---
date: 2026-10-06
repo: rhythm
branch: codex/memory-search-cloud-auth-20261005
pr: none
issues: []
status: unverified
tags: [run, rhythm]
---

# Mobile C3 typed canonical-notification consumer (SOURCE-ONLY)

Plan: `task-4/rhythm-mobile-canonical-notification-plan.md`; Astra review accepted. Base `5da2f764`. Preserves C1/C2/C4. Not committed. Backend producer/forwarder is NOT implemented here, so healthy-idle delivery is unproved end-to-end.

## Red first
Added tests before implementation (`tests/coordinator-delayed-result.test.ts`): 17 failed / 16 passed. Parser/qualifier cases failed by absence of the production functions; behavioral reds: inert primary stayed `[1]` after a typed notification, and the finite-admission case missed its trailing read. Negative cases passed vacuously pre-change.

## Change
- `providers/opencode-provider-types.ts`: `CoordinatorChangedListener` (`{projectId, conversationId, localSessionId, pairedClient}`), `subscribeCoordinatorChanges` on the context. Separate from `subscribeSessionActivity` and `subscribeProjectReads`.
- `providers/opencode-provider.tsx`:
  - `parseCoordinatorChangedEvent`: exact keys `{type,id,properties}` with `type==='rhythm.coordinator.changed'`, bounded non-empty string `id` (<=200), properties exactly `{projectId,conversationId,localSessionId}` (bounded strings), `projectId === envelope directory`. Any extra/missing field, wrong type or non-object rejects.
  - `coordinatorChangedFromEnvelope`: requires a PAIRED stream and `envelope.directory === activeProjectPath`; a direct standalone OpenCode connection never qualifies.
  - Stream ingress: a qualified hint is deduped through existing `rememberEvent` (its `id`), then `notifyCoordinatorChanged(change, streamClient, pairedHostClient)`, which fans out only if `isCurrentClient(streamClient)` and the active project still equals `projectId`. It never enters `handleEvent`/session handlers. Mounted/abort/envelope checks of the loop are unchanged. The effect gains `notifyCoordinatorChanged` as a dep.
- `providers/coordinator-conversation-provider.tsx`: subscriber requires current binding, `change.pairedClient === current paired client`, exact project, exact `localSessionId === binding.sessionId`, and `controller.get(binding).conversation.id === conversationId` (only true for an enabled view, so normal mode does nothing). Then only `controller.revalidate` (C1/C2 epoch, coalescing, operation trailing read). Works for `server-primary:` bindings; no catalog lookup, no SDK id, no fabricated row.
- Tests: `tests/coordinator-delayed-result.test.ts` +extracted-production-function cases; Sol's inert witness now keeps unknown/ordinary SDK events negative and then uses the typed stimulus built from the ACTUAL extracted production qualifier (the in-component fan-out currency gate is mirrored, as for C4). Sol assertions otherwise unchanged; only mock `subscribeCoordinatorChanges` plumbing added.

## Results
- Own file 33/33; Sol file all pass including the converted C3 witness; affected set (Sol, own, coordinator-conversation, global-event-stream, session-refresh-pinning, post-prompt-refresh) 94 tests pass.
- Mutation check: removing the conversation-ID comparison makes "wrong conversation does nothing" fail; restored.
- `npm run typecheck` clean. `npm run lint`: 0 errors, 7 pre-existing warnings.

## Cases covered
Valid paired envelope; direct connection; envelope/project mismatch; no directory; wrong type; missing/empty/oversized/non-string id; extra top-level and property fields (incl. `sessionID`, `controlRevision`, `text`); missing/empty/non-string identities; array/null/string payloads; stale paired client; wrong project/root/conversation; normal mode; unmount; finite admission (one trailing read, no `message`, pending state unchanged); inert primary without SDK row.

## Not proved / gaps
- No backend producer exists in this slice: hub publication, guarded forwarding on `/mobile-gateway/events`, shaping of `directory`, relay preservation, and the reserved type being rejected from raw engine ingress are all unverified. Source-only, no full-stream delivery.
- Generation fence: uses the existing `isCurrentClient` (scope generation) of the stream's SDK client plus paired client identity; there is no separate per-stream counter.
- Trailing read depends on the conversation ID already loaded; before the first successful open/status, a hint is ignored (foreground/Refresh/C4 remain recovery).
- No backend contract change needed on the mobile side; the contract assumes the gateway emits `directory === projectId` for this type (if the gateway shapes directory differently, the qualifier rejects it).
