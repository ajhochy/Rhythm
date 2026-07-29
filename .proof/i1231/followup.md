# Follow-up issue draft

## Title

iOS/Desktop: attach mobile-created sessions to the desktop live transcript bridge

## Context

Issue #1231 makes `agent_sessions` the single user/project-scoped list and
lifecycle catalog. A mobile-created OpenCode session is adopted into that
catalog using its durable `sdk_session_id`, so it appears on desktop without a
duplicate execution or transcript table.

The gateway remains the live owner of that mobile-created engine session. The
adoption path intentionally does not start a second `OpencodeStreamBridge`
subscription or copy historical engine messages into
`agent_session_messages`. Consequently, list identity and lifecycle converge,
but a desktop process that did not observe the original mobile turns may need
to fetch the engine transcript on open before the existing local message
projection is complete.

## Proposed outcome

- Opening an adopted mobile session on desktop hydrates missing messages from
  the existing OpenCode session into the current idempotent message projection.
- A single stream subscription is registered per SDK session after adoption or
  reconnect.
- Message upsert remains keyed by SDK message/part identity, proving refresh
  and reconnect cannot duplicate transcript rows.
- No new session/execution/transcript table is introduced.

## Acceptance criteria

- A prompt sent from mobile is visible when the adopted session is opened on
  desktop after bounded refresh.
- Reopening and reconnecting the same session does not duplicate messages or
  parts.
- Desktop and mobile can alternately add turns while preserving one ordered
  engine transcript.
- Cross-user and cross-project transcript hydration fails closed.
- An env-gated live test drives mobile prompt → desktop open → reconnect
  against one sandbox engine/API.

## Rationale for deferral

Stream ownership and historical message hydration require coordination with
the existing bridge's per-session subscription and message-part projection.
That is separable from #1231's catalog/ownership fix and is riskier than the
small metadata reconciliation hook requested here. Keeping it separate avoids
creating a second transcript store or accidentally double-subscribing the live
engine.
