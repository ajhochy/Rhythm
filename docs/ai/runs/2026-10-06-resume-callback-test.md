---
date: 2026-10-06
repo: Rhythm
branch: integration/2026-10-06-resume
pr: 1604
issues: []
status: unverified
tags: [run, rhythm]
---

# Callback membership fixture teardown

## Files

- `apps/api_server/src/__tests__/coding_workflow_callback_membership.test.ts`: track deferred membership writes as promises, await them in asynchronous `onTestFinished`, and close the owned in-memory SQLite connection in `finally`. Append rejections propagate; no exception handler suppresses them. The late-membership case also asserts that the child eventually persists after its admission decision holds.

## Checks

- Baseline source: `49356cbdd7e4109238b6164bc7cb1b88bfc3a790`; parent full API run reported 823 passed/2 failed/150 skipped files, 8125 passed/4 failed/289 skipped tests, plus one unhandled database-not-open exception. Log `/private/tmp/rhythm-resume-api-full.log`; the four unrelated quota failures are owned and repaired elsewhere.
- RED: from `apps/api_server`, `npx vitest run src/__tests__/coding_workflow_callback_membership.test.ts --no-file-parallelism`: four assertions passed, exit 1, one unhandled `TypeError: The database connection is not open` at deferred `Immediate.append`. Log `/private/tmp/rhythm-resume-callback-red.log`.
- GREEN: same focused command after the repair: four passed, exit 0, no unhandled errors, 330 ms. Log `/private/tmp/rhythm-resume-callback-green.log`.
- Initial `npx tsc --noEmit` did not invoke TypeScript; npx selected the unrelated `tsc` package. No dependencies were installed or changed. Log `/private/tmp/rhythm-resume-callback-typecheck.log`.
- PASS: direct installed compiler `node node_modules/typescript/bin/tsc --noEmit`, exit 0, no diagnostics. Log `/private/tmp/rhythm-resume-callback-typecheck-direct.log`.
- PASS: `npx vitest run src/__tests__/coding_workflow_callback_membership.test.ts src/__tests__/coding_workflow_callback_anchor.test.ts src/__tests__/coding_workflow_callback_client.test.ts --no-file-parallelism`: three files, eleven tests passed, exit 0, no unhandled errors, 1.92 s. Log `/private/tmp/rhythm-resume-callback-focused.log`.
- PASS: `git diff --check`.

## Notes

- Diagnosis: fixture closed its SQLite database immediately after the hold decision, before its intentionally deferred membership append. Real repository append is synchronous; this failure came from fixture resource lifetime.
- GitNexus impact attempts for `fixture`, `append`, and gate `admit` returned target-not-found/UNKNOWN. Manual callers are confined to this test file's four cases. `detect-changes --scope unstaged` reported no indexed changes; the diff confirms the single owned test path.
- Decision: drain owned work rather than cancel the mutation, preserving proof that late membership actually lands. Automated cleanup also closes the fixture if assertions fail. No product source or admission assertion was relaxed.
- Patch was on disk by the focused green run at 08:51:48 local. Parent's concurrent aggregate suite may have loaded the old file before that point; parent owns final exact-source verification and integration.
- No API/app launch, live database, install, dist build, commit/push, or release. This test-only fixture repair does not change backend behavior. Live G2 and packaged/native acceptance remain separate parent-owned gates.
- Deviations: none. Suggested project-state update after independent gate: callback fixture unhandled teardown error repaired; focused evidence passed, aggregate result recorded separately.
