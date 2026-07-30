---
date: 2026-07-30
repo: Rhythm
branch: codex/msp-003-shared-pending-interactions
pr: null
issues: [3]
status: implemented
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# MSP-003 — shared pending interactions

## Files

- Added the canonical pending-interaction model and bridge coordinator.
- Added engine snapshot/cold-map recovery and desktop attach snapshots.
- Routed desktop and paired-mobile resolutions through the coordinator.
- Changed Flutter permission/question cards to clear only after acknowledgement.
- Added API, P0-regression, Flutter widget, and env-gated live contracts.

## Checks

- Root `npm install`: PASS (217 packages; audit reported 12 pre-existing
  dependency advisories: 1 low, 7 moderate, 4 high).
- Initial API acceptance run: RED as expected — 8 failed, 0 passed, 1 skipped.
- `cd apps/api_server && npx tsc --noEmit`: PASS.
- Required API/P0 contract run: PASS — 28 passed, 0 failed, 1 live skipped.
- Related bridge/permission/question regressions: PASS — 71 passed, 0 failed.
- `cd apps/api_server && npm run build`: PASS.
- Flutter `pub get --offline`: PASS using a writable temporary SDK/pub-cache
  overlay because the installed SDK cache is outside the filesystem sandbox.
- `dart format . --set-exit-if-changed`: PASS on the second check, 441 files,
  0 changed.
- `flutter analyze --no-pub --no-fatal-infos`: PASS with 273 pre-existing info
  findings and no errors/warnings.
- Flutter widget contract: BLOCKED by the sandbox's loopback socket policy
  before test loading (`ServerSocket.bind(127.0.0.1, 0): Operation not
  permitted`), 0 tests executed.
- `git diff --check`: PASS.
- GitNexus impact/detect tooling was unavailable in this worktree
  (`.gitnexus/run.cjs` absent and no GitNexus MCP tools exposed); local
  call-site analysis was used before edits.

## Live contract (written, not run)

The workstream safety contract forbids starting the sandbox or any server.
The integrator must build the fork/API, start the isolated sandbox, then run:

```bash
cd apps/api_server
RHYTHM_LIVE_E2E=1 \
RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
npx vitest run src/contract/msp_003_live_e2e.test.ts \
  --no-file-parallelism
```

The test observes a real `question.asked`, late-attach snapshot, two-answer
race, canonical acknowledgement, and engine continuation. It deliberately
refuses shipping ports.

## Notes

- Failure triage: three #1156 auto-permission tests initially failed because
  they asserted the legacy resolved frame synchronously. The shared resolver
  now correctly waits for engine acknowledgement; those tests were updated to
  wait for the post-ack frame, then passed 5/5. No follow-up issue was filed.
- P0's owner resolution, hidden per-turn memory context, and persistence
  boundary were not changed; both P0 contract files remained green.
- The R1 child-session upsert/late-parent/pending-child drain region in
  `opencode_stream_bridge.ts` was not touched. MSP-003 changes are confined to
  interaction maps/recovery, stream attach/reconnect, permission/question
  event handling, and disposal.
