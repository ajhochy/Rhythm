---
date: 2026-08-20
repo: Rhythm
branch: codex/mega-f-purge-only
pr: null
issues: [1375]
status: verified
tags: [run, Rhythm]
---

## Contract

- Contract: `docs/ai/contracts/issue-1375.json`
- Red command before implementation:
  `cd apps/api_server && npx vitest run src/__tests__/issue_1375_transcript_share_retention.test.ts src/__tests__/issue_1375_transcript_share_retention_postgres.test.ts src/__tests__/issue_1375_transcript_share_purge_startup.test.ts --no-file-parallelism`
- Red result: 9 failed, 2 skipped. The repository omitted a default expiry, `purgeDueSnapshots` and the job module were missing, and `server.ts` had no purge wiring.
- Acceptance correction red command:
  `cd apps/api_server && npx vitest run src/__tests__/issue_1375_transcript_share_retention.test.ts --no-file-parallelism`
- Acceptance correction red result: the new authenticated `POST /agent-sessions/:id/shares` assertion failed because the public controller returned a 30-day default (`2,592,000,028 ms` observed from the pre-request clock) where the test required 90 days. Three purge/repository tests remained green.
- Green result for the same command: 9 passed, 2 Postgres tests skipped unless the live disposable-Postgres flag is set.
- Contract invariant: `5 criteria; 4 pass; 1 manual explicitly not_tested`.

## Files

- `apps/api_server/src/repositories/shared_transcripts_repository.ts`
- `apps/api_server/src/controllers/shared_transcripts_controller.ts`
- `apps/api_server/src/jobs/transcript_share_purge_job.ts`
- `apps/api_server/src/server.ts`
- `apps/api_server/src/__tests__/issue_1375_transcript_share_retention.test.ts`
- `apps/api_server/src/__tests__/issue_1375_transcript_share_retention_postgres.test.ts`
- `apps/api_server/src/__tests__/issue_1375_transcript_share_purge_startup.test.ts`
- `docs/ai/contracts/issue-1375.json`
- `docs/ai/runs/2026-08-20-transcript-share-purge-only.md`

## Production proof

- Repository fallback expiry is exactly 90 days when `expiresAt` is omitted.
- The authenticated create-share controller uses that same repository constant, and its returned `expiresAt` exactly matches the persisted `expires_at`; the route-level clock envelope proves a 90-day delta within the request duration.
- Purge cutoff is exactly 30 days before the supplied/current time.
- Postgres path executes `BEGIN`, selects due rows with `FOR UPDATE`, inserts the content-free delete audit before deleting each `shared_transcripts` row, commits on success, and rolls back on any failure.
- SQLite uses one `better-sqlite3` transaction with the same audit-before-delete order.
- Neither purge query joins, updates, nor deletes `agent_sessions` or `agent_session_messages`.
- Job performs one boot sweep plus one unref'd daily timer and logs counts only.
- Startup delegates once through a helper requiring all three gates: `VITEST !== 'true'`, flag exactly `true`, and Postgres.

## Checks

- `node_modules/.bin/tsc --noEmit` — pass.
- `npm run build` — pass, including postbuild.
- Focused route-level correction — 4/4 pass; the full corrected test file completed in 104 ms.
- Corrected contract plus the existing transcript-sharing route regression — 17 pass, 2 env-gated Postgres tests skipped.
- Startup matrix verbose — 5/5 pass: VITEST true `0`, flag false `0`, SQLite `0`, all enabled `1`, server wiring present.
- `npx vitest run src/__tests__/issue_1178_transcript_sharing.test.ts src/__tests__/issue_1178_transcript_sharing_live.test.ts --no-file-parallelism` — 8 pass, 1 env-gated live test skipped.
- Combined focused transcript suite — 17 pass, 2 env-gated Postgres tests skipped.
- Disposable Postgres command used a random Docker container name, dynamically mapped loopback port, and `trap cleanup EXIT INT TERM`, then ran:
  `RHYTHM_LIVE_POSTGRES_RETENTION=1 RHYTHM_LIVE_POSTGRES_URL="$url" npx vitest run src/__tests__/issue_1375_transcript_share_retention_postgres.test.ts --no-file-parallelism`
  Result: 2/2 pass. Evidence covers due expiry, due revocation, recent survival, NULL/NULL survival in a test-only nullable table, byte-identical source rows, content-free audit shape, second run `0`, and induced-audit-failure rollback with both rows and zero delete audits retained.
