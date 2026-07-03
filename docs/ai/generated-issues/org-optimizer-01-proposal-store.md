# org-optimizer-01: Proposal store + lifecycle

## Goal

Create the `agent_org_proposals` table (local SQLite agent DB only), a typed
repository, and the proposal status state machine. This is the foundational
store every generator and the review queue write to.

## Context

Per the decision doc `docs/ai/decisions/2026-06-29-org-self-optimizer-cron.md`,
the org optimizer never applies a change directly — every change is a proposal
row whose lifecycle and revert mechanics mirror the `agent_skills` sidecar
(`draft→measuring→active|reverted`) plus a `before_snapshot_json` rollback payload.
The agent DB is **local SQLite only** (matches `agent_skills`,
`agent_scheduled_tasks`, `agent_webhook_endpoints`); do NOT add this table to
`postgres_bootstrap.ts`.

## Likely files

- `apps/api_server/src/database/migrations.ts` (SQLite CREATE TABLE + indexes)
- NEW `apps/api_server/src/repositories/agent_org_proposals_repository.ts`
- NEW `apps/api_server/src/models/agent_org_proposal.ts`

## Acceptance Criteria

- [ ] `agent_org_proposals` created in `migrations.ts` with columns: `id`,
  `audit_run_id`, `kind`, `risk`, `external`, `status`, `title`, `rationale`,
  `signal_ref`, `target_ref`, `change_json`, `before_snapshot_json`,
  `provenance_json`, `dedup_key`, `baseline_score`, `post_score`,
  `measure_reason`, `decided_by_user_id`, `created_at`, `updated_at` (see decision
  doc §5 for the exact DDL).
- [ ] Indexes: `idx_org_proposals_status` on `status`; UNIQUE
  `idx_org_proposals_dedup` on `dedup_key`.
- [ ] NOT added to `postgres_bootstrap.ts` (assert by inspection / a test that the
  table is absent there).
- [ ] `AgentOrgProposal` TS interface matches all columns with fromJson/toJson.
- [ ] Repository methods: `createAsync(input)`, `findByIdAsync(id)`,
  `listByStatusAsync(status)`, `listProposedAsync()` (the queue feed),
  `existsByDedupKeyAsync(key)`, `updateStatusAsync(id, status, patch?)`.
- [ ] Status transitions enforced/validated: `proposed → approved|rejected`,
  `proposed|approved → applied → measuring → active|reverted`. Illegal transitions
  rejected.
- [ ] Inserting a duplicate `dedup_key` is a no-op/skip (idempotency), not a crash.

## Required tests

- `agent_org_proposals_schema_contract`: columns + unique dedup index present in
  SQLite; absent in Postgres bootstrap.
- repo CRUD + dedup contract: create/find/list-by-status; duplicate dedup_key
  skipped; illegal status transition rejected.

## Dependencies / order

First issue. No deps.

## Safety notes

Local SQLite only — never synced to production, no user-facing app data touched.
`change_json` and `before_snapshot_json` are opaque payloads validated by the
generators, not here.
