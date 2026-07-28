# OCU-35C — Build privacy-safe transcript sharing inside Rhythm

**Type:** feature / privacy / security · **Priority:** deferred
**Supersedes:** the session-share portion of #1076
**Depends on:** approved church-staff sharing policy, retention policy, and
product decision for recipients and revocation

## Summary

Let an authorized Rhythm user share a deliberately selected, sanitized agent
transcript with approved recipients inside Rhythm. Never enable OpenCode's
external `opncd.ai`/enterprise share path or `OPENCODE_AUTO_SHARE`; church
staff data stays inside Rhythm's authenticated production boundary.

## Product decisions required

Before implementation, record:

- allowed recipient scope (same organization, named users, or expiring link);
- default expiration and retention;
- whether files, tool output, emails, PCO data, secrets, and system prompts are
  excluded or require explicit per-item inclusion;
- audit visibility and who can revoke/delete a share.

## Acceptance criteria

1. Sharing is opt-in per transcript and presents a review/redaction step before
   publication; no automatic or implicit sharing path exists.
2. The backend creates an immutable sanitized snapshot with owner, recipient
   scope, created/expiry/revoked timestamps, and source-session provenance.
3. Recipient authorization is checked on every list/read/download operation.
   Guessed IDs, revoked links, expired links, cross-organization users, and
   deleted source sessions fail closed.
4. A deterministic sanitizer removes credentials, authorization headers,
   secret-shaped values, host filesystem paths, hidden/system instructions,
   disallowed tool payloads, and excluded attachments before bytes are stored
   or transmitted.
5. Owners can revoke immediately; revocation invalidates cached/download
   access and is durably audited without logging transcript content.
6. The UI clearly distinguishes the private source session from its shared
   snapshot and displays recipients, expiration, exclusions, and revocation
   state.
7. `OPENCODE_AUTO_SHARE` and external OpenCode share endpoints remain disabled
   and are guarded by regression tests/config checks.

## Likely files

- `apps/opencode_fork/packages/opencode/src/share/` (reference/disable guard only)
- `apps/api_server/src/services/`
- `apps/api_server/src/repositories/`
- `apps/api_server/src/controllers/`
- `apps/api_server/src/routes/`
- `apps/api_server/src/database/postgres_bootstrap.ts`
- `apps/desktop_flutter/lib/features/agents/`
- `apps/mobile/` (only after desktop/backend policy is proven)
- `docs/ai/architecture.md`
- `docs/ai/decisions/`

## Required tests / evaluation

- Sanitizer golden tests containing representative credentials, host paths,
  system prompts, PCO/email payloads, attachments, and nested tool output.
- Authorization matrix for owner, permitted recipient, unrelated user,
  cross-org user, expired share, and revoked share.
- Real HTTP behavioral test proving the stored and downloaded bytes contain no
  disallowed content and revocation takes effect immediately.
- Postgres/SQLite schema-parity coverage and retention/expiry job tests.
- Desktop accessibility/widget smoke for preview, explicit confirmation, share,
  recipient read, and revoke.
- Security/privacy review plus a secret scan of generated fixtures and logs.

## Safety / out of scope

- No external OpenCode share service, public-by-default links, or auto-share.
- No live-source view that changes after review; recipients receive the frozen
  sanitized snapshot only.
- No sharing of attachments or tool payloads until their individual policy is
  approved and tested.
- No destructive deletion of the source transcript when a share is revoked.
