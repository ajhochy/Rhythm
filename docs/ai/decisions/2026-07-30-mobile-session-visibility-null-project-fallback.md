---
tags: [decision, Rhythm]
---

# Mobile session visibility: treat NULL project as unrestricted, don't backfill

## Context

Issue #1279's merged fix let mobile see a desktop-created session it doesn't
have an explicit claim-table row for, by falling back to check whether
`agent_sessions.owner_user_id` **and** `project_id` match the caller. Verified
working live: a session created while a specific project was active in the
desktop app correctly appeared on mobile in both directions.

Re-verifying against the user's real data surfaced a gap: every one of the
user's ~2,241 real historical sessions has `project_id` NULL. Live testing
confirmed this is not stale data waiting to be backfilled — a brand-new
session created from desktop's "All Sessions" view *tonight*, in the current
code, also got `project_id` NULL. A session created while inside a specific
project got a real `project_id` and worked correctly with the merged fix.

So "All Sessions" mode is, today, genuinely project-agnostic by design (or
at least by current behavior) — it does not represent a project that was
simply never recorded.

## Decision

Widen the ownership fallback to treat a NULL `project_id` on the
`agent_sessions` row as "not project-restricted," rather than running a
one-time data backfill to stamp a project onto historical rows.

The `owner_user_id` check stays exactly as strict as it already is (exact
match only, no fallback) — that is the only thing enforcing the two-account
isolation the #1175 contract test guards (this user and a second paired test
account on the same Mac must never see each other's sessions). Widening only
the project dimension, never the owner dimension, keeps that guarantee
intact.

## Alternatives considered

**Backfill `project_id` on historical rows.** Rejected: it treats this as a
one-time data-quality problem, but "All Sessions" mode keeps producing new
NULL-project rows today. A backfill would need to be re-run indefinitely and
would still be wrong for every session created between backfills — it fixes
a symptom, not the actual behavior.

**Force "All Sessions" to bind a project at creation time.** Considered but
not chosen for this fix: it changes desktop's own session-creation UX/schema
semantics for what may be an intentionally project-agnostic mode, a bigger
and more invasive change than the visibility check needs to be. Left as a
possible future improvement, not required to solve #1279.

## Consequences

- Mobile becomes able to see essentially all of the user's real chat
  history, not just sessions created inside a specific project context.
- The two-account isolation guarantee (#1175) is unaffected — verified by
  keeping owner matching exact and unconditional.
- A NULL-project session remains invisible to any *other* owner regardless
  of their currently active project — the fallback only ever answers "is
  this the same owner," project only ever narrows further, never widens
  across owners.
- This is a Codex prompt handed off, not yet built as of this log — see
  [runs/2026-07-30-live-smoke-and-merge-night.md](../runs/2026-07-30-live-smoke-and-merge-night.md).
