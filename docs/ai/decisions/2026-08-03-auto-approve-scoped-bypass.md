---
date: 2026-08-03
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Scoped auto-approve bypass for the `librarian` profile

## Context

Memory Consolidation (`librarian` profile, daily 02:30 PT) has captured zero
memories for 2+ days. Root cause: it reads agent session transcripts, which
get wrapped in `UNTRUSTED EXTERNAL DATA` framing, which arms the security
gate and turns the subsequent `rhythm_remember_memory` write into a protected
approval nobody is awake to grant at 2:30am. AJ hit this live and objected
that the transcripts were first-party local data, not external content.

`agent_configs.auto_approve_actions` already existed in the schema
(migrations.ts) and was already honored at runtime by
`isAutoApproveProfile()`, but was never exposed through the REST API or the
profile editor UI — settable only by raw SQL, which is forbidden (the running
server holds `rhythm.db` open).

## Decision

Expose `auto_approve_actions` as `autoApproveActions` on `GET/PATCH
/agent-configs/:id` and the Flutter profile editor (PR #1303), and set it
`true` on the `librarian` profile specifically. This is a deliberate,
per-profile security-gate bypass, confirmed explicitly by AJ in-session
(2026-08-03) after a security-scanner flag on the implementing subagent's
output — the flag was a false positive because it only saw a relayed quote
from a past session transcript and missed the live authorization in the
current one.

Default stays `false` for every other profile. The audit trail is preserved:
`isAutoApproveProfile()` still writes `actor='auto-approved'` on the approval
row, so an auto-approved action remains visible in history, just not blocking.

## Alternatives

- **Fix trust classification instead** (distinguish first-party session
  transcripts from genuinely external content so the gate never fires for
  Rhythm's own data) — more correct long-term, but broader security surface.
  Filed as issue #1302, explicitly as follow-up work, not a replacement for
  this bypass.
- **Leave it broken** — rejected; memory capture had been silently dead for
  days while reporting `success` (see companion fix in PR #1303 for honest
  `blocked_on_approval`/`completed_no_op` statuses).

## Consequences

`librarian` can now write memories unattended. Any other profile that needs
the same treatment must have `autoApproveActions` set explicitly per-profile
— there is no global bypass. The follow-up in #1302 remains open; this
decision does not close the underlying trust-classification gap, it only
unblocks the one profile that was silently failing.
