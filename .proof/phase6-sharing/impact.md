# Phase 6 sharing hardening — inferred impact

GitNexus was unavailable and explicitly waived for this task. The blast radius
below is inferred from direct callers, route wiring, schema ownership, and the
targeted tests inspected in this worktree. No test suites or servers were run.

## CRITICAL-1 — cloud-role share DDL

- Touched symbols/files:
  - `runPostgresBootstrap` in `apps/api_server/src/database/postgres_bootstrap.ts`
  - `apps/api_server/src/__tests__/phase6_sharing_postgres_bootstrap.test.ts`
- Inferred blast radius: medium. Every Postgres process executes this
  idempotent bootstrap. The production share tables, indexes, and guards now
  run before the `agentExecutionEnabled` early return. Agent-memory DDL remains
  behind the role gate because it is an agent-execution projection, not an
  always-on cloud table.
- Main risk: bootstrap SQL compatibility on existing Postgres databases. The
  statements are additive except for dropping the prior cascading
  `share_audit_log_share_id_fkey`, which is required to retain audit history.

## IMPORTANT-2 — server-derived transcript categories

- Touched symbols/files:
  - `deriveTranscriptShareReview`, `deriveCategory`, and
    `sanitizeTranscriptShare` in
    `apps/api_server/src/services/transcript_share_sanitizer.ts`
  - `SharedTranscriptsRepository.sourceTranscriptReview`
  - `SharedTranscriptsController.create`
  - sanitizer and issue #1178 tests
- Inferred blast radius: medium. Only transcript-share creation changes.
  Snapshots now contain persisted source parts rather than request-supplied
  content. Existing list/get/revoke behavior is unchanged.
- Main risk: clients must submit persisted part IDs. Legacy messages receive a
  deterministic `<message-row-id>:<part-index>` fallback ID.

## IMPORTANT-3 — secret redaction patterns

- Touched symbols/files:
  - `SECRET_PATTERNS` in
    `apps/api_server/src/services/transcript_share_sanitizer.ts`
  - `apps/api_server/src/services/transcript_share_sanitizer.test.ts`
- Inferred blast radius: low. Only transcript snapshot filtering/redaction is
  affected. More content is excluded by default or redacted after explicit
  inclusion.
- Main risk: pattern false positives may redact credential-shaped prose; that
  is the safer failure mode for sharing.

## IMPORTANT-4 — workspace authorization

- Touched symbols/files:
  - `SharedTranscriptsRepository.recipientsShareWorkspace`
  - `SharedTranscriptsController.create`
  - `apps/api_server/src/__tests__/issue_1178_transcript_sharing.test.ts`
- Inferred blast radius: medium. Share creation now requires every recipient
  to have at least one workspace membership in common with the source owner.
  Users with no established workspace boundary fail closed with HTTP 403.
- Main risk: previously accepted cross-workspace or unscoped shares are now
  rejected. Existing shares and reads are unchanged.

## IMPORTANT-5 — snapshot and audit database guards

- Touched symbols/files:
  - SQLite share schema/triggers in
    `apps/api_server/src/database/migrations.ts`
  - Postgres share schema/functions/triggers in
    `apps/api_server/src/database/postgres_bootstrap.ts`
  - direct-SQL regression coverage in the issue #1178 test
- Inferred blast radius: medium. Direct snapshot updates and audit-row deletes
  now fail at the database boundary. Share-row deletion no longer cascades to
  audit rows; application revocation remains a soft `revoked_at` update.
- Main risk: administrative scripts that attempted destructive audit cleanup
  will now fail intentionally.

## IMPORTANT-6 — append-only memory provenance ledger

- Touched symbols/files:
  - SQLite ledger triggers in `apps/api_server/src/database/migrations.ts`
  - Postgres ledger trigger function in
    `apps/api_server/src/database/postgres_bootstrap.ts`
  - `AgentMemoryRepository.appendChangeAsync`
  - `apps/api_server/src/contract/issue_1219_memory_provenance.test.ts`
- Inferred blast radius: medium. Lifecycle verification/deprecation appends
  use one `INSERT ... SELECT`, and direct ledger updates/deletes or cross-source
  rollback links are rejected. Memory recall and projection-row updates are
  unchanged.
- Main risk: any undocumented ledger-rewrite maintenance path will fail by
  design and must instead append a corrective entry.

