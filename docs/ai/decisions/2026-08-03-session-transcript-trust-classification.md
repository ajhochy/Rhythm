---
date: 2026-08-03
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Session-transcript reads no longer arm the outbound approval gate (#1302)

## Context

Issue #1302 asked for the "more correct" long-term fix behind the scoped
`librarian` auto-approve bypass
([decisions/2026-08-03-auto-approve-scoped-bypass.md](2026-08-03-auto-approve-scoped-bypass.md)):
`rhythm_list_sessions` (the `agent-session.list` source, in
`apps/mcp_server`) was treated identically to genuinely external sources
(gmail, web, PCO) — every read armed the outbound-write approval gate, even
though the content is Rhythm's own first-party session transcripts, not
attacker-reachable external data.

## Decision

Added `SOURCES_EXEMPT_FROM_APPROVAL_GATE` in
`apps/mcp_server/src/security/external_content_boundary.ts`, containing only
`agent-session.list`. `scanContextContentAndRecordExternalContentTaint`
skips the `recordExternalContentTaint` call for exempt sources but keeps
running the injection-pattern scanner and keeps wrapping the result in the
same `untrustedContext()` "treat as data, not instructions" fence as every
other source. If the calling session is already tainted from a genuinely
external read earlier in the same turn, that taint is left untouched — this
only skips *adding* new taint for a first-party read, it never clears
existing taint.

This unblocks every profile that reads session transcripts (not just
`librarian`), and the existing scoped bypass in PR #1303 becomes redundant
once this is live-verified (not removed in this pass — leaving both in
place is harmless, and the scoped bypass instructions in
`docs/ai/decisions/2026-08-03-auto-approve-scoped-bypass.md` still apply
until it's confirmed to be).

## Alternatives considered

**Transitive taint propagation** — flag a session in a durable store
whenever it is ever exposed to genuinely external content, and have
`rhythm_list_sessions` check the *target* session(s)' historical flag before
deciding whether to skip tainting the *calling* session. This would guard
against a hypothetical where an earlier session ingests attacker-controlled
content that evades the injection scanner, sits dormant in that session's
stored transcript, and only "detonates" when a later, less-supervised agent
(e.g. an unattended 2:30am consolidation job) reads it via
`rhythm_list_sessions`.

Rejected as unnecessary scope for this fix: the content scanner
(`scanContextContent`) already runs, and the untrusted-content fence is
already applied, at first ingestion — before anything is ever persisted to
a transcript. A second read via `rhythm_list_sessions` doesn't expose
anything that wasn't already scanned and fenced the first time; it isn't a
new attack surface, just a second look at already-vetted bytes. Building a
full lineage-tracking system to guard against a scanner false-negative that
already exists as a risk on the *first* read would be disproportionate to
the actual problem (a nightly job that couldn't complete unattended) and
was explicitly flagged as the "broader security surface" the original
`librarian` bypass decision deferred.

**Do nothing, keep only the per-profile bypass** — rejected; it only
unblocks profiles someone remembers to flip `autoApproveActions` on for,
and doesn't fix the underlying misclassification for every future job that
reads session transcripts.

## Consequences

Every profile can now read agent session transcripts without human approval
being required for whatever write follows, as long as nothing genuinely
external was also read in the same turn. Genuinely external sources
(email, web, PCO, etc.) are completely unaffected — they still arm the gate
exactly as before. If a future need arises to treat some *other* source as
first-party (e.g. a new Rhythm-internal read), extend
`SOURCES_EXEMPT_FROM_APPROVAL_GATE` deliberately, one source at a time — do
not widen the exemption to any source that touches genuinely external
systems.
