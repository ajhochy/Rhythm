---
date: 2026-09-29
repo: Rhythm
status: proposed
tags: [decision, Rhythm]
---

# Session DB retention: strip bulky tool payloads after 30 days, keep the rest

Research and proposal only. No database was written to and no file was deleted or vacuumed. All DBs were opened with `file:<path>?mode=ro`.
Labels: **[O]** = OBSERVED (measured or read in code today), **[I]** = INFERRED.

## Context

AJ wants the session stores to stop growing without bound, while keeping the history that is actually useful.

### Stores and sizes (2026-09-29)

| Store | Size | Notes |
|---|---|---|
| `~/.local/share/opencode/opencode.db` (engine, live, PID 36909) | 4.25 GB | page_size 4096, freelist 0, **auto_vacuum=0 (NONE)**, WAL [O] |
| 31 per-branch `opencode-<branch>.db` (same dir) | 1.06 GB | biggest: `opencode-main.db` 498 MB, `mega-run-2026-08-04` 176 MB, `local-combined-1284-1303` 172 MB, `image-generation` 105 MB [O] |
| `~/Library/Application Support/Rhythm Electron/rhythm.db` (api_server, PID 27228) | 2.27 GB | freelist 183 pages, **auto_vacuum=0**, WAL. Vacuumed 2026-09-28 from 6.0 GB [O] |
| `…/Rhythm Electron/rhythm.db.pre-vacuum-2026-09-28` | 6.0 GB | the backup from yesterday's vacuum [O] |
| `~/Library/Application Support/Rhythm/rhythm.db` (desktop app store) | 4.0 GB | last message 2026-09-28 16:50, so still in use; not open right now [O] |
| `…/Rhythm/rhythm.db.bak*` (3 files) | 1.86 GB | dated 2026-07-21 and 2026-08-12 [O] |

Free disk is 83 GB, and the volume is 91% used [O].

### What is taking the space: engine `opencode.db` (dbstat) [O]

| Object | MB |
|---|---|
| `part` | 3,647 |
| `message` | 265 |
| part indexes (3) | 97 |
| message indexes (2) | 19 |
| `session` | 6 |
| `session_message`, `todo`, the rest | < 5 |
| `event` / `event_sequence` | 0 rows |

The `part` table broken down by `data.type` / `tool` [O]:

| Part | Rows | MB | Where the bytes are |
|---|---|---|---|
| tool `read` | 45,450 | 1,938 | **1,483 MB in 832 rows over 200 KB. That is `state.attachments`: base64 images and PDFs.** `output` is 321 MB. |
| tool `bash` | 59,748 | 436 | output 199 MB, plus `metadata` (a copy of the output) |
| reasoning | 112,245 | 202 | model reasoning text |
| text | 52,762 | 144 | assistant and user prose |
| tool `apply_patch` | 7,119 | 117 | metadata diffs; input 21 MB |
| `file` (user uploads) | 231 | 111 | base64 data URLs |
| tool `grep` | 12,858 | 54 | output 46 MB |
| tool `skill` | 4,915 | 35 | output 32 MB |
| everything else | — | < 25 each | |

Tool attachments total **1,553 MB** across 2,480 parts: PNG 961 MB, JPEG 493 MB, PDF 94 MB [O]. The largest sessions are all image work: `creative-media` "Annuncement Loop" 378 MB, `config-doctor` 109 MB, the collage and poster subagents 92/77/45 MB [O].

Part age distribution (by `part.time_created`; oldest row is 2026-05-06) [O]:

| Age | Rows | MB | of which tool output | of which attachments |
|---|---|---|---|---|
| < 30 d | 223,828 | 1,038 | 314 | 342 |
| 30–60 d | 213,462 | 1,794 | 306 | 1,107 |
| 60–90 d | 128,980 | 471 | 133 | 103 |
| > 90 d | 17,470 | 62 | 13 | 0 |

The engine holds 10,699 sessions: 2,683 are child sessions and 1,123 are archived (`time_archived`) [O].

### api_server `rhythm.db` (Electron) [O]

| Object | MB |
|---|---|
| `agent_session_messages` | 2,056 |
| `tool_events` + indexes | 59 |
| message indexes | 17 |
| `agent_sessions` | 5 |

Column totals in `agent_session_messages`: `parts_json` 1,631 MB, `info_json` 156 MB, `raw_text` 66 MB, `stripped_text` 66 MB. `raw_text` equals `stripped_text` in all 126,885 rows. The `parts_json` mix mirrors the engine's, minus the attachments, which the 2026-09-28 backfill already moved to the media store: bash 430 MB (output 194, metadata 178), read 391 MB (output 312), reasoning 207, apply_patch 118 (metadata 91). By age: < 30 d 730 MB, 30–60 d 700 MB, 60–90 d 331 MB, > 90 d 2 MB. So `parts_json` is a **second full copy** of the engine's parts [O].

