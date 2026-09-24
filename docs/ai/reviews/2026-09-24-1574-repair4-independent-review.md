# Independent read-only review — #1574 Repair 4

Date: 2026-09-24. Candidate `/private/tmp/rhythm-swarm-1574`, branch `swarm/issue-1574`, HEAD `a2581505`. Reviewed the worker receipt, original issue, focused source/test diff and surrounding ownership/signal path. No edit, test, server, or process cleanup was performed in this review.

## Finding

No new actionable defect found in the bounded old-port repair. `isServeProcess` now matches the selected executable's `serve --http --port <number> --host 127.0.0.1` invocation without requiring the current configured port (`apps/api_server/src/services/engraph_manager.ts:129-135`). `getStatus` classifies an unmarked match as `stray`/`unknown`/`inspect-manually` (`:624-647`). `_doStart` performs the process scan synchronously before publishing a new reservation and refuses startup if inspection fails or an unmarked match is present (`:925-945`), preserving the same-process reservation order. The changed discovery path contains no new signal operation; signal decisions remain in the separately identity-gated ownership paths.

The new fixture starts a fake Engraph serve process at a different port and HOME, then asserts that status reports it, startup refuses another backend, and the foreign PID survives (`apps/api_server/src/__tests__/issue_1574_engraph_ownership.test.ts:53-96`). The supplied RED log independently confirms the old candidate returned `backends=[]` (14 passed, 1 failed). The worker reports isolated manager/ownership 52/52 and route 7/7, plus passing TypeScript/build/diff checks; full GREEN logs were not attached to this review, so those counts are report-derived.

## Scope and limits

- A matching command cannot prove the process's HOME or vault. Refusing startup and asking for manual inspection is conservative; the code does not adopt or kill an unmarked process. This can also block startup for an unrelated Engraph serve using the same selected executable, as intended by the fail-closed boundary.
- Original #1574 root-cause and abnormal-termination acceptance require real process/runtime evidence. The inherited env-gated parent-death test used a fake CLI only. Real Engraph, API/engine, packaged app, and existing-machine cleanup remain unverified; contract c2 and c4 accurately retain their limits.
- The test asserts a foreign process survives only through the startup attempt, then explicitly terminates its own test child in `afterEach`; no production process was inspected or changed in this review.

## Preservation

- SHA-256 before and after review matched: `apps/api_server/src/services/engraph_manager.ts` `6e9180a54f7b490a27739eaf5b04d0e0945cb7f0e24844c1943ea10bbbf6b7c9`; `apps/api_server/src/__tests__/issue_1574_engraph_ownership.test.ts` `91c6d89ebabba8a89a542bcde0f2593c8aceb6e872a971fe77741ef37858e7f9`.
- `git diff --check` exited 0. Worktree remained dirty only in its six pre-existing issue files; this review added nothing to it.
