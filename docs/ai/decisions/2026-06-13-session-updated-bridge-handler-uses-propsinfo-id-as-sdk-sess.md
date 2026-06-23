---
index: "[[Rhythm]]"
date: 2026-06-13
repo: rhythm
tags: [decision, rhythm]
---

# session.updated bridge handler uses propsInfo?.id as SDK session ID fallback (#710)

**Context:** The `_relayEvent` bridge method extracted the SDK session ID for routing via `props.sessionID ?? propsInfo?.sessionID ?? propsPart?.sessionID`. The `session.updated` event's `properties.info` is a `Session` object whose SDK field is `id` (not `sessionID`). Without the `propsInfo?.id` fallback the bridge could not correlate the event to a local session.

**Decision:** Added `propsInfo?.id` as a fourth fallback: `props.sessionID ?? propsInfo?.sessionID ?? propsInfo?.id ?? propsPart?.sessionID`. This is safe — `id` on a `Session` is always the SDK session UUID.

**Alternatives considered:**
- Rename `id` to `sessionID` in our d.ts: rejected — would diverge from the real SDK shape (breaking the SDK-parity guard).

**Consequences:** The extraction chain is now four levels deep. Future SDK events whose `properties` object uses `id` (not `sessionID`) will automatically route correctly without additional changes.
