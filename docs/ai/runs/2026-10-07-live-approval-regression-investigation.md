---
date: 2026-10-07
repo: Rhythm
branch: codex/coordinator-conversation-20261007
pr: "https://github.com/ajhochy/Rhythm/pull/1610 (stacked on #1604)"
issues: []
status: pending
tags: [run, rhythm, approvals, investigation]
---

# Live approval regression investigation

Draft PR: [#1610](https://github.com/ajhochy/Rhythm/pull/1610) with product commit `30f51138`, stacked on #1604. No merge or install occurred.

## Scope

Read-only review of the currently running signed desktop candidate, its active
SQLite/WAL state, renderer provenance, repository history, and persisted tool
metadata. No approval was requested, approved, rejected, or consumed; no UI was
opened after the Computer Use observation was corrected to a different app copy.
Normal PIDs 8192, 8198, and 8242 remained unchanged.

## History and installed provenance

- `9fa2761e` (2026-08-15, #1393) introduced inline and native approval delivery.
- `c3961b02c1c89f21b474b284ec97b5db12d62ca6` added approval-queue refresh/error
  presentation. It is an ancestor of the signed installed candidate and is not
  an ancestor of C17.
- `5c366674` (2026-10-06) introduced the signed bounded-workflow proposal path,
  including direct creation of a pending `agent_approvals` row only after its
  foreground, source, and plan-root checks pass.
- Signed candidate `237f54db60bb0f58f42e8f0fbce3b1069a70c652` is a descendant of
  C17 and contains the queue refresh fix. Root verified the packaged renderer
  asset SHA-256 `e291f5a0927875f9c25ee90ab950060efb01e548ac881bc952125fae7ca37714`.
  The source comparison records unchanged Flutter approval renderer/API-route
  blobs from C17 to the installed candidate, and unchanged web shell/store and
  approval-gateway blobs; only the unrelated web transcript blob differs.

The exact provenance and renderer markers are in
[`live-approval-renderer-provenance-20261007.json`](../evidence/live-approval-renderer-provenance-20261007.json).
It confirms the installed renderer contains `Refresh approvals`,
`approval-queue-status`, and the preserved-card warning text. It does not prove
an authenticated nonempty queue rendered in the correct desktop app.

## Active evidence

PID 8198 holds the WAL-aware active Electron database at
`~/Library/Application Support/Rhythm Electron/rhythm.db`; the read used
SQLite `mode=ro`, not an immutable snapshot. At the observation point, the
newest approval card was `2026-10-06T13:31:07Z`; there were no pending rows, no
cards in the preceding 24 hours, and 26 cards in the preceding seven days.

The live `Rhythm Coordinator` session `90af1132-780…` uses the Secretary
profile (configured `anthropic/claude-sonnet-5-5`) with a persisted fixed
`anthropic/claude-opus-5-5` session model. It is also
`bypassPermissions` with `approval_bypass_explicit=1`. Its tool event history
contains one generic `rhythm_request_approval` call at `2026-10-07T15:20:04Z`
(08:20 PT; 24 ms), but its response is not recoverable from persisted metadata
and it created no row. Timing correction: this record predates the current
PID 8192 launch at `2026-10-07T18:14:56Z` (11:14 PT), so it cannot be
attributed to the current signed `237f` bundle. It contains zero bounded
proposal calls and zero bounded start calls. Therefore no evidence shows the
current live Coordinator reached either the bounded proposal creator or a
pending-card renderer.

Root also made read-only engine requests to `http://127.0.0.1:4096/permission`
and `/question`: both returned HTTP 200 with empty arrays for the default
context and when given this Coordinator session's persisted CWD. This is narrow
current queue evidence only; it does not establish that no other CWD or session
has a pending engine permission or question.

## Limits and next evidence

The fixed-root/profile-equality problem introduced with C17 is independently
confirmed in the P2 sandbox: a plan-mode, non-bypass fixed Opus root against the
Secretary Sonnet default held two bounded proposals before card creation. The
working candidate permits only that persisted fixed override and Q3 created
sandbox cards. This is separate from the current live session, which has an
explicit bypass and did not invoke the bounded proposal tool; it does not
establish the cause of the user's live observation.

No UI regression is proven, and no card-creation regression is proven. The
remaining clarification is the exact chat and time the user expected an
approval card, plus whether the expected mechanism was the generic approval
request, an engine permission, or the bounded Coordinator workflow. Any future
rendering check needs the correct signed candidate, authenticated human access,
the human-approval capability, and a legitimate pending card; no agent may
create or decide one in the running app.