## Who reads history, and what they need

| Consumer | Reads | Fields | Window |
|---|---|---|---|
| `org_exercised_tools_resolver.ts` (org optimizer scope-hygiene, `org_proposal_measure` functional guard) | `agent_session_messages.parts_json` | tool parts: `id/sessionID/messageID/callID/tool`, `state.status`, `state.input` (must be a record), and for completed calls: `output` (must be a **string**), `title` (string), `metadata` (record), valid `time`, `time.compacted` (int), `attachments` (undefined or a valid array). A malformed part counts as a **defect**. | 30 d trailing (`DEFAULT_TRAILING_WINDOW_MS`) [O] |
| `skill_usage_tracker.ts` → `harvested_skill_evaluator` | `parts_json` | `tool='skill'`, `state.input.name`, `status='completed'`, plus session eligibility columns | **all history** (MIN..MAX id scan) [O] |
| `skill_extractor.ts` (harvester) | `listBySession` | last 12 messages' text | the just-finished session (minutes) [O] |
| `workflow_failure_signal_extractor.ts` | `listBySession` + `denied_tool_events` | tool status/error, stuck and incomplete attempts | last 200 sessions (`WORKFLOW_SIGNAL_SESSION_SCAN_LIMIT`) [O]; in practice a few days [I] |
| `org_reviewer_service.ts` | messages | session evidence | 7 d default, 14 d max [O] |
| `run_quality_service.ts` / `run_quality_generator.ts` | `tokens_json`, correction rows, `tool_events` | tokens, escalations | 14 d / 30 d [O] |
| `agent_eval_scoring.ts` | `parts_json` | tool name + `callID` + `state.status` + `state.input` | per run, recent [I] |
| `model_provenance_service.ts` | `parts_json` | `step-finish` parts (served identity) | recent [I] |
| `agent_research_repository.ts` | `tokens_json`, `cost` | cost rollups | all history (small columns) [O] |
| Memory consolidation (scheduled 02:30) | session messages | text | past 24 h (seed prompt) [O] |
| Mobile/desktop transcript (`mobile_mirror_reads`, `listBySessionStructuredPage`, `mobile_opencode_proxy` → engine `session.messages`) | both stores | full parts for rendering | any session a user opens. The age is unbounded, but old sessions are rarely opened [I] |
| Session list / recovery | `session` / `agent_sessions` rows | metadata, title, tokens, cost | forever (tiny) [O] |
| Engine context rebuild on resume (`message-v2.ts`) | `part` | if `state.time.compacted` is set, the engine already substitutes `"[Old tool result content cleared]"` and drops attachments | any resumed session [O] |

Takeaways:
- No automated consumer needs tool output, tool metadata, or attachments past **30 days**.
- The only all-history consumer (`skill_usage_tracker`) needs `skill` tool parts.
- Only humans reopening an old transcript would see the difference.

## Existing mechanisms

