# C3: canonical coordinator notification through the existing mobile stream

Author: **Sol 6.1**, 2026-10-06. **PLAN ONLY — for Astra review.** Core worker90808 and mobile Sonnet C4 worker56554 remain active; no implementation, test, server, deployment or device action is authorized by this document. Source observations are provisional until both owners freeze. Adopt the existing C1/C2/C4 corrections and [correction plan](rhythm-mobile-followthrough-correction-plan.md).

Goal: a successfully committed change to the authenticated primary's canonical transcript/state causes an enabled mobile Rhythm view to reread that same root while the user leaves the UI idle, including an inert root with no SDK/catalog row. Use the existing hub/SSE/controller; preserve history, drafts, Secretary/profile/native modes and all permission/command authority.

Evidence: builder's [read-only trace](/Users/ajhochhalter/Documents/Codex/2026-10-01/task-11/rhythm-coordinator-chat-integration-20261005/mobile-canonical-notification-readonly-trace.json), observed01:07:38Z, baseline5da2f764…. Targeted source reads confirm: repository transactions are synchronous; `recordStatusMessage` adds canonical input without advancing controlRevision; bridge structured writes and legacy output append can commit before raw hub publication but catch failures; child completion is detached. Existing mobile event qualification requires an SDK→local catalog mapping. There is no current canonical local-root producer.

## Minimal contract

Proposed hub envelope, using existing trusted project-directory shaping:

```json
{
  "directory": "<server-resolved canonical project directory>",
  "payload": {
    "type": "rhythm.coordinator.changed",
    "id": "<fresh bounded notification ID>",
    "properties": {
      "projectId": "<opaque authoritative project ID>",
      "conversationId": "<persisted current conversation ID>",
      "localSessionId": "<authoritative local primary root ID>"
    }
  }
}
```

These are identities only; omit bodies, goals, receipts, status text, owner identity, credentials, permissions, SDK selectors and controlRevision. The notification ID exists for the current bounded dedupe mechanism, **not as a transcript clock, ordering guarantee, durable cursor or authority**. Generate distinct IDs for distinct successful mutations, including two updates to the same persisted message row. ControlRevision, message ID and timestamp alone cannot dedupe transcript changes. No schema migration, new stream, timer, durable queue or replay protocol.

The event is an invalidation hint. Only the existing canonical status/history response can change the view. It cannot send, prepare/continue work, consent, retire pending commands, switch roots/projects, change permissions or construct transcript rows. Exact replay of an already committed command need not publish again; reconnect/fallback rereads recover missed delivery.

## Commit producers and ownership boundaries

Paths below are relative to `apps/api_server/src/` in the **current core working clone**, not installed/live source. After core90808 freezes, Astra assigns one implementation owner for these narrow backend hunks. Builder remains composition/runtime owner.

