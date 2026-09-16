# Rhythm — Project State

## Current focus

Repair the local agent-server OOM and recover owned API exits. Implementation and automated verification are complete on `codex/agent-server-memory-fix`; handoff is a draft PR for human review.

## Active branch / PR

- `codex/agent-server-memory-fix`, based on `origin/main` at `0bc46a5e`.
- [Run and verification evidence](runs/2026-09-15-agent-server-memory-fix.md).
- Earlier work remains recorded in the dated [runs](runs/) and its existing PRs; this branch does not merge or replace those changes.

## In progress

Human packaged-chat smoke and release review. The installed app has not been replaced or restarted.

## Risks / known issues

- Exact counting still scans SQLite history synchronously: about 20.5 seconds and about 1 GiB peak RSS on the diagnostic history. Health responses can be delayed during a scan.
- Recovery restores future connectivity; API startup can reclaim an orphan engine and interrupt a surviving turn.
- Native helper coverage exercises real exit observation and controller recovery with scripted start/health. Packaged chat history and a subsequent model turn remain the pre-release smoke gate.

## Test status

- Full `ai-workflow checks --level pr`: all 16 checks passed.
- Final issue/static gate, 1,319 Flutter tests, macOS native build/recovery test passed. The last same-token Retry adjustment additionally passed 54 focused recovery/MCP tests and scoped analysis.
- Real API/fork live contract: 338 MiB fixture under a 256 MiB V8 cap, exact counts through edits/deletes, same healthy API PID.
- Read-only full history: all 170 skill counts match the original hash under a 256 MiB V8 cap, with about 8 MiB post-scan V8 heap.
- Initial local-server test failures were reproduced as tool-sandbox `listen EPERM`; the identical isolated test and full gate passed with local-process access.

## Next step

Review the draft and perform [packaged recovery smoke](../testing/manual-smoke.md#agent-server-memory-and-owned-process-recovery) before merge or deployment.
