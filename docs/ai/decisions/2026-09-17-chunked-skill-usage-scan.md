---
date: 2026-09-17
repo: Rhythm
tags: [decision, rhythm]
index: "[[Rhythm]]"
---

# Chunk the skill-usage history scan instead of moving it off-thread

## Context

`countSkillToolUses` (skill_usage_tracker.ts) scans every `agent_session_messages.parts_json` row inside SQLite, 60 s after each interactive turn, via the idle skill evaluator. #1494 moved the JSON work into SQLite so the API no longer OOMs, but on AJ's 4 GB database the single `.iterate()` pass is still a 14–30 s pread-bound stall of the Node main thread (native sample 2026-09-17 19:13Z: `StatementIterator::Next → sqlite3_step → vdbeColumnFromOverflow → pread`, RSS 838 MB). `/health` cannot answer during the stall, the desktop `HealthPoller` (15 s interval, 2 s timeout, 2 failures) flips the controller to `failed`, the Agents view shows "Agent server unavailable", and a Retry click SIGTERMs a process that cannot handle the signal, so it is SIGKILLed after 2 s and its engine orphaned. That is the "occasional disconnect" seen on v0.18.64.

## Decision

1. Chunk the scan by `agent_session_messages.id` (100 rows per chunk) and `await setImmediate` between chunks; the function becomes async. Total I/O is unchanged; the event loop gets a turn every chunk so `/health`, WebSocket frames and engine events keep flowing.
2. Desktop: `HealthPoller` `failureThreshold` 2 → 3 and `checkHealth` timeout 2 s → 10 s, so a live owned child needs ~40 s of unresponsiveness before it is declared lost. Real exits are still reported immediately by the owned-process exit stream.

## Alternatives

- Worker thread with its own read-only connection: keeps the main loop free but adds a second connection, a compiled worker entry that must exist in both the tsx dev path and the bundled `dist`, and a new failure surface. Not needed once the scan yields.
- Write-path counters (increment on each persisted `skill` tool part): O(1) reads, but needs a cold-start backfill that is itself a full scan, plus delete/edit reconciliation. Upgrade path if per-turn I/O cost ever matters.
- Only Flutter tolerance: hides the symptom while chat, WebSocket and engine events still stall.

## Consequences

- Per-sweep disk read is unchanged (~2.7 GB of parts JSON on AJ's DB); the sweep just takes slightly longer overall and no longer blocks.
- `countSkillToolUses` callers must `await`; the two production callers and the tests were updated.
- ponytail ceiling noted in code: fixed 100-row chunks; make it byte-adaptive if a chunk of very large rows still shows in `/health` latency.
