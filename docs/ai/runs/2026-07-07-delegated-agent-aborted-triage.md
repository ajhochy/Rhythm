---
date: 2026-07-07
repo: Rhythm
branch: main
pr:
issues:
status: complete
tags: [run, rhythm]
---

# Delegated Agent Aborted Triage

## Files

- `apps/opencode_fork/packages/opencode/src/session/retry.ts`
- `apps/opencode_fork/packages/opencode/test/session/retry.test.ts`
- `apps/opencode_fork/packages/opencode/src/session/llm.ts`
- `apps/opencode_fork/packages/opencode/test/session/llm.test.ts`
- `apps/opencode_fork/packages/opencode/src/tool/task.ts`
- `apps/opencode_fork/packages/opencode/test/tool/task.test.ts`
- `apps/opencode_fork/packages/opencode/src/tool/task.txt`

## Checks

- PASS: `node .gitnexus/run.cjs impact --repo "/Users/ajhochhalter/Documents/Rhythm" policy --direction upstream --file apps/opencode_fork/packages/opencode/src/session/retry.ts --limit 100` reported LOW risk, 0 direct callers, 0 affected processes.
- PASS: `node .gitnexus/run.cjs impact --repo "/Users/ajhochhalter/Documents/Rhythm" TaskTool --direction upstream --file apps/opencode_fork/packages/opencode/src/tool/task.ts --limit 100` reported LOW risk, 0 direct callers, 0 affected processes.
- PASS: `node .gitnexus/run.cjs impact --repo "/Users/ajhochhalter/Documents/Rhythm" run --direction upstream --file apps/opencode_fork/packages/opencode/src/session/llm.ts --limit 100` reported LOW risk, 0 direct callers, 0 affected processes.
- PASS: `cd apps/opencode_fork/packages/opencode && bun test ./test/tool/task.test.ts ./test/session/retry.test.ts ./test/session/llm.test.ts` reported 56 passing tests.
- PASS: `cd apps/opencode_fork/packages/opencode && bunx prettier --check src/session/retry.ts test/session/retry.test.ts src/tool/task.ts test/tool/task.test.ts src/session/llm.ts test/session/llm.test.ts`
- PASS: `git diff --check -- apps/opencode_fork/packages/opencode/src/session/retry.ts apps/opencode_fork/packages/opencode/test/session/retry.test.ts apps/opencode_fork/packages/opencode/src/tool/task.ts apps/opencode_fork/packages/opencode/test/tool/task.test.ts apps/opencode_fork/packages/opencode/src/session/llm.ts apps/opencode_fork/packages/opencode/test/session/llm.test.ts apps/opencode_fork/packages/opencode/src/tool/task.txt docs/ai/runs/2026-07-07-delegated-agent-aborted-triage.md`
- FAIL (pre-existing/out of scope): `cd apps/opencode_fork/packages/opencode && bun run typecheck` fails in `test/session/system.test.ts` because a test fixture is missing the required `reload` property.
- PASS: `node .gitnexus/run.cjs detect_changes --repo "/Users/ajhochhalter/Documents/Rhythm" --scope compare --base-ref main` reported low risk and 0 affected processes. The scan includes unrelated dirty workspace files outside this fix.

## Notes

- Live session and existing retry tests tied the screenshot banner text to an OpenAI `server_error` stream chunk that `MessageV2.fromError` converts into a retryable API error.
- The first banner is caused by upstream provider stream failures, not by Flutter inventing a local error. Local opencode logs at `~/.local/share/opencode/log/2026-07-07T022926.log` show repeated `server_error` stream errors from `openai/gpt-5.5` across several sessions between `2026-07-07T03:43` and `03:46`, including the planning child request IDs `c3e0ed2b-b605-40f1-ae65-e212bfe542b2`, `ba0d05ef-8e0d-48ac-af66-9c664945fcd1`, `6bd882ee-a3a4-496a-a9b1-42b061967ea9`, and `b14f5232-5d6b-4eee-972e-74d41f7d498e`.
- The failed delegated child sequence was: initial prompt succeeded enough to load `planning-agent`; the next automatic assistant request hit provider `server_error`; retries restarted the stream and emitted repeated empty `step-start`/reasoning parts. A later manual turn succeeded after the bad retry cycle was stopped.
- The actual endless retry cause was `SessionRetry.policy`: it kept producing retry delays for retryable provider errors with no terminal attempt cap, so the processor restarted the stream repeatedly and accumulated empty `Thinking...` parts before the final abort.
- Added `RETRY_MAX_ATTEMPTS = 3` and stop the retry schedule after the third status update. This prevents later banners such as `Retrying (attempt 7)...` and lets the provider error surface instead.
- Live session evidence showed a native `task`-spawned `planning-agent` child returning `MessageAbortedError`, while the parent task card recorded a completed empty `<task_result>`.
- Fixed the masking behavior: `TaskTool` now fails when the child prompt returns an assistant error instead of reporting an empty successful task result.
- Added a same-child retry in `TaskTool` for retryable child provider API errors. The retry reuses the created child session ID, includes the original task, and only retries once before surfacing the child failure to the parent.
- Child failure messages now include the child `task_id`, so the parent has the concrete session to resume instead of launching a replacement child.
- Added a full-size OpenAI stream concurrency gate in the LLM service, capped at two concurrent streams per engine process. This directly targets the observed provider-side error burst from delegated-agent fanout while leaving small/title streams untouched.
- Updated the task tool prompt text so parent agents default to at most two concurrent Task calls and resume the same `task_id` after retryable provider failures instead of launching a replacement path.
- This does not rebuild or restart the currently running Rhythm app; the running engine will not pick up the fork change until the normal external build/restart path.
