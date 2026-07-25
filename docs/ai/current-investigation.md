# Investigation — #1123 interactive asynchronous delegation

## Trigger and current behavior

`rhythm_delegate` posts to `POST /agent-delegation/delegate`, whose service awaits `agent_runner.run()` through completion. The parent tool call therefore remains blocked and the parent cannot finish its turn while the specialist works.

## Existing seams to reuse

- `OpencodeClientService.createSession` and `promptAsync` already create and enqueue real engine sessions.
- `AgentSessionsRepository.upsertChildSession` persists a child by SDK `parentID`, and the stream bridge maps subsequent child events to the local row.
- `resolveProfileScope` resolves the target model, MCP scope, skill scope, system prompt, and OpenCode agent.
- `OpencodeStreamBridge._relayEvent` persists message parts and treats `session.idle` as the real interactive turn boundary.
- Parent session status is durable in `agent_sessions`, so callback delivery can defer while the parent is `starting` or `working`.

## Gaps

- Session creation does not currently accept an engine `parentID` from api_server callers.
- No durable record distinguishes async-delegated children from native `task` children or records whether a callback was already delivered.
- The stream bridge has no child-completion callback hook.
- Existing manager/delegate guards do not distinguish interactive from scheduled/system invocation because synchronous headless delegation is intentionally supported.
- Concurrent child completions have no parent-keyed serialization/coalescing mechanism.

## Failure modes to test

1. Listener/map readiness race before the child emits its first event.
2. Child completes while the parent is processing a user turn.
3. Two children complete before one parent wake begins.
4. A second child completes while an earlier callback wake is in flight.
5. Duplicate/replayed `session.idle` events.
6. API restart after child dispatch or completion.
7. Prompt enqueue failure after the engine child/local row exists.
8. Headless/scheduled/system caller attempts to bypass tool exposure.

## Resolved implementation direction

Use a small durable delegation table and an in-process per-parent coordinator backed by transactional state. The database supplies restart/idempotency guarantees; the in-memory coordinator only serializes the current process. Completion uses the already-persisted final assistant text and wakes the parent with `promptAsync`. No native fork tool changes or Flutter-specific protocol are required.

## Live recon result

The isolated branch-built sandbox ran on API `:4198` and fork engine `:4197`.
The manual Recon sequence created disposable manager/child profiles, started a
parent user turn, dispatched the child while the parent was working, and
observed the completion only through the parent's `/ws/agents` stream:

- dispatch returned HTTP 202 in 43 ms with local and SDK child identifiers;
- the concurrent parent turn emitted `USER_STEER_ACCEPTED` first;
- the child emitted `CHILD_RECON_DONE`;
- the completion coordinator injected one normal parent input beginning
  `[Async delegation update]` with the stable local child id;
- the parent emitted `PARENT_WAKE_RECON` and `CHILD_RECON_DONE` on its existing
  `message.part.delta` stream;
- `/agent-sessions/:parent/children` exposed the real engine child with
  `parentID` equal to the manager's SDK session id.

The first codified run failed only because that last endpoint returns SDK
session identities rather than local database identities. Failure triage
corrected the assertion domain without weakening the behavior check. The
second live run passed in 6.31 seconds and cleaned up all disposable profiles
and sessions.
