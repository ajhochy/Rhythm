---
date: 2026-07-11
repo: Rhythm
issue: 1040
tags: [decision, Rhythm]
---

# Headless stream completion dedupe

## Context

Issue #1040 attaches AgentRunner's one-turn headless sessions to the same
directory-scoped event stream as interactive chats. The bridge and the blocking
`prompt()` completion path can therefore persist the same assistant response in
either order.

## Decision

Keep blocking `prompt()` as the completion authority and replace only its final
assistant `append` with `upsertStructured`, keyed by `response.info.id`. The
bridge already uses that SDK message id, so both writers converge on one row.
If the SDK response has no message id, retain the legacy plain-text append.

## Alternatives

- Skip completion persistence when a streamed assistant row is already visible.
  Rejected because the bridge loop is asynchronous; a timing check can run
  before the event is persisted and still create a duplicate.
- Remove AgentRunner completion persistence. Rejected because it would make the
  event stream a completion dependency and regress #738 reliability.

## Consequences

- Stream-first and completion-first event ordering are both idempotent.
- Structured tool/text parts survive the fallback write.
- The existing input append, final idle/error transition, preview update,
  skill/memory prefaces, and category recording remain unchanged.
