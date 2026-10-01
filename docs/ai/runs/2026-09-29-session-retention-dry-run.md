---
date: 2026-09-29
repo: Rhythm
branch: mobile/transcript-delta-streaming
pr: 1587
issues: []
status: dry-run
tags: [run, Rhythm]
---

# Session-DB retention job: built, dry-run against live DBs, per-branch DBs archived

Implements `docs/ai/decisions/2026-09-29-session-db-retention.md` (30 days approved).
**[O]** = observed, **[I]** = inferred.

## Files
- `apps/api_server/src/jobs/session_retention_job.ts`: the job (distill policy, guarded batched writes, report).
- `apps/api_server/src/jobs/session_retention_job.test.ts`: 8 tests on temp SQLite fixtures that use the live schemas.
- `apps/api_server/src/server.ts`: starts the job next to the media-retention sweep (SQLite only, not under vitest).
- `apps/api_server/src/services/org_exercised_tools_resolver.ts`: `scanOutputRow` exported for the scanner test (no logic change).

## Scheduling and modes
- The first run is at the next local 02:15, then every 24 h (`unref`'d timers).
- `RHYTHM_SESSION_RETENTION=off|dry-run|on`. The default is **dry-run**: read-only handles, report only.
- `RHYTHM_SESSION_RETENTION_DAYS` (default 30).
- `RHYTHM_SESSION_RETENTION_ENGINE_DB` overrides the engine path (default `~/.local/share/opencode/opencode.db`).
- The report goes to the api_server log plus `session-retention-report.json`, next to rhythm.db.
- Not run: the real trim, VACUUM, and any `auto_vacuum` change. Shrinking the files is still a manual step with the app quit (see the decision doc, Rollout step 5).

## Live dry-run (2026-09-29 08:45 PDT, cutoff 2026-08-30T15:45Z, 25.5 s) [O]

| | engine `opencode.db` | api_server `rhythm.db` (Electron) |
|---|---|---|
| rows scanned (tool/file parts, or messages, in the time window) | 106,290 | 75,855 |
| eligible rows | 66,636 parts | 37,975 messages (61,415 parts) |
| sessions touched | 2,554 | 2,168 |
| bytes before → after | 2,084.7 MB → 166.7 MB | 790.4 MB → 275.1 MB |
| **reclaimable** | **1,918 MB** | **515 MB** |
| oldest / newest eligible | 2026-05-06 / 2026-08-28 | 2026-06-29 / 2026-08-28 |
| new org-scanner defects | n/a (engine rows carry no ids) | **0** |
| written | 0 | 0 |

Reclaimable by tool, in MB. Engine: read 1,433 · bash 211 · file uploads 93 · apply_patch 40 · grep 20 · webfetch 12 · edit 9 · nfl injury report 8 · rhythm list_sessions 8 · scrapling 11 · glob 5.
rhythm.db: bash 202 · read 160 · apply_patch 40 · grep 20 · webfetch 11 · nfl 8 · edit 7 · rhythm list_sessions 6 · scrapling 9 · glob 4 · pco get_plan_items 4.

Sample before/after part shapes (sizes only):
- engine webfetch: part 11,911 B → 2,532 B. Output 11,157 → 2,094 chars. Metadata `[truncated]` → `[truncated, retentionPruned]`. `time.compacted` set.
- engine task: part 12,136 → 3,486 B. Metadata `[sessionId, model, truncated]` → `[sessionId, truncated, retentionPruned]` (the model object is dropped because it is not a scalar).
- rhythm get_dashboard: part 8,052 → 4,027 B. Output 5,737 → 2,093 chars.

Comparison with the proposal:
- Engine: 1.92 GB against ~1.8 GB. The 30-day window has moved on by the run time, and the proposal's split (attachments 1,211 + output 329 + metadata 165 + file 91) left out a few other bulky fields [I].
- rhythm.db: 0.52 GB against ~0.58 GB. The job adds the session-idle and live-delegation filters, and sessions still active inside 30 days keep their old messages at full detail. The proposal estimated by message age alone [I].
- Byte counts are JS string lengths, which equal bytes for the ASCII and base64 bulk [I].

### Live DBs unchanged by the dry-run [O]
- Both connections opened with `readonly: true` (SQLITE_OPEN_READONLY).
- Run 2 was bracketed by `stat` of `opencode.db`, `opencode.db-wal`, `rhythm.db` and `rhythm.db-wal`. Nanosecond mtimes and sizes were identical before and after.
- Run 1 was bracketed by sha256. `opencode.db` was identical (`b860ae24…`). `rhythm.db` changed, but its mtime shows the write landed at 08:45:11, after the run finished at 08:44:56. That write came from the live api_server (PID 83987 holds it open) [O timing, I attribution].

## Per-branch engine DBs [O]
- Every file was checked read-only: each session id is present in `opencode.db`, and `lsof` shows nothing has it open (checked again just before each move).
- **Moved 30** (db + -wal + -shm) to `~/.local/share/opencode/archive-2026-09-29/` (1.0 GB). All had 0 missing sessions and were closed.
- **Skipped `opencode-rhythm.db`**: kept on purpose (2 unique sessions).
- **Skipped `opencode-local.db`** (176 KB, 3 sessions, all present in opencode.db, not open). It is a 32nd file that the proposal did not list, and it was last written 2026-09-28 23:35, so it may be a live channel store [I]. It is AJ's call.
- Left alone: `opencode.db` and its -wal/-shm. Nothing was deleted.

## Checks
- Mutation proofs are in the commit report. Reverting each of the guard, the skill exemption and dry-run read-only turns a test RED; all return to GREEN when restored.
- api_server `npm test`: 724 files passed, 148 skipped; **6803 passed, 0 failed, 285 skipped** (7088). `npm run build` (tsc) exit 0 [O].

## Next
- Let the default dry-run run nightly for a week.
- Rollout steps 2–5 of the decision doc: backup, a one-session real run, `on`, then the manual VACUUM. All of these wait on AJ.
- Still undecided: the legacy `Rhythm/rhythm.db`, the relay/Synology copy, and `opencode-local.db`.
