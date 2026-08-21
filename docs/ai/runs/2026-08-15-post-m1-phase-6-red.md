---
date: 2026-08-15
repo: Rhythm-react-electron-live-suite
branch: local-working-tree
pr: null
issues: [post-m1-phase-6]
status: partial
tags: [run, Rhythm-react-electron-live-suite]
---

# Post-M1 Phase 6 acceptance RED

## Files

- `apps/web/tests/post-m1-phase-6-files-diffs-search-worktrees.redspec.ts` — 14 Playwright contract criteria for real selection/attachment, server-side file search, Files, Changes/VCS/export/revert, branch create, resolved worktree identity, reset, and remove.
- `apps/web/tests/post-m1-phase-6-fixture-playwright.config.ts` — explicit live-mode renderer config; deliberately failing `.redspec.ts` files stay outside the M1 regression glob.
- `apps/api_server/src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts` — focused executable regression for the hard-delete false-success defect.
- `docs/ai/contracts/post-m1-phase-6.json` — c4a recorded RED; collected-but-unexecuted browser criteria and unwritten live/provider/Git criteria remain pending.

No product code was changed. No file listed in `apps/web/SHA256SUMS` was modified.

## Checks

### API contract — harness attempt 1 (invalid RED, repaired)

Command:

```text
cd apps/api_server
npx vitest run src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts --no-file-parallelism
```

Verbatim output:

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

stdout | src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts > post-m1 Phase 6 files/worktrees acceptance contract > post-m1-p6-c4a: hard delete fails closed when engine worktree removal returns false
backfill_scheduled_date_v1: tasks updated=0, project_steps updated=0

 ❯ src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts (1 test | 1 failed) 1582ms
     × post-m1-p6-c4a: hard delete fails closed when engine worktree removal returns false 1582ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts > post-m1 Phase 6 files/worktrees acceptance contract > post-m1-p6-c4a: hard delete fails closed when engine worktree removal returns false
AssertionError: expected "vi.fn()" to be called with arguments: [ …(2) ]