- `npm test -- --no-file-parallelism` — repository-wide result: 4,480 pass, 170 skip, 8 fail across 6 unrelated pre-existing suites (`memory_injection`, `memory_index_rebuild`, issue 1219 memory provenance, `tasks_permissions`, issue 1135 audit lock, and `delegation_caller_identity`). No transcript-retention test failed. The shell inherited `AGENT_LOCAL` and `MEMORY_VAULT_PATH`; no out-of-scope fixes were made.
- `git diff --check` — pass.
- Scope invariant — pass: the only controller change is its existing default-expiration constant; no schema, Flutter, route, reviewHash, publication, signing, attestation, migration, or batching file/line was added.
- GitNexus pre-edit symbol lookups returned `UNKNOWN` because the current index did not contain `SharedTranscriptsRepository` or `server.main`; no HIGH/CRITICAL result occurred. Final compare reported low risk, 2 tracked changed files, 0 indexed changed symbols, and 0 affected processes.

## Cleanup and rollout

- Docker filter `name=rhythm-issue-1375` was empty after the trap ran.
- Tests never started API/engine processes. Existing protected listeners remained untouched: Node on `127.0.0.1:4001` and OpenCode on `127.0.0.1:4096`.
- No production database or production connection string was used.
- Before enabling `RHYTHM_TRANSCRIPT_SHARE_PURGE_ENABLED`, count due rows and review the backlog. If the backlog is large, leave the flag off and implement a follow-up with bounded `SKIP LOCKED` batches; batching is intentionally absent here.

## Scope note

- The existing public controller default now references the repository's 90-day fallback constant, preventing the two defaults from drifting. No other controller line changed.
- No #1425 review route, controller, publication, reviewHash, sharing UI, or Flutter work is included.

## Independent final verification gate

- Verified branch/head: `codex/mega-f-purge-only` at `f0bf3003d9c39432fcbe166a881f669c42bb001e`.
- Authenticated real HTTP create-share probe observed default expiry
  `2026-11-18T20:46:07.443Z`: `7,776,000,282 ms` after the pre-request clock
  and `7,775,999,991 ms` after the post-request clock across a `291 ms`
  request window. The returned and persisted values were equal. An explicit
  expiry `2026-10-01T20:46:08.687Z` was returned and persisted exactly.
- Disposable `postgres:16` container
  `rhythm-issue-1375-gate-77891-2304` used loopback port `63067` with trap
  cleanup. Both destructive Postgres tests passed; the container and listener
  were absent afterward.
- Destructive assertions passed for due expiry/revocation deletion and
  content-free audits, second-purge zero, byte-identical source session/message
  rows, recent-expiry survival, NULL/NULL survival, and full rollback after an
  induced mid-transaction audit failure.
- Runtime timer probe observed one boot sweep, interval `86,400,000 ms`, one
  `unref`, and one stop/clear. The startup matrix independently observed
  VITEST=true `0`, flag=false `0`, SQLite `0`, and all-enabled Postgres `1`.
- Independent SQL inspection confirmed `BEGIN` → due-row `FOR UPDATE` →
  content-free audit insert → delete only from `shared_transcripts` → `COMMIT`,
  with `ROLLBACK` on failure. The intentionally unbounded query has no `LIMIT`;
  this is a rollout risk, not an acceptance blocker.
- `tsc --noEmit`, `npm run build`, focused #1375 tests, and #1178 transcript
  sharing regressions passed. Full serialized API tests reported 4,483 pass,
  170 skip, and five failures in three unrelated memory suites. The same five
  assertions also failed on `main` (`245860e81eaf9e8ef9ef9806ced7db70bd8b3471`);
  the isolated archive baseline additionally had five unrelated
  harness/environment-sensitive failures, including three VCS assertions
  because the archive was not itself a Git worktree.
- Orchestrator GitNexus `detect_changes(compare main)` after the gate: LOW risk,
  nine changed files, zero affected indexed processes.
