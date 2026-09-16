---
date: 2026-09-11
tags: [decision, Rhythm]
---

# Detached cross-server transcript publication

## Context
Agent sources exist on the local API; recipients and shared data belong to production. E25B exact local review is necessary but a production source lookup cannot resolve that local session. Manager approved detached immutable publication on September 11. This decision supersedes only the source-deletion rule for detached cross-server copies. Historical ADRs and E25B evidence remain unchanged; source-bound local shares still require their source.

## Decision
- Local authenticated GET review remains canonical: whole-source SHA-256 and server-sanitized default/inclusive previews. Before publication, the gateway rereads that endpoint and requires the same reviewed hash. It sends only selected content from that fresh sanitized preview, never raw review content. Subsequent source changes cannot alter the already-prepared copy.
- Production authenticated POST `/shares` validates a closed envelope: review items, reviewHash, explicit inclusion IDs, named recipient IDs, optional expiry within 30 days. Production validates current recipients against the authenticated publisher's workspace, derives recognizable sensitive categories from content, and invokes the existing recursive sanitizer again. Authenticated actor owns the copy. Client category claims cannot disable secret redaction or downgrade recognized tool/file content.
- The whole-source reviewHash is retained as immutable provenance in snapshot JSON. It is **not a signature or server attestation**: production has neither the full local source nor a shared signing key and cannot verify that hash against source. Production must treat publication as user-supplied content and independently apply validation/redaction. Recognizing arbitrary prose as email/system content is not guaranteed; the local canonical review supplies those classifications for the normal product flow.
- Existing SQLite/Postgres source columns are NOT NULL. Use reserved `detached:v1` plus immutable snapshot reviewHash; project those copies publicly with `sourceSessionId: null`. Only that combination bypasses source lookup. No destructive migration/new column. Existing source-bound rows never acquire provenance and still fail closed after deletion.
- Recipient access lasts until explicit revocation or expiry, at most 30 days. Existing post-expiry/revoke retention/purge and append-only audit remain unchanged. UI explicitly discloses survival after local deletion, and shows detached copies from all sessions because they no longer have a source link.
- Only the allowlisted loopback review route receives the bearer under the E11 exclusive-runtime exception; redirects are rejected. Members/create/list/read/revoke use configured production authority.

## Alternatives
Source replication exposes unnecessary local data and adds coupling. Client-only redaction is not a trust boundary. Treating every missing source as detached silently changes existing local-share deletion semantics. All rejected.

## Consequences
Production deployment and a real cloud recipient remain separate verification work; no production contact was authorized. No local source deletion can revoke a detached copy automatically. Explicit revoke remains available from the central share list. The current Inspector requires a selected session to display that list; detached copies are visible from any selected session.
