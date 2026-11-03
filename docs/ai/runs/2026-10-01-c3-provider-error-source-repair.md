---
date: 2026-10-01
repo: Rhythm
branch: opencode/delivery-runner-provider-errors-20261001
pr: 1598
issues: [C3]
status: unverified
tags: [run, Rhythm, provider-error]
---

# C3 provider-error source repair

## Files

- `apps/api_server/src/__tests__/regressions_runner_provider_error_contract.test.ts`: executable red contract for the observed SDK assistant `APIError` shape, returned run classification, durable root status, and non-disclosing error text. In-memory synthetic DB only.
- `apps/api_server/src/services/agent_runner.ts`: classify a returned assistant message carrying `info.error` before text fallback, idle persistence, output delivery or success outcome. Provider authentication/401/403, aborted turn, output limit and unknown engine errors get distinct fixed reasons. The error path uses existing `_markSessionError`, so scheduler callers receive `status:'error'` and retain a durable failed root. No provider response body, headers or URL enter the returned/durable reason. The timeout catch and `abortSession` path are unchanged.
- `docs/ai/contracts/task-c3-provider-error-20261001.json`: three focused source criteria passed and one real API/engine/scheduler criterion still `UNVERIFIED`.

## Checks

- Worktree preflight: branch `opencode/delivery-runner-provider-errors-20261001`, clean baseline `1870574248c4f48883fd828263615cff6e9e5871` before edits; no other lane or main checkout touched.
- GitNexus pre-edit `_runOnce` impact (`--direction upstream --include-tests --summary-only --repo /Users/ajhochhalter/Documents/Rhythm`): LOW, one direct caller, 11 total impacted, zero indexed processes, Services direct and Controllers indirect. The index warns it predates this worktree by four commits; source confirms `run` directly calls `_runOnce` and scheduler handles `run` result. No HIGH/CRITICAL result on the edited symbol.
- Before production edit, `./node_modules/.bin/vitest run src/__tests__/regressions_runner_provider_error_contract.test.ts --maxWorkers=1 --no-file-parallelism` from `apps/api_server`: **exit 1**, one assertion failure, actual `done` versus expected `error`; runner logged completion for an assistant `APIError` 401.
- After edit, same command: **exit 0, 1/1 passed**.
- Additional red-before-repair coverage: the same focused contract with SDK `MessageAbortedError` and `MessageOutputLengthError` yielded **1 pass/2 fail**; abort was wrongly `infra_config`, output limit wrongly labeled provider failure.
- Focused compatibility: `./node_modules/.bin/vitest run src/__tests__/regressions_runner_provider_error_contract.test.ts src/__tests__/issue_738_agent_runner.test.ts src/__tests__/issue_1040_agent_runner_streaming.test.ts src/__tests__/scheduled_run_status_classifier.test.ts --maxWorkers=1 --no-file-parallelism`: final **exit 0, 4 files/56 tests passed**.
- `./node_modules/.bin/tsc --noEmit` from `apps/api_server`: **exit 0**.
- `git diff --check`: exit 0. GitNexus `detect-changes --scope all --repo /Users/ajhochhalter/Documents/Rhythm`: one changed indexed symbol (`_runOnce`), low risk, zero indexed processes; same stale-index warning. Untracked test/contract are outside GitNexus's tracked diff accounting.

## Notes

- The user-observed real provider failure was recorded earlier in the C1 worktree: controlled nonretryable HTTP 401, SDK `APIError`, actual schedule `completed_no_op`/`error=null`, root idle. Its existing env-gated `apps/api_server/src/__tests__/c1_gap_provider_live.test.ts` failed before this C3 repair. It requires integration with the C1+C2 candidate and a separately owned synthetic sandbox to verify this patch. This run did **not** launch an engine/API, mutate a live DB, or claim backend completion.
- C1's runner diff compared read-only against current Mega changes only C2 identity at approximately lines 926 and 1202. C3 edits the post-prompt response block near line 1768, so no same-hunk conflict is expected; Git integration and its test suite remain parent-owned.
- The scheduler already maps `run().status === 'error'` to a failed run/task and formats the failure category. The focused test observes the `run` result and persisted root; it does not prove the scheduled HTTP path. No change to C1's frozen scheduler/UI patch was made.
- No commit, push, PR update, release, installation, or model/profile operation. The source candidate is ready for independent review and later live verification, not for a PASS handoff.
