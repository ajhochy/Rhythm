---
date: 2026-09-29
tags: [decision, rhythm]
---

# Org Reviewer context: session index plus paged reads

## Context

The 2026-09-27 context-budget repair (contract c3) fitted profiles, schedules,
queue, DB skills and the live capability catalog before sessions, inside the
44,000-byte response cap. A real review then reported `sessions.total=67,
included=0`. The reviewer's only job is to cite session transcript evidence
(at least two distinct sessions per proposal), so it could not submit anything.
A sandbox reproduction showed profiles/schedules/catalog reaching 43,984 bytes
and 0/15 sessions admitted. The content scanner withheld nothing.

The cap is fixed. The engine truncates every tool output at 50 KB / 2,000 lines
(`apps/opencode_fork/packages/opencode/src/tool/truncate.ts`), and the MCP tool
rejects fenced output of 50 KB or more.

The first fix on this PR (sessions first, each session clipped to a share of a
14,000-byte transcript allowance) worked, but it still squeezed everything into
one response. Long messages were cut to a prefix, and configuration was dropped
whenever transcripts were large.

## Decision

Split the data across separate tool calls instead of squashing it into one.
This supersedes the "sessions-first clipping" version of this record.

- `rhythm_read_org_review_context` (`POST /agent-org-proposals/reviewer/context`)
  returns configuration plus a compact **session index** with no transcripts:
  `sessionId, profileId, scheduledTaskId, name (≤60 chars), lastActivityAt,
  status, messageCount, textChars, toolErrors`. The index is admitted first. The
  full index of up to 100 sessions fits: 67 sessions measured 21,314 bytes, about
  320 bytes each, so 100 sessions come to roughly 32 KB. `MAX_CONTEXT_BYTES` stays 44,000 but is now
  measured on the compact JSON the MCP layer actually emits.
- `rhythm_read_org_review_session({sessionId, cursor?})`
  (`POST /reviewer/session`) returns one session's messages with message IDs and
  **full** text. Each page is ≤ 40,000 bytes (`MAX_SESSION_PAGE_BYTES`), leaving
  headroom for the fence. A message larger than a page continues on the next
  page; the opaque `nextCursor` carries `[sessionId, messageId, charOffset]`.
  Nothing is clipped.
- `rhythm_read_org_review_catalog({kind, cursor?, windowDays?, sessionLimit?})`
  (`POST /reviewer/catalog`) pages any overview collection, whole entries only:
  `profiles, schedules, queue, skills, mcpTools, liveSkills`. Live sandbox data
  showed it was needed: next to the index, only 6–8 of 104–105 MCP tool IDs,
  1/16 live skills, 10/16 profiles and 1/8 schedules fit.
- Scope is enforced on every call. The session tool only serves sessions in the
  widest index the reviewer could request (14 days, 100 sessions, same owner
  and pipeline/self-exclusion filters). Anything else gets a 404, and a cursor
  from another session or for an unknown message gets a 400. The catalog uses the
  same owner-scoped builders as the overview. The MCP layer content-scans every
  message piece and catalog entry, and reports `withheldByContentSafety`.
- The evidence verifier checks the full stored message text, which is the same
  text the session tool pages out, over the same 200-message view
  (`REVIEW_MESSAGE_LIMIT`). The 4,000-character quote limit, owner/pipeline
  checks, 14-day message window and exact target-state checks are unchanged.
- Least-privilege grants move to four tools. A reviewer profile or schedule
  still holding exactly the v1 two-tool grants is upgraded in place, and so is an
  untouched v1 skill (matched by hash). Any other drift still fails closed and
  disables the reviewer.
- Kept from the first fix: `fitCollection` skips instead of stopping, and the
  `omittedByByteBudget` / `withheldByContentSafety` reporting.

## Alternatives

- Raise `MAX_CONTEXT_BYTES`: rejected, the engine limit is fixed.
- Sessions-first clipping in one response (this PR's first commit): superseded.
  It was lossy for long messages and still dropped configuration.
- Add a session mode to the existing read tool, so the grant set does not
  change: rejected in favor of explicit tools with single-purpose endpoints and
  signatures, which is what the user asked for.

## Consequences

The reviewer makes more calls: the overview, then session pages (failures and
errors first), then catalog pages only when it needs something that was omitted.
The skill and seed prompt describe that flow. Sessions with more than 200
messages are read and verified over their first 200 only.