Number of calls: 0

 ❯ src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts:83:28
     81|     });
     82|
     83|     expect(removeWorktree).toHaveBeenCalledWith(
       |                            ^
     84|       '/phase6/worktrees/nonce-false-success',
     85|       '/phase6/worktrees/nonce-false-success',

 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  19:47:23
   Duration  1.84s (transform 1.19s, setup 0ms, import 178ms, tests 1.58s, environment 0ms)
```

Disposition: not counted as RED. Direct `repo.insert` did not persist worktree metadata, so the controller correctly had no cleanup target. Repaired by assigning the canonical persisted columns in the in-memory test DB before calling the real HTTP route.

### API contract — valid RED

Command:

```text
cd apps/api_server
npx vitest run src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts --no-file-parallelism
```

Verbatim output:

```text
 RUN  v4.1.1 /Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite/apps/api_server

stdout | src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts > post-m1 Phase 6 files/worktrees acceptance contract > post-m1-p6-c4a: hard delete fails closed when engine worktree removal returns false
backfill_scheduled_date_v1: tasks updated=0, project_steps updated=0

 ❯ src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts (1 test | 1 failed) 1431ms
     × post-m1-p6-c4a: hard delete fails closed when engine worktree removal returns false 1431ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts > post-m1 Phase 6 files/worktrees acceptance contract > post-m1-p6-c4a: hard delete fails closed when engine worktree removal returns false
AssertionError: false engine cleanup must not be reported as HTTP 204 success: expected 204 not to be 204 // Object.is equality
 ❯ src/__tests__/post_m1_phase_6_files_worktrees_contract.test.ts:95:98
     93|       '/phase6/worktrees/nonce-false-success',
     94|     );
     95|     expect(response.status, 'false engine cleanup must not be reported…
       |                                                                                                  ^
     96|     expect(repo.findById(row.id)).toMatchObject({
     97|       worktreeName: 'nonce-false-success',

 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  19:47:46
   Duration  1.68s (transform 1.16s, setup 0ms, import 162ms, tests 1.43s, environment 0ms)
```

Disposition: valid RED. The test ran through the real Express route/controller, proved `removeWorktree` received the canonical project/worktree paths and returned `false`, then failed because the controller still returned 204.

### Playwright collection only

Command:

```text
cd apps/web
npx playwright test --config tests/post-m1-phase-6-fixture-playwright.config.ts --list
```

Verbatim output:

```text
Listing tests:
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:70:1 › post-m1-p6-c1a: real file selection classifies canonical parts from selected bytes
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:86:1 › post-m1-p6-c1b: @ search requests canonical server-side find-files and content routes
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:101:1 › post-m1-p6-c1c: selected attachments cross live input as canonical parts
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:113:1 › post-m1-p6-c1d: attachment chips preserve canonical filename and mime until accepted delivery
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:125:1 › post-m1-p6-c1e: an oversized canonical parts payload retains retryable composer state
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:137:1 › post-m1-p6-c2a: Files inspector uses find/list/content/status server results
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:152:1 › post-m1-p6-c2c: Changes inspector fetches canonical session FileDiff
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:160:1 › post-m1-p6-c2d: VCS scopes request only canonical git and branch modes
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:174:1 › post-m1-p6-c2e: patch export requests and preserves raw text/x-diff
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:182:1 › post-m1-p6-c2f: Revert posts canonical messageId and refreshes session diff
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:195:1 › post-m1-p6-c3a: advanced creation sends branch, stash, and createBranch canonical fields
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:210:1 › post-m1-p6-c3b: isolated create preserves resolved worktree identity and returned branch
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:222:1 › post-m1-p6-c3d: Reset posts the live session worktree route
  post-m1-phase-6-files-diffs-search-worktrees.redspec.ts:231:1 › post-m1-p6-c3e: Remove is closed-only and posts the live session worktree route
Total: 14 tests in 1 file
```

Chromium was not launched. These criteria remain `pending` until the orchestrator executes the config and records assertion results.

### Contract validation

Command and output:

```text
$ jq -e '.criteria | length == 24 and (map(.criterion_id) | unique | length == 24) and (all(.[]; (.status == "red" or .status == "pass" or .status == "pending" or .status == "not_tested")))' docs/ai/contracts/post-m1-phase-6.json
true
```

A later compact recheck initially used the malformed expression
`([.criteria[].status] | all(...))` without preserving the root context and returned
`jq: error ... Cannot index array with string "criteria"`. The corrected command was:

```text
$ jq -e '(.criteria | length == 24) and ([.criteria[].status] | all(. == "red" or . == "pass" or . == "pending" or . == "not_tested"))' docs/ai/contracts/post-m1-phase-6.json
true
```

### Sandbox and residue

Sandbox status remained unchanged:

```text
sandbox: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox
live-artifact storage: /var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T//rhythm-dev-sandbox/live-artifacts
api :4098 listener: 27366
engine :4097 listener: 27394
gateway :4099 listener: 27366
```

The sandbox profile query returned:

```json
[{"id":"local-lean","model_provider":"omlx","model_id":"gpt-oss-20b-MXFP4-Q8"}]
```

The auth-key check returned `true` for absence of `lmstudio`; keys were `anthropic`, `google`, `ollama-executor`, `ollama-planner`, `openai`, and `openrouter`.

Residue checks found zero matching sandbox rows, zero matching worktree registry entries, zero matching branch refs, and no worktree directory created by this unit. The only filesystem matches were Playwright transform-cache files created by `--list` and unrelated pre-existing `/private/tmp` artifacts; neither is a session/worktree/branch resource.

## Routes verified

All asserted HTTP routes exist in `apps/api_server/src/routes/agent_sessions_routes.ts`:

- `POST /agent-sessions` — line 67.
- `GET /agent-sessions/:id/diff` — line 70.
- `GET /agent-sessions/:id/files/find-files` — line 86.
- `GET /agent-sessions/:id/files/list` — line 87.
- `GET /agent-sessions/:id/files/content` — line 88.
- `GET /agent-sessions/:id/files/status` — line 89.
- `GET /agent-sessions/:id/vcs/diff?mode=git|branch` — line 93.
- `GET /agent-sessions/:id/vcs/diff/raw` — line 94.
- `POST /agent-sessions/:id/worktree/reset` — line 111.
- `POST /agent-sessions/:id/worktree/remove` — line 112.
- `DELETE /agent-sessions/:id/hard` — line 118.
- `POST /agent-sessions/:id/revert` — line 121.
- `POST /agent-sessions/:id/unrevert` — line 122.

The separately scoped worktree wrapper routes also exist at `apps/api_server/src/routes/opencode_worktrees_routes.ts:107-127`.

## Notes

- Complete provider/Git lifecycle criteria c3c and c4b–c4f were not written or run within this unit. They remain pending instead of being weakened into mock-only assertions.
- API/UI cross-boundary security criteria c2b, c2g, and c3f also remain pending because the full criterion could not be honestly proven by the focused tests written here.
- No commit, push, branch switch, worktree creation/removal, sandbox restart, or server launch occurred.
