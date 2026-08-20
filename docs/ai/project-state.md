# Rhythm — Project State

## Current focus
Bucket A task-sharing prerequisite is fixed, verified, and open as draft PR #1463. Preserve the
parallel Org Optimizer workflow and verified draft PRs #1383, #1453, #1459, #1460, #1461, and
#1462; none should merge before its documented manual smoke.

## Active branch / PR
- Current prerequisite branch: `codex/mega-prereq-task-sharing` → draft PR #1463.
- Mobile rebuild: `mobile/smart-client-rebuild` → draft PR #1383. Do not merge; AJ merges after
  manual on-device testing.
- Other verified drafts: H1 #1459, mobile relay #1460, H2 #1461, Electron packaging #1462;
  Numbat observability #1453 remains active and separate.

## In progress
- The prerequisite unblocks Bucket A final verification. Contract
  `docs/ai/contracts/task-bucket-a-task-sharing-prereq.json` passed 1/1.
- PR #1383 restores the React Native transport for #1270, #1308/#1311, #1364/#1366, and #1247.
  Its rebuild also restored the TestFlight `ascAppId` guard and wired the orphaned #1247 test into
  static CI. Server-side #1363 remained on main and was verified intact.
- The #1378/#1379 smart-client plan remains proposed and unimplemented; its authority and contract
  versioning decisions remain open.

## Risks / known issues
- Bucket A exposed a pre-existing main bug: collaborator PATCH responses falsely returned
  `isShared: false` because `findById` omitted the list-ownership expression. The prerequisite
  branch fixes it: owners remain false and collaborators return true.
- Existing full-suite parallel flakes may still occur in api_server vitest or mobile Playwright;
  isolated reruns pass.
- PR #1383 still needs the #1364 on-device ready-state smoke check.

## Test status
- Prerequisite verification PASS `bc34d61b-8165-455a-9019-b9c791736dc2`: focused 5/5, repo
  24/24, controller 26/26, API 4480, and live 9 flows. Owner false, collaborator true,
  unauthenticated 401, and cleanup complete. See
  `docs/ai/runs/2026-08-20-task-sharing-prereq.md`.
- PR #1383 remains green: mobile tsc/eslint, Jest 61/61, Playwright 71/71, static CI and 136-op
  contract; api_server gateway/proxy 17/17 and session-binding cleanup 3/3. Contract anchors were
  untouched.

## Next step
Run Bucket A final verification against prerequisite PR #1463 and H2 PR #1461. Keep every draft
unmerged until its documented manual smoke is complete.
