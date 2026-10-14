---
date: 2026-10-13
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Hermes delivery authority belongs to the durable run

## Context

The historical V1 session-origin boundary cannot follow a legitimate workflow
retry: the actual runner resets an attempt and dispatches a new session, while
the old journal/conversation must remain immutable. Session-origin reuse then
conflicts (409); preserving old-session credentials would bypass revocation.
See the [run](../runs/2026-10-13-hermes-durable-run-origin.md).

## Decision

Use explicit V2 owner-authorized immutable durable run/original-Hermes-conversation
metadata, with the historical session as journal anchor only. Reaffirmation uses
the new exact current registry attempt; never rebind the old session. Reuse the
actual workflow run and registry, separating delivery outbox/projection from
lifecycle/attempt scheduling. Recheck exact two-sided membership and immutable
ownership for delivery and ACK; stage corruption/transfer fails closed.

Add local SQLite run-origin metadata with quarantine-first legacy initialization.
Explicit activation validates a unique consistent legacy tuple; ambiguity is 409,
not inferred authority. Preserve event IDs/cursors/ACKs. V2 is opt-in and isolated
from V1 history/ACK and inbox identity. [Canonical wire](../contracts/hermes-event-notify-v2.md).

## Alternatives considered

- Rebind/reuse the old session origin: 409 protects immutability; relaxing it grants
  stale authority or moves the conversation. Rejected.
- Mint a new run for every repair: fragments one actual workflow's history and
  conversation; contradicts existing runner semantics. Reuse the durable run.
- Add a notification lifecycle tracker or duplicate runner: creates competing
  completion/attempt truth. Project the existing registry instead.
- Guess/promote legacy origins automatically: ambiguous ownership/conversation
  becomes authority. Quarantine until explicit validated activation.

## Consequences

Qualified independent gate `7065f528` passes Rhythm architecture (109 checks plus
6 independent probes, no failures), not live provider workflows or Pi acceptance.
Actual fork SSE is separate; native atomic history storage is not wake/render.
Pi acceptance remains BLOCKED/NOTRUN after read-only SSH host-key failure, with
no bypass. Parent-owned sanitized deployed artifacts and narrow non-restarting
fixture activation are next. Dispatch-origin integration, bridge projection and
canonical card IDs remain unqualified. No production migration/deployment implied.
