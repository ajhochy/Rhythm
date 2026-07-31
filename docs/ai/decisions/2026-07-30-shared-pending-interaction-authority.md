---
date: 2026-07-30
repo: Rhythm
tags: [decision, Rhythm]
issues: [3]
index: "[[Rhythm]]"
---

# One authoritative pending interaction across desktop and mobile

## Context

Desktop learned about permission/question asks only from live bridge events,
while mobile rebuilt its state from OpenCode's `GET /permission` and
`GET /question` surfaces. A restarted api_server also lost the SDK-session
reverse map. Those three state boundaries let a late desktop miss an ask and
let desktop/mobile responses race directly to the engine.

The fork's generated OpenAPI and SDK binding establish the engine contract:

- permission authority is `permission.asked`, `GET /permission`, and
  `POST /permission/{requestID}/reply?directory=...`;
- question authority is `question.asked`, `GET /question`, and
  `POST /question/{requestID}/reply?directory=...` with
  `{ "answers": string[][] }` (or `/reject`);
- `session.input` is not a question reply and does not complete the blocked
  question tool.

The env-gated live continuation test records the runtime verification path.
MSP-003 did not run it because this workstream is explicitly forbidden from
starting the sandbox, servers, or ports 4096–4098.

## Decision

The api_server bridge owns one canonical `PendingInteraction` per stable
engine request ID. It snapshots both engine list surfaces on attach and stream
reconnect, falls back from the transient map to persisted `sdk_session_id`,
and includes unresolved interactions in the desktop `sessions.list` attach
snapshot.

All desktop REST and paired-mobile proxy replies enter
`resolvePendingInteraction`. The first caller installs a per-request in-flight
promise before the engine acknowledgement. Concurrent callers await that same
promise. Successful results become bounded terminal tombstones and are
broadcast as `interaction.updated`; failed acknowledgements remain pending
with a retryable error.

Legacy `permission.*` and `question.*` frames remain during client rollout,
but stable engine request IDs—not tool call IDs—are authoritative.

## Alternatives

- Client-local pending maps: rejected because reconnect and cross-client races
  cannot be reconciled.
- Optimistic card removal: rejected because an engine failure erases the only
  retry affordance.
- Database rows for every ask: deferred; the engine list surfaces already own
  pending durability, while bounded in-memory tombstones cover races within
  the single api_server process.

## Consequences

- Later desktop attaches see already-pending asks.
- Restart recovery works with a cold `opencodeSessionMap`.
- Exactly one engine reply is sent for simultaneous desktop/mobile answers;
  every caller receives the winner's terminal state.
- Desktop cards stay visible until HTTP acknowledgement and remain retryable
  after failure.
- A process restart forgets terminal tombstones, but the authoritative engine
  list no longer contains resolved asks, so they cannot rehydrate as pending.