- **Engine `SessionCompaction.prune`** (`opencode_fork/.../session/compaction.ts`) sets `state.time.compacted` on old completed tool parts. It protects `skill` (`PRUNE_PROTECTED_TOOLS`). It **does not remove the bytes**: output and attachments stay on disk and are only hidden from the model. 14,098 parts / 258 MB are already flagged `compacted` [O]. The marker and the render behaviour are what this proposal reuses.
- **`time_archived`** is a UI flag only; nothing purges archived sessions [O].
- **api_server daily sweeps**: media-artifact retention (`server.ts:161`, `setInterval` 24 h, `unref`) and `transcript_share_purge_job` (opt-in, Postgres only). These are the pattern to copy [O].
- **2026-09-28**: `attachment_backfill_job` moved attachments over 8 KB out of `parts_json` into the media store. The relay outbox gained boot-time compaction (#1583). rhythm.db was vacuumed by hand with the app closed (6.0 → 2.27 GB) [O].
- **No `auto_vacuum` / `incremental_vacuum` / `VACUUM` anywhere** in api_server or the engine's `storage/db.ts` [O]. Both DBs are `auto_vacuum=0`, so deletes only put pages on the freelist and the file never shrinks without a full `VACUUM`.

## Decision (proposed)

### Policy: least expensive thing that stops unbounded growth

1. **Keep forever:** `session` / `agent_sessions` rows (metadata, title, agent, allowlists, tokens, cost), `message` / `info_json` / `tokens_json`, `text` parts, `step-*` parts, `tool_events`, `denied_tool_events`, every `tool='skill'` part (unchanged), and every tool part's `tool`, `callID`, `state.status`, `state.input`, `state.title`, `state.time`, and `state.error`.
2. **After 30 days, when the owning session has also been idle for 30 days, distill every other tool part in place.** This works in both the engine `part.data` and `agent_session_messages.parts_json`:
   - `state.output` → its first 2 KB plus `"\n[pruned by retention YYYY-MM-DD; N bytes]"`. It stays a **string**, so the org resolver still reads the part as valid.
   - `state.metadata` → keep only scalar keys under 256 bytes (exit code, truncated, and so on). It stays a record.
   - `state.attachments` → removed from the key (undefined is valid).
   - `state.mcpResult` → `{ isError }` only.
   - `state.time.compacted` → set if absent, so the engine renders its native "cleared" text on resume.
   - `file` parts' data URLs → replaced with a stub URL that records mime, size, and sha256.
   - Idempotent: parts already distilled are skipped.
3. **Delete the stale per-branch engine DBs** (30 files, about 1.03 GB). Every session in them is already present in `opencode.db`: 0 missing sessions across all 30, and 0 missing parts for `opencode-main.db` [O]. **Exception:** `opencode-rhythm.db` (23 MB) was written 2026-09-28 and holds 2 sessions not in the live DB ("resize check 2/3", scratchpad image tests). It is some channel's live store [I]. Leave it, or ask first.
4. **Not in phase 1:** stripping `reasoning` (202 MB in total) or text. Revisit only if the distilled residual growth (~0.2 GB/month [I]) becomes a problem. If it does, drop reasoning after 90 days.

### Where it runs: a daily api_server routine, not "after the org optimizer"

- The org optimizer is **not running**:
  - `Org Self-Optimizer` (daily 02:00) is `enabled=0`; its last run was 2026-09-14.
  - `Org Reviewer` (weekly) is `enabled=0`; its last run was 2026-09-21.
  - `org_optimizer_seed.ts` says the generator schedules are "retired in favor of Org Reviewer".
  - `runOrgOptimizer` is now reachable only through the `rhythm_run_org_optimizer` MCP tool.
  - An after-run hook would therefore never fire [O].
- It is also unnecessary. Every automated consumer's window is ≤ 30 days, so a 30-day cutoff cannot race their reads, whatever the order.
- Implementation: add `jobs/session_retention_job.ts`, started from `server.ts` next to the media-retention sweep.
  - Run on a 24 h `setInterval().unref()`, with the first run deferred past the #746 engine cold-start window (`isEngineCold`), roughly 02:15 local.
  - Gate it behind env: `RHYTHM_SESSION_RETENTION=off|dry-run|on`, default `dry-run`. Add `RHYTHM_SESSION_RETENTION_DAYS=30`.

### Safety: direct SQLite from api_server, engine running, bounded batches

- **Engine DB:** open a separate `better-sqlite3` connection to `opencode.db` with `busy_timeout=5000`. Both processes use WAL, so multi-process writes are safe at the SQLite level [O: engine sets WAL + busy_timeout 5000].
  - Update in transactions of about 200 parts each, and yield to the event loop between batches. Synchronous bulk work on this loop has twice caused outages: the #1583 outbox drain and the PR #1508 skill-usage scan.
  - Guard the logical race with `UPDATE part SET data=? WHERE id=? AND time_updated=?`, and skip any session whose `time_updated` is inside the window or that has a live `agent_async_delegations` row.
  - Do **not** go through the engine `PATCH /session/:id/message/:mid/part/:pid` route. Every call emits `message.part.updated`, which the stream bridge mirrors into `agent_session_messages` and the **relay outbox**. That would be about 100k outbox upserts (the #1583 failure mode) plus SSE fan-out to clients [I from code paths].
- **rhythm.db:** use a direct `UPDATE agent_session_messages SET parts_json=?` rather than repository `upsertPart`, which enqueues relay rows [O: outbox writes are code-driven in `relay_outbox_repository`, with no triggers].
  - Consequence: the Synology relay copy keeps full rows. That is either fine or a separate retention question (see open questions).
- **Space reclaim:** after the updates, the freed bytes go onto the freelist. That alone **stops growth**, because new writes reuse the pages. The file only shrinks after a `VACUUM`:
  - Do a one-time `PRAGMA auto_vacuum=INCREMENTAL; VACUUM;` per DB, **with the app fully quit**. That is the same procedure as the 2026-09-28 rhythm.db vacuum. It needs about 1× the DB size in temp space plus the new file (≤ 9 GB total; 83 GB is free) and holds an exclusive lock for minutes.
  - After that, the daily job runs `PRAGMA incremental_vacuum(2560)` (about 10 MB per step, looped with yields), so no future full vacuum is needed.
  - The engine never resets `auto_vacuum`; it is only changed by VACUUM [O: `storage/db.ts` sets no auto_vacuum].

### Estimated reclaim

| Item | Reclaim |
|---|---|
| Engine: distill non-skill tool parts > 30 d (attachments 1,211 + output beyond 2 KB 329 + metadata 165 MB) plus `file` parts > 30 d (91 MB) [O] | **~1.8 GB** (4.25 → ~2.4 GB after VACUUM) |
| rhythm.db: distill `parts_json` tool output and metadata > 30 d [O] | **~0.58 GB** (2.27 → ~1.7 GB after VACUUM) |
| Delete 30 stale per-branch engine DBs [O] | **~1.03 GB** |
| **Session-DB total** | **~3.4 GB** |
| Optional, AJ's call: `rhythm.db.pre-vacuum-2026-09-28` 6.0 GB plus legacy `Rhythm/rhythm.db.bak*` 1.86 GB | up to 7.9 GB more |
| Legacy `~/Library/Application Support/Rhythm/rhythm.db` (4.0 GB, still used 2026-09-28): the same job applies when that app's api_server runs | ~0.5–1 GB [I] |

Steady state [I]:
- Engine: roughly the last 30 days at full fidelity (currently ~1.0 GB, image-heavy months higher) plus about 0.2 GB/month of distilled residual.
- rhythm.db: roughly 0.7 GB for the last 30 days plus a small residual.
- Growth goes from ~1 GB/month to ~0.2 GB/month.

## Rollout

1. **Dry-run first (default mode).** The job only reports: candidate parts, bytes it would free per store and per tool, sessions touched, and any part that would fail the org resolver's readability check afterwards. The acceptance target is 0 new defects. It logs to the api_server log and writes a JSON report. Run it daily for a week and compare with the numbers above.
2. **Back up before the first real run**, with the app quit: `sqlite3 opencode.db ".backup opencode.db.pre-retention-<date>"` and the same for rhythm.db. Keep the backups until a week of normal use passes, then delete them. Don't repeat the 6 GB backup that is still around.
3. **First real run: the engine DB only, one image-heavy session**, for example `ses_fdf4c292…` (378 MB). Then reopen that session on desktop and mobile. It should render, show the "cleared" marker, and resume. Also check the org resolver's defect count and `countSkillToolUses` before and after (they must be unchanged).
4. **Enable `on`** for both stores. Watch event-loop lag and engine `/health` during the first sweep.
5. **One-time `auto_vacuum=INCREMENTAL` + `VACUUM`** per DB with the app quit. After that, the daily incremental vacuum takes over.
6. **Per-branch DBs:** move them to a dated folder first (reversible). Delete after 2 weeks with no complaints. Exclude `opencode-rhythm.db`.
7. Reversibility: step 1 is read-only. Steps 3 and 4 are reversible from the step 2 backup. The distilled record keeps a 2 KB head, the byte count, and the sha256 of each stripped attachment, so nothing is lost silently.

## Alternatives considered

- **Hook after the org optimizer:** it is disabled, so the hook would never fire (see above).
- **Delete whole old sessions:** this loses transcripts and skill-usage history, and saves little beyond distillation, because the bulk is in tool payloads.
- **Route writes through the engine HTTP API:** this causes event and relay-outbox storms and needs about 100k round trips.
- **Stop the engine and run a standalone script:** this is safer for VACUUM only, and that is how step 5 is done. It is unnecessary for the row updates.
- **Drop `parts_json` from rhythm.db and read the engine only:** this is the bigger win (1.6 GB) but a large refactor of mirror reads and every org/skill consumer. Out of scope.

## Open questions for AJ

1. Is **30 days** at full fidelity right, or do you want longer for image and creative sessions? Attachments dominate; a 60-day cutoff would save only about 0.25 GB.
2. Should the relay/Synology copy of `agent_session_messages` get the same retention, or stay a full archive?
3. Can `rhythm.db.pre-vacuum-2026-09-28` (6.0 GB) and the `Rhythm/rhythm.db.bak*` files (1.86 GB) be deleted? That is more than every in-DB saving combined.
4. What writes `opencode-rhythm.db` (2 scratch sessions, 2026-09-28)? Keep it or delete it?
5. Is `~/Library/Application Support/Rhythm/rhythm.db` (4.0 GB, desktop-app store, active through 2026-09-28) still a store you use, or is it superseded by the Electron store?
6. Should `reasoning` parts older than 90 days also go (about 0.2 GB now, and the main source of residual growth)?
7. Is a quit-the-app window acceptable for the one-time VACUUMs (minutes per DB)?
