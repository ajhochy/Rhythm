---
date: 2026-07-28
tags: [decision, rhythm]
issues: [1178]
---

# Privacy-safe transcript sharing

## Context

Agent transcripts may contain church-staff data, credentials, files, email,
Planning Center data, tool results, and hidden instructions. Rhythm needs an
internal sharing workflow without enabling OpenCode's external sharing
facilities or exposing a mutable view of the source session.

## Decision

- Recipients are named users in the same Rhythm instance. V1 has no public or
  expiring-link access.
- Shares expire after 30 days by default. The owner may revoke at any time and
  revocation takes effect on the next read.
- The caller must submit a reviewed snapshot. File contents, tool outputs,
  emails, PCO data, secret-pattern matches, and system prompts are excluded by
  default and require an explicit per-item inclusion selection. Secret-shaped
  values and host paths are still redacted inside included items.
- Every share, view, revoke, and delete event records only the share id, actor,
  action, and timestamp. The audit trail is visible to the owner.
- The owner or an administrator may revoke/delete a share.
- The stored sanitized JSON is immutable. Its source-session id is provenance,
  and reads fail closed if that source session no longer exists.

## Alternatives

- Public or expiring bearer links were rejected for v1 because they escape the
  authenticated church-staff boundary.
- A live view over the source transcript was rejected because later source
  mutations could expose unreviewed content.
- Automatic snapshot construction from an agent session was rejected because
  sharing must always include a deliberate review/redaction submission.

## Consequences

Sharing requires an authenticated user, named recipients, and explicit reviewed
content. Revocation and expiry are enforced on every read without a response
cache. Database changes are additive in SQLite and Postgres. A future Flutter
surface must implement the review, inclusion, recipient, expiry, audit, and
revocation UX; it is intentionally outside issue #1178's backend slice.
