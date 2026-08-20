# Rhythm — Project State

## Current focus

#1375 purge-only transcript-share retention is verified at `1175a4c9`; no draft PR is open. Bucket E remains open as draft PR #1467, and all previously active PR and Org Optimizer workflows remain unchanged.

## Active branch / PR

- #1375: `codex/mega-f-purge-only` at `1175a4c9`; verified, draft PR not opened.
- Bucket E: `codex/mega-e-artifact-storage` → draft PR #1467; depends on HIGH-risk Postgres prerequisite #1464.
- Preserve active work and recorded statuses: Org Optimizer and PRs #1383, #1453, #1459, #1460, #1461, #1462, #1463, #1464, #1465, and #1467.

## In progress

- #1375 is complete within purge-only scope: the public route and repository default omitted expiries to exactly 90 days, while explicit expiry is preserved.
- #1425 remains open for a separate signed local-review design; the broken dual-server sharing UI/API path is excluded.
- Bucket E still requires the recorded Synology operator checks after prerequisite #1464 is ready.

## Risks / known issues

- Before enabling transcript-share purge, count due rows. If the backlog is material, leave it disabled and add bounded `SKIP LOCKED` batches.
- Purge is triple-gated opt-in: non-test runtime, `RHYTHM_TRANSCRIPT_SHARE_PURGE_ENABLED=true`, and Postgres.
- #1375 adds no schema, Flutter, or #1425 work. Source session/message bytes survive; purge audits contain no transcript content.
- Bucket E remains dependent on HIGH-risk Postgres prerequisite #1464.

## Test status

- PASS — verification `a90eba6c-1587-4be6-912f-76080bb2ad52`; contract `docs/ai/contracts/issue-1375.json` passed 5/5.
- Disposable Postgres purge removed 2 due rows, then 0; recent and null-expiry rows survived, source bytes remained unchanged, induced failure rolled back fully, and delete audits were content-free.
- Startup matrix passed `0/0/0/1` for test runtime / flag disabled / SQLite / fully enabled Postgres.
- GitNexus final scope was LOW risk with 0 affected processes.

## Next step

Open a draft PR for verified #1375 when requested, with the rollout backlog warning. Keep #1425 separate and do not merge or deploy; continue existing manual handoffs for PRs through #1467 and Org Optimizer.
