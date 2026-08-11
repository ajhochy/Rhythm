---
tags: [decision, Rhythm]
---

# OCU-35C (#1178) — transcript-sharing policy decision sheet, 2026-08-10

## Context

Issue #1178 (privacy-safe transcript sharing inside Rhythm) requires four
product decisions to be recorded before the feature is considered
policy-approved: recipient scope, expiration/retention, content exclusions, and
audit/revocation authority.

Important: a backend implementation already exists and enforces conservative
defaults today —
`apps/api_server/src/controllers/shared_transcripts_controller.ts`,
`apps/api_server/src/services/transcript_share_sanitizer.ts`,
`apps/api_server/src/routes/shared_transcripts_routes.ts`,
`apps/api_server/src/repositories/shared_transcripts_repository.ts`, with tests
in `apps/api_server/src/__tests__/issue_1178_transcript_sharing*.test.ts`.
What is missing is the recorded human approval of the policy those defaults
encode. This sheet is that approval instrument: each row below states the
recommended default (matching current code where implemented) and is marked
PENDING APPROVAL. Approving ratifies current behavior; amending a row implies a
code change.

## Decision — four policy rows, each PENDING APPROVAL

### D1 — Recipient scope · **PENDING APPROVAL**

**Recommended default: same-organization named Rhythm users only.** No
expiring/anonymous links, no cross-organization recipients, no public URLs.
Already enforced: share creation requires at least one named recipient, every
recipient must be an existing Rhythm user, and all recipients must belong to
the source owner's workspace (controller lines 52–70:
`'At least one named recipient is required'`,
`'Every recipient must be a Rhythm user'`,
`'Transcript recipients must belong to the source owner workspace'`).

### D2 — Expiration and retention · **PENDING APPROVAL**

**Recommended default: 30-day expiry.** Owner may set an explicit earlier or
later future date at creation; expired shares fail closed on every read.
Already enforced: `DEFAULT_EXPIRATION_MS = 30 * 24 * 60 * 60 * 1000`
(controller line 11); `activeForRead` rejects expired or revoked shares
(lines 37–39); non-future `expiresAt` is rejected.
**Retention (not yet implemented, needs the same approval): keep expired and
revoked snapshots inaccessible but stored for 90 days for audit, then purge the
snapshot; retain the audit log.** The source transcript is never deleted by
share lifecycle (per issue safety section).

### D3 — Content exclusions · **PENDING APPROVAL**

**Recommended default: all sensitive categories excluded by default, explicit
per-item opt-in required.** Already enforced: `EXCLUDED_BY_DEFAULT` covers
`file_content`, `tool_output`, `email`, `pco_data`, `system_prompt`, and
`attachment` (sanitizer lines 31–38); inclusion requires the item's id in
`explicitlyIncludedItemIds` at review time. Independent of opt-in, the
deterministic sanitizer always redacts secret-shaped values (keys, JWTs, AWS
keys, connection strings, auth headers, cookies — `SECRET_PATTERNS`,
lines 40–51) and host filesystem paths (`HOST_PATH_PATTERNS`, lines 53–57);
this redaction layer is non-optional and not subject to opt-in.

### D4 — Audit visibility and revocation authority · **PENDING APPROVAL**

**Recommended default: owner + admin revocation, immediate effect, durable
audit.** Already enforced: `DELETE /:id` revokes and is permitted only to the
share owner or an admin/system role (controller lines 142–155); revoked shares
fail closed instantly via `activeForRead`; every recipient view is durably
audited (`repo.audit(share.id, actorId, 'view')`, line 132) and the owner —
only the owner — sees the audit trail on read (lines 133–135). Audit records
never contain transcript content.

Standing constraint reaffirmed (not a decision): `OPENCODE_AUTO_SHARE` and the
external OpenCode `opncd.ai`/enterprise share path stay disabled permanently;
church-staff data never leaves Rhythm's authenticated production boundary.

## Alternatives

- Expiring tokenized links for non-Rhythm recipients — rejected as default:
  breaks the named-recipient authorization model and the fail-closed guarantees
  on every read.
- No expiry / indefinite shares — rejected: violates the conservative retention
  posture for church-staff data; 30 days forces deliberate re-sharing.
- Per-category blanket opt-in (e.g. "include all tool output") — rejected:
  per-item opt-in keeps the review step meaningful.

## Consequences

Once all four rows are approved, #1178's "Product decisions required" gate is
satisfied and the remaining acceptance criteria (UI distinction, retention job,
remaining test matrix) can be scheduled against a fixed policy. If any row is
amended, the corresponding controller/sanitizer behavior must change first.

Human action (one line): **Reply "approved" on this sheet (or amend specific
rows D1–D4) to ratify the four sharing-policy defaults #1178 requires — the
backend already enforces D1, D3, D4 and the 30-day expiry in D2; only the
90-day post-expiry purge is net-new.**