| Boundary | Smallest concrete change | Commit rule |
| --- | --- | --- |
| `repositories/coordinator_conversations_repository.ts` | Add one read-only local-root notification-scope lookup, borrowing existing `session`/`get`/primary validation; return exact conversation/local root/project/owner/canonical directory only for current nonarchived ordinary primary. Do not require SDK binding. Reuse mutation return values; add a committed-change indication only where a successful write cannot be distinguished from replay. | No publication from `appendCanonicalUserInput`, an inner transaction, pre-CAS reservation, rolled-back race or failed save. The lookup is read evidence, never an action grant. |
| `services/coordinator_conversation_service.ts` | One narrow post-commit publisher helper using that lookup and `opencodeEventHub.publish`; call after successful canonical mutation return. Cover `addGoal`/`receiveMessage` paths (`addGoalFromMessage`, `recordStatusMessage`) and successful state changes from existing goal/continuation reconciliation. Inventory those calls against the **frozen** service rather than duplicating active worker changes. | Publish after the outer transaction returns; changed control/state may invalidate status, but do not label foreground reservation/ACK as assistant output. No-op replay/read/hold does not prove a mutation. Publication failure cannot roll back or duplicate a committed command. |
| `services/opencode_stream_bridge.ts` | Reuse the same publisher after successful root `upsertPart`/`applyPartDelta`/`upsertMessageInfo` persistence and legacy assistant `messagesRepo.append` commit. Use actual SDK→local mapping then current local-primary lookup; ordinary/child output does not qualify. Touch only output-persistence and raw hub publication boundaries, preserving frozen `decidePermission` hunks. | The success branch must precede publication. Legacy append success still qualifies if a later preview update fails; append failure does not. Structured assistant updates need notification even without controlRevision change. Never publish merely because `session.idle`, `output.flush` or a broadcast occurred. |
| `repositories/agent_session_messages_repository.ts` | Prefer zero change: existing synchronous returns supply successful persisted row evidence. If the bridge cannot distinguish committed mutation from no-op, expose only that result from the specific existing write method; no generic repository event bus. | A repository method invoked inside another transaction is not an outer commit hook. Producers must demonstrate their call is outside a still-open outer transaction. |
| `services/async_delegation_completion_service.ts` | Prefer zero notification change. If it commits coordinator metadata locally, notify only for that identified committed metadata mutation through the same helper. | Terminal receipt, completion enqueue, SDK dispatch acceptance and `notified` are **not root transcript commit**. The eventual root callback output qualifies only at its actual bridge persistence. Do not emit an assistant-result notification on child idle/enqueue. |
| `services/opencode_event_hub.ts` | Existing singleton, bounded queues and `publish` remain the transport; place a small typed notification definition/publisher here if it avoids duplicate shape construction. | Reserve the custom type for local producers: raw engine publication/direct fallback must not impersonate it. Existing bridge `_publishToHub` constructs directory/payload; reject the reserved custom type from that raw ingress. No new hub or unbounded buffer. |

## Delivery guard and mobile consumer

Backend forwarding owner, assigned only after core freeze: `services/mobile_sse_proxy.ts` (`deliver`/`consumeHub`) and `services/mobile_opencode_security.ts` (specific local-root validation/allowlisted shaping). The local lookup stays in `coordinator_conversations_repository.ts`; inject/reuse it rather than treating the SDK ownership registry as a local-ID registry. Existing `routes/mobile_gateway_routes.ts` remains Device/project route ownership; change only if current-device/current-project proof is missing at delivery.

For the custom type, **branch before generic unknown/non-session acceptance**. Immediately before writing the frame, reprove active device, authenticated device owner, current authorized selected project, envelope project/directory agreement, and DB-owned nonarchived nonchild nonsystem chat root. Parse the current conversation, require `primaryOwnerRoot`, and match all three payload identities to that current record. Missing/malformed schema, revoked device/project grant, archive/delete/rebind, foreign owner/project, ordinary/child root, wrong conversation or lookup failure drops the event. Recheck after any awaited lookup; no cached producer proof. Allowlist the exact output shape; any unexpected payload fields are rejected or omitted without forwarding private content.

Use the project feed `/mobile-gateway/events`. **Drop the custom event on `/sessions/:id/events`** for this minimal slice; a local UUID must never become that route's SDK selector. Accept the type only from the canonical hub producer path, not direct raw engine fallback. Keep existing backpressure/dedupe/owner checks for all native SDK events intact.

After mobile worker56554 freezes, its owner extends only `apps/mobile/providers/opencode-provider-types.ts`, `opencode-provider.tsx` and `coordinator-conversation-provider.tsx`. Add a discriminated identity-only canonical notification separate from native SDK activity. Parse unknown payload at existing paired global-stream ingress; direct standalone OpenCode connection cannot qualify it. Preserve mounted/abort/envelope-directory checks and capture exact originating paired client plus existing stream/project generation in the local listener event; those fields are never server authority.

