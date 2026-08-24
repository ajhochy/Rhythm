---
date: 2026-08-20
repo: rhythm
branch: agent-stack/si-d4-auto-promotion-sonnet
pr: null
issues: [1439]
status: complete
tags: [run, rhythm]
---

## Files

- `apps/api_server/src/models/promotion_trust_state.ts` (new)
- `apps/api_server/src/repositories/promotion_trust_state_repository.ts` (new)
- `apps/api_server/src/repositories/promotion_trust_state_repository.test.ts` (new)
- `apps/api_server/src/database/migrations.ts` (additive — `promotion_trust_state` CREATE TABLE IF NOT EXISTS; repair pass added `CHECK (id = 'promotion_trust_state')` to the `id` column, see Repair below)
- `apps/api_server/src/database/postgres_bootstrap.ts` (additive parity — matching CREATE TABLE; repair pass added the matching CHECK)
- `apps/api_server/src/__tests__/promotion_trust_state_schema_parity.test.ts` (new)
- `docs/ai/contracts/issue-1439.json`

## Checks

- RED: `cd apps/api_server && npx vitest run src/repositories/promotion_trust_state_repository.test.ts` before the migration existed — 3/3 failed with `SqliteError: no such table: promotion_trust_state`.
- GREEN after adding the migration + repository: `cd apps/api_server && npx vitest run src/repositories/promotion_trust_state_repository.test.ts src/__tests__/promotion_trust_state_schema_parity.test.ts` — 4/4 pass.
- Adjacent regression: `cd apps/api_server && npx vitest run src/__tests__/migrations_replay_guard.test.ts` — 3/3 pass (additive migration does not disturb the existing content-rewrite guard).
- `cd apps/api_server && npx tsc --noEmit` — pass.
- `cd apps/api_server && npm run build` — pass.
- `git diff --check` — clean.
- Added-line secret/security scan (grep the diff for secret/token/password/api-key/credential/connection-string patterns) — no hits.
- GitNexus impact: the index registered under this session could not be bound to this worktree — `impact --repo "<exact string copied from the tool's own `list` output>"` for the `integration` and `d2-post-apply-lifecycle` aliases both returned "Repository not found" even with byte-identical strings (tool-level friction, not a code-risk signal). Recorded UNKNOWN per the operating instructions and substituted direct caller inspection: `grep` for every call site of the two edited existing functions (`runMigrations`, `runPostgresBootstrap`) confirms the change is additive-only — a `CREATE TABLE IF NOT EXISTS` block appended at the end of each function body, no existing statement touched. This matches the task's documented known-base pattern (prior org_settings/tool_events additive migrations in the same file, LOW risk).
- Sandbox: not used. No HTTP/WS/MCP entry point is wired to this model/repository yet — the reading/gating surface is a later D4 issue, explicitly out of scope for this wave. Per AGENTS.md's live-behavioral-test gate, there is no entry point to drive.

## Notes

- Singleton is enforced the same way `OrgSettingsRepository`/`org_settings` already does in this codebase: a fixed primary-key id (`'promotion_trust_state'`) plus `INSERT ... ON CONFLICT(id) DO NOTHING`, so every access — first or repeated, concurrent or not — targets the one row.
- `updateAsync` is a generic partial update (any subset of the 5 domain fields) so a later D4 issue can flip `auto_promotion_enabled`/`enabled_at` through the same repository without a new method. Nothing in this issue calls it with those two fields.

## Repair (D4 focused repair pass, 2026-08-20)

**Blocking finding A — corrects an overclaim above.** "Singleton enforced (exactly one row)" was true only through `PromotionTrustStateRepository` — the table itself was `id TEXT PRIMARY KEY` with no other constraint, so a raw `INSERT` with a different id created a second row. The database was not actually enforcing the singleton; only repository discipline was.

- Fix: added `CHECK (id = 'promotion_trust_state')` to the `id` column in both `apps/api_server/src/database/migrations.ts` and `apps/api_server/src/database/postgres_bootstrap.ts`'s `CREATE TABLE promotion_trust_state` statements. This table exists only on this not-yet-integrated branch, so editing its own fresh CREATE TABLE (rather than a destructive ALTER/backfill on an already-shipped table) preserves the additive-migration policy.
- Test added: `promotion_trust_state_repository.test.ts` ('repair (blocking finding A): the schema itself rejects a second row, not just the repository') — a raw `db.prepare(INSERT ...).run()` with `id='some-other-id'`, asserted to throw.
- RED: `expected [Function] to throw an error` — the raw insert succeeded before the CHECK was added.
- GREEN: `cd apps/api_server && npx vitest run src/repositories/promotion_trust_state_repository.test.ts src/services/__tests__/trust_counter_service.test.ts src/__tests__/promotion_trust_state_schema_parity.test.ts src/__tests__/migrations_replay_guard.test.ts` — 16/16 pass.
- `promotion_trust_state_schema_parity.test.ts`'s column-set assertion is unaffected: its Postgres-source parser already skips `CHECK`/`PRIMARY`/`FOREIGN`/`UNIQUE`/`CONSTRAINT` lines, and the inline `CHECK` on the `id` column line does not change that line's extracted column name.
- `npx tsc --noEmit` — pass. `npm run build` — pass. `git diff --check` — clean. Added-line secret scan — no hits.
- GitNexus: `gitnexus detect-changes --repo d4-auto-promotion` still errors "Repository not found" — this worktree's alias remains unindexed. UNKNOWN, unchanged from the original run.
- Did not implement #1441–#1444; no server was started; no destructive git operations were run.
