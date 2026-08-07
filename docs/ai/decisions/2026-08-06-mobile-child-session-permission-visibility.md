---
date: 2026-08-06
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Authorize a mobile session through its parent chain, not only its own claim

## Context

Subagent approvals never reached the phone. A subagent runs in a **child
session**, and `PermissionRequest.sessionID` names that child — not the parent
the caller started.

Ownership rows are written in exactly three places in the proxy:
`session.create`, `session.fork`, and `session.children`. A child spawned
*inside the engine* during a run travels through none of them, so it never
receives a row. `projectSessions` then filtered it out of the project's session
set, and because `projectPermissions` filters `/permission` by that set, the
child's approval was dropped. `permission.reply` for the same id failed its
membership check and returned 404.

Reproduced before fixing: with `ses-parent` claimed and an engine-spawned
`ses-child` carrying `parentID: 'ses-parent'`, the mobile permission list came
back `[]` where it should list the child's approval, and replying rejected.

This is the "agent permissioning broke when the session auth layer landed"
symptom. It is not an owner-dimension problem — the caller genuinely owns the
run; the layer just could not see that the child belonged to it.

## Decision

Authorize a session when it, or any ancestor reachable by `parentID`, carries a
claim for this caller. `ancestryAuthorizesSession` walks the chain against the
session collection already fetched for the project, bounded at
`MAX_SESSION_ANCESTRY_DEPTH = 32` so malformed or cyclic ancestry cannot spin.

The walk reads only the already-fetched collection. It issues no request
addressed to the id under test, so #1175's no-oracle contract is untouched.

Project membership is still required of the child itself — an ancestor's claim
widens *who* may address the session, never *where* it may live.

## Alternatives

- **Claim children eagerly when the engine spawns them.** Rejected: the engine
  does not notify this proxy on subagent creation, so there is no hook to claim
  from without polling.
- **Resolve the child's parent with `GET /session/{id}`.** Rejected for the
  same reason the authorization fast path rejected it — it addresses an
  unauthorized id upstream.
- **Drop the owner dimension entirely.** Rejected as not the actual defect;
  the caller already owns the run, so relaxing owner matching would not have
  made the child visible while giving up the isolation that `#1285`'s
  discovery tests assert.

## Consequences

- Subagent approvals list and reply correctly from mobile.
- A caller owning no ancestor still sees nothing, and a child whose ancestry
  leaves the project is still excluded — both asserted.
- Any session-scoped operation on a child session (transcript reads included)
  now resolves, since `projectSessionIds` feeds the same set.
- `session.children` is unchanged: listing children through the proxy already
  claims them, so that path self-heals and did not need the walk.