Consumer requires same live client/generation, current actor-qualified binding, enabled mode, exact project/local root and current conversation ID. This works with `server-primary:<root>` without catalog lookup; that synthetic UI key stays local. Call only the C1/C2-fenced controller `revalidate`. An operation in progress retains one trailing invalidation; mode exit, teardown or identity change discards it. Do not repurpose native `sessionID`, fake a catalog row, change transcript merging, or weaken negative SDK-event cases.

Keep C4's existing 5s fallback/read-cycle completion and foreground/reconnect recovery. The hub is lossy/non-durable; SSE-down or missing hub cannot qualify event delivery. A successful current project/client read cycle may invalidate the already bound canonical root without SDK data becoming transcript authority. No additional interval, and healthy idle delivery comes from this committed event rather than polling.

## Red cases, verification and order

1. **Real SQLite commit test:** subscribe existing hub, perform canonical user/control mutation; on receiving the event reread persisted row/current conversation. Force outer rollback/CAS loss/write failure and assert zero event. Replay asserts no duplicate commit/publication. Test status-message input with unchanged controlRevision.
2. **Bridge tests:** two successful assistant updates to the same root/message/controlRevision produce distinct invalidations and canonical reads include latest text; failed append/upsert, child/ordinary output, idle without committed output and completion enqueue publish no root-result hint. Test legacy append success plus preview failure separately.
3. **Real guard/forwarder behavior:** deliver to matching active owner/project/root with no SDK ID; then archive, revoke, change owner/project/current conversation between enqueue and delivery and assert zero bytes. Reject malformed/body-bearing/custom engine-spoof input and per-SDK-session feed. Retain native SDK scope, shaping, queue overflow and dedupe regressions.
4. **Mobile actual parser/provider:** healthy paired stream event updates inert primary's canonical rows while UI is idle, with no catalog row and no send/prepare/continue call. Wrong client/generation/project/root/conversation, normal mode, teardown and in-flight replacement reject; duplicate/burst remains bounded and admission gets one trailing read. Retain C4 fallback, draft and transcript-isolation tests. Replace the prior inert absence witness with this real typed stimulus; keep unknown SDK events negative.

Extend affected existing API tests: `coordinator_conversation_{repository,service}.test.ts`, `opencode_stream_bridge.test.ts`, `issue_1379_bridge_hub_publish.test.ts`, `issue_1379_mobile_event_fanout.test.ts`, `issue_1170_mobile_realtime_proxy.test.ts`; add one focused canonical-notification test only if needed for the combined SQLite→hub→proxy seam. Mobile uses existing Sol verification/coordinator suites and stream-reader tests. No fake-server/E2E edits without their explicit human validation; no new broad suite framework. Run affected tests/static checks against immutable source, then builder's actual commit→hub→paired stream→canonical read trace; source-only proof does not replace device acceptance.

**Implementation order:** Astra accepts this contract → core90808 freeze/manifest and mobile56554 freeze/manifest independently → backend owner lookup/commit publisher + guarded forwarding → mobile owner typed consumer → Sol targeted verification → builder composes with frozen permission hashes → actual paired trace → reviewed screenshots before existing build/TestFlight → device idle-result/mode-round-trip proof. Backend and mobile contracts/tests can be prepared independently after their own freezes, but no overlapping source edits while their current owners run. Do not block unrelated core/auth composition or repeat accepted catalog work.

## Remaining uncertainty / acceptance held

Core commit boundaries and exact reconciliation call inventory may shift before freeze. Recheck outer transaction ownership before enabling any producer. Mobile C4 results are not assumed accepted. Relay/uplink preservation of the new hub type and availability/freshness of canonical local-root owner metadata at relay delivery are **UNKNOWN**; if the relay cannot reprove scope, it must fail closed and use existing canonical recovery, and relay idle notification acceptance remains held. Request the existing owner's checkpoint, not a new relay service/protocol. Also unproved: event hub liveness/reconnect loss recovery, actual root callback persisted output, screenshots, new TestFlight and installed-device behavior. Retain frozen receipts/patches; no private text/secrets or cleanup of active owned work.
