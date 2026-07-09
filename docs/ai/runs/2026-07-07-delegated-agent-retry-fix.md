---
date: 2026-07-07
repo: Rhythm
branch: codex/fix-delegated-agent-retry
pr:
issues:
status: complete
tags: [run, rhythm]
---

# Delegated Agent Retry Fix

## Files

- `apps/opencode_fork/packages/opencode/src/session/llm.ts`
- `apps/opencode_fork/packages/opencode/test/session/llm.test.ts`
- `apps/opencode_fork/packages/opencode/src/session/retry.ts`
- `apps/opencode_fork/packages/opencode/test/session/retry.test.ts`
- `apps/opencode_fork/packages/opencode/src/tool/task.ts`
- `apps/opencode_fork/packages/opencode/test/tool/task.test.ts`
- `apps/opencode_fork/packages/opencode/src/tool/task.txt`

## Checks

- PASS: `node /Users/ajhochhalter/Documents/Rhythm/.gitnexus/run.cjs impact --repo "/Users/ajhochhalter/Documents/Rhythm" policy --direction upstream --file apps/opencode_fork/packages/opencode/src/session/retry.ts --limit 100` reported LOW risk, 0 direct callers, 0 affected processes.
- PASS: `node /Users/ajhochhalter/Documents/Rhythm/.gitnexus/run.cjs impact --repo "/Users/ajhochhalter/Documents/Rhythm" TaskTool --direction upstream --file apps/opencode_fork/packages/opencode/src/tool/task.ts --limit 100` reported LOW risk, 0 direct callers, 0 affected processes.
- PASS: `node /Users/ajhochhalter/Documents/Rhythm/.gitnexus/run.cjs impact --repo "/Users/ajhochhalter/Documents/Rhythm" run --direction upstream --file apps/opencode_fork/packages/opencode/src/session/llm.ts --limit 100` reported LOW risk, 0 direct callers, 0 affected processes.
- PASS: `cd apps/opencode_fork/packages/opencode && bun test ./test/tool/task.test.ts ./test/session/retry.test.ts ./test/session/llm.test.ts` reported 56 passing tests.
- PASS: `cd apps/opencode_fork/packages/opencode && bunx prettier --check src/session/retry.ts test/session/retry.test.ts src/tool/task.ts test/tool/task.test.ts src/session/llm.ts test/session/llm.test.ts`
- PASS: `git diff --check -- apps/opencode_fork/packages/opencode/src/session/retry.ts apps/opencode_fork/packages/opencode/test/session/retry.test.ts apps/opencode_fork/packages/opencode/src/tool/task.ts apps/opencode_fork/packages/opencode/test/tool/task.test.ts apps/opencode_fork/packages/opencode/src/session/llm.ts apps/opencode_fork/packages/opencode/test/session/llm.test.ts apps/opencode_fork/packages/opencode/src/tool/task.txt`
- FAIL (pre-existing/out of scope): `cd apps/opencode_fork/packages/opencode && bun run typecheck` fails in untouched `src/bus/global.ts` (`GlobalBusEmitter.emit` type mismatch) and untouched `test/session/system.test.ts` (test fixture missing required `reload` property).
- PASS: `node /Users/ajhochhalter/Documents/Rhythm/.gitnexus/run.cjs detect_changes --repo "/Users/ajhochhalter/Documents/Rhythm" --scope compare --base-ref main` reported low risk and 0 affected processes.

## Notes

- The screenshot retry banner is caused by real retryable provider stream failures, not by Flutter inventing a local UI error.
- The previous retry policy had no terminal cap, so repeated retryable provider failures could keep emitting `Retrying (attempt N)` and empty `Thinking...` rows.
- `SessionRetry.policy` now stops after three retry status attempts so the underlying provider error can surface instead of looping indefinitely.
- Full-size OpenAI streams are capped at two concurrent streams per engine process to reduce delegated-agent fanout bursts that correlate with provider `server_error` failures. Small/title streams are not gated.
- `TaskTool` now retries one retryable child provider failure in the same child session. If the child still fails, the parent receives a failure message that includes the child `task_id` instead of an empty successful `<task_result>`.
- The task tool prompt now defaults parents to at most two concurrent Task calls and tells them to resume the same `task_id` after retryable provider failures.
