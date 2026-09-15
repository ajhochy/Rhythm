---
date: 2026-09-15
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Bounded skill usage and owned API recovery

## Context

Full-table transcript materialization caused severe memory pressure during skill usage counting, while unexpected owned API exits left the desktop client disconnected. The repair must preserve exact mutable-history counts, learning eligibility, evaluator behavior, and safe process ownership.

## Decision

- Keep synchronous `countSkillToolUses()` but have SQLite project only skill name and session-classification metadata before JavaScript sees rows. Preserve the shared learning predicate, malformed-input guards, edit/delete visibility, and Postgres no-op.
- Avoid usage scans when no valid draft exists and protect evaluator execution with single-flight/coalescing guards so completed-turn evidence is not dropped or evaluated concurrently.
- Recover only positively observed owned child exits. Use generation-tagged lifecycle state, capped delayed retries, explicit manual retry after exhaustion, bounded local native stderr capture, and graceful intentional-stop/dispose suppression.

## Alternatives considered

- A persistent usage projection or cache was deferred because it needs mutation dirty tracking, historical backfill, delete reconciliation, and session-classification invalidation; timestamp/rowid caches could miss valid edits or deletes.
- Archive truncation, row/byte cutoffs, heap increases, adoption of external processes, and continuation of interrupted turns were rejected because they change semantics or exceed the repair scope.

## Consequences

- JavaScript heap usage is bounded and real constrained-heap API behavior remains healthy with exact counts, but SQLite still scans history synchronously and native RSS is not constant.
- An owned API replacement restores future connectivity and durable crash evidence, but a turn interrupted by the crash may not continue. Human packaged chat/history smoke remains required before release.
- The implementation is additive and preserves full historical telemetry and existing learning/evaluator semantics; an incremental projection remains a future option if measured scan latency or native memory is unacceptable.
