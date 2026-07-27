---
date: 2026-07-27
repo: Rhythm
branch: codex/issue-1211-stalled-stream
pr: pending
issues: [1211]
status: pass
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Provider stream inactivity recovery

## Files changed

- `apps/opencode_fork/packages/opencode/src/session/llm.ts`
  - Added a provider-boundary inactivity watchdog with a 180-second default.
  - Reset the deadline on every raw provider chunk.
  - Abort the underlying request exactly once and surface a typed timeout.
- `apps/opencode_fork/packages/opencode/test/session/llm.test.ts`
  - Added stalled-stream and continued-activity coverage.
- `apps/opencode_fork/packages/opencode/test/tool/task.test.ts`
  - Added child-timeout propagation coverage for delegated tasks.
- `apps/api_server/src/__tests__/issue_1211_live_e2e.test.ts`
  - Added an env-gated real API + fork-engine contract using a deliberately
    stalled OpenAI-compatible provider.
- `docs/ai/contracts/issue-1211.json`
  - Recorded the executable acceptance contract.

## Checks run

- Pre-fix falsification:
  - `bun test test/session/llm.test.ts`
  - Observed `issue-1211-c1` fail because the stream remained running beyond
    its configured inactivity deadline.
- Fork focused suite:
  - `bun test test/session/llm.test.ts test/tool/task.test.ts`
  - PASS: 34 tests, 85 assertions.
- Fork full suite:
  - `bun test`
  - PASS (exit 0).
- Fork static check:
  - `bun run typecheck`
  - The new files are clean. The command remains red on three pre-existing
    errors in `src/bus/global.ts` and `test/file/path-traversal.test.ts`.
- Fork build:
  - `bun run build --single`
  - PASS during `tools/dev/sandbox.sh up`; binary smoke test reported the
    branch version successfully.
- API build:
  - `npm run build`
  - PASS.
- API full suite:
  - `npm test`
  - PASS when rerun with localhost binding allowed. The restricted first run
    produced `listen EPERM` in existing loopback-server tests.
- Repository gates:
  - `ai-workflow checks --level issue`
  - PASS: Flutter analyze, Dart format, and API TypeScript.
  - `ai-workflow checks --level pr`
  - PASS (exit 0).
- Live behavior:
  - Sandbox startup:
    `RHYTHM_SANDBOX_DIR=/tmp/rhythm-1211-sandbox RHYTHM_PROVIDER_STREAM_INACTIVITY_MS=500 tools/dev/sandbox.sh up --foreground`
  - Health probes:
    `curl -fsS http://127.0.0.1:4098/health`
    returned `{"status":"ok","service":"rhythm-api-server","commit":"dev"}`;
    `curl -fsS http://127.0.0.1:4098/opencode/health`
    returned `{"status":"ready",...}`.
  - Contract:
    `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 STALL_PROVIDER_URL=http://127.0.0.1:4197 npx vitest run src/__tests__/issue_1211_live_e2e.test.ts`
  - PASS: 1 test. The public session left `working` and became `error` with
    `Provider stream inactive` in `statusMessage`.
  - `tools/dev/sandbox.sh down` removed the sandbox; ports 4097/4098 had no
    listeners afterward.
- Change analysis:
  - GitNexus `impact` for the LLM stream path and `TaskTool` reported LOW
    blast radius.
  - GitNexus `detect_changes --scope compare --base-ref main` exited 0.
  - `git diff --check` PASS.

## Notes

- Diagnosis followed a live recurrence after restart: API and engine health
  remained ready while OpenAI-compatible provider streams stayed non-terminal.
  Existing child-error propagation and startup reconciliation could not run
  until the provider stream terminated.
- The timeout wraps only provider stream opening and raw provider chunks. It
  does not time out long-running tools or shell commands.
- The default is 180 seconds and can be overridden for controlled testing with
  `RHYTHM_PROVIDER_STREAM_INACTIVITY_MS`.
- The initial sandbox attempt failed because `better-sqlite3` had no native
  binding after a scripts-disabled dependency install. `npm rebuild
  better-sqlite3` repaired the test environment; no product code changed for
  that failure.
