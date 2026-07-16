# Follow-up: isolate flaky `tasks_controller` real-HTTP responses

**Type:** test infrastructure · **Priority:** medium · **First observed:** 2026-06-24 · **Recurred:** 2026-07-16

## Failure

The full API suite intermittently gives a `tasks_controller.test.ts` request a
response that did not come from the expected task-validation path. The symptom
has moved between otherwise deterministic tests:

- `GET /tasks?overdue=yes returns 400` returned HTTP 200 on 2026-06-24.
- A separate run returned HTML rather than the task controller's JSON.
- `GET /tasks?scheduled_before=bad-date returns 400` returned HTTP 200 at line
  320 on 2026-07-16.

Each failing query is rejected synchronously by `parseTaskFilters` before any
database/repository call. Direct parser tests and isolated real-HTTP tests pass,
so database contents cannot explain the invalid query becoming HTTP 200.

## Repro Command

```bash
cd apps/api_server
npm test
```

The merge workflow reaches the same command through:

```bash
ai-workflow checks --level pr
```

The failure is order/worker dependent. The 2026-07-16 occurrence did not repeat
when the exact PR gate was rerun, when the named test was run alone, or across
the subsequent full-suite stress reruns.

## Expected

Every request with a malformed `scheduled_before`, `due_before`, or `overdue`
query receives HTTP 400 and the task controller's JSON validation shape.

## Actual

Rare full-suite runs receive HTTP 200 (and one historical run received HTML),
even though the same request passes against the same source in isolation.

## Relevant Output

```text
src/__tests__/tasks_controller.test.ts:320
GET /tasks?scheduled_before=2025/06/01
expected 200 to be 400
```

The production validator, route, test, and shared real-server helper are
byte-identical to `origin/main` in the #1106 worktree. PR #1106 only changes the
managed-skill proposal apply/revert path.

## Likely Cause

This is transport/global-state contamination in the Vitest real-HTTP harness,
not task-filter behavior. Several suite files replace `global.fetch` directly
without restoring it, while `vitest.config.ts` does not enable automatic global
restoration. A leaked mock can return an unrelated HTTP-200 `Response` and
bypass the real ephemeral Express server entirely. The exact worker ordering
that triggers the leak still needs to be captured before changing the harness.

The older lead that blamed the shared SQLite `_db` singleton is insufficient:
`TasksController.getAll` returns the 400 before `TasksRepository` is called.
The existing `startTestServer` connection-close hardening also does not protect
against a replaced global `fetch` function.

## Likely Files

- `apps/api_server/vitest.config.ts`
- `apps/api_server/src/__tests__/tasks_controller.test.ts`
- `apps/api_server/src/__tests__/helpers/real_server.ts`
- Tests that assign `global.fetch` without restoring it, especially:
  - `apps/api_server/src/__tests__/credentials_bridge_service.test.ts`
  - `apps/api_server/src/__tests__/github_copilot_device_auth.test.ts`
  - `apps/api_server/src/services/__tests__/sync_orchestrator_service.test.ts`

## Required Fix

1. Capture a deterministic file order/worker assignment that produces the
   false HTTP-200 response and prove whether `global.fetch` is mocked at the
   start of `tasks_controller.test.ts`.
2. Convert direct `global.fetch = ...` mutations to `vi.stubGlobal` plus
   `vi.unstubAllGlobals`, or explicitly restore the saved real fetch in every
   affected file. Consider `unstubGlobals: true` as a defense in depth setting.
3. Make real-HTTP tests fail fast if `fetch` is mocked, or call an explicitly
   imported real fetch implementation so transport tests cannot silently use a
   leaked mock.
4. Do not weaken the task-controller assertions or retry failed tests.

## Required Tests / Evaluation

- Add a regression proving a fetch-mutating test cannot contaminate the
  `tasks_controller` real-HTTP tests when files share a worker.
- Run the previously failing deterministic order before and after the fix.
- Run `tasks_controller.test.ts` in isolation: 26/26 pass.
- Run the complete API suite at least 20 consecutive times with zero
  task-controller transport failures.
- Run `ai-workflow checks --level pr` from the top.
