# Issue #1178 inferred blast radius

GitNexus analysis was explicitly waived by the orchestrator. This assessment
is inferred from the existing imports, router mounts, database access patterns,
and new symbols.

## Risk

Moderate. The change is additive, but it introduces authenticated access to
privacy-sensitive snapshots and touches both database bootstrap paths.

## Directly affected

- `runMigrations` and `runPostgresBootstrap`: create two additive tables and
  indexes. No existing table or row is rewritten.
- `createApp`: mounts the new authenticated `/shares` router inside the existing
  agent-execution route group.
- `transcriptShareCreationRouter`: adds the authenticated, always-on
  `POST /agent-sessions/:id/shares` review-submission route without exposing
  the rest of the local agent-session router in cloud deployments.
- New share controller/repository/sanitizer: create, list, read, audit, and
  revoke immutable snapshots.

## Upstream callers / flows

- API process startup invokes the SQLite or Postgres bootstrap.
- Authenticated HTTP clients can enter the new routes.
- `requireAuth` and the existing session/user repositories resolve the actor.
- The new repository uses the existing SQLite/Postgres database accessors.

## Security-sensitive boundaries

- Every list/read path scopes by the authenticated actor.
- Single-share reads re-check source existence, expiry, revocation, owner, and
  recipient membership on every request.
- Owner/admin authorization is checked before revocation.
- Audit rows contain ids/actions/timestamps only, never snapshot content.
- The snapshot comes only from a caller-supplied review payload; there is no
  engine/session auto-share path.

## Expected non-impact

- No existing API response or table is changed.
- No desktop, web, mobile, MCP-server, or vendored OpenCode files are touched.
- Source-session deletion is unchanged; it only causes future share reads to
  fail closed because provenance is not a live foreign key.
