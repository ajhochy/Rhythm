---
date: 2026-09-29
tags: [decision, rhythm]
---

# Org Reviewer context: session evidence first

## Context

The 2026-09-27 context-budget repair (contract c3) fitted profiles, schedules,
queue, DB skills and the live capability catalog before sessions, inside the
44,000-byte response cap. A real review then reported `sessions.total=67,
included=0`. The reviewer's only job is to cite session transcript evidence
(at least two distinct sessions per proposal), so it could not submit anything.
A sandbox reproduction showed profiles/schedules/catalog reaching 43,984 bytes
and 0/15 sessions admitted. The content scanner withheld nothing. In the unit
reproduction, one newest session also took the whole 14,000-byte transcript
allowance.

## Decision

- Admit sessions first. They are still bounded by `MAX_TRANSCRIPT_BYTES`, so
  static data keeps roughly 25 KB. The target `currentState` stays in the fixed
  header, and an oversized target still fails closed.
- Give each session a share of the transcript allowance:
  `max(2,500, 14,000 / candidates)` bytes. Messages that don't fit are clipped
  to a prefix of the 4,000-char view the verifier checks, never below 200 chars.
- `fitCollection` skips an item that does not fit instead of stopping, so one
  oversized entry cannot block smaller ones after it.
- Stats add `omittedByByteBudget` to every collection, plus
  `omittedWithoutMessages` for sessions. Content-scanner withholding is still
  reported separately by the MCP layer as `withheldByContentSafety`.

## Alternatives

- Raise `MAX_CONTEXT_BYTES`: rejected, because the engine's 50 KiB fenced output
  limit is fixed.
- A separate session reserve with static-first ordering: more code, and it
  still needs the per-session share.

## Consequences

Under pressure, profiles, schedules, the proposal queue and catalog entries are
omitted before transcript evidence, and the omissions are reported explicitly.
Server-side dedup still guards against duplicates when the queue is omitted.
Contract c3 of `org-reviewer-context-budget` is superseded.
