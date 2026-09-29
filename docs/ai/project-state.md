# Rhythm — Project State

## Current focus

Verified ST-1 mobile transcript delta streaming and the preceding NC-1/NC-2 new-chat performance repair. The real anonymous SDK delta shape renders 100 deltas in 101–104ms with one batched commit and no pre-idle GETs; idle reconciliation remains authoritative after loss/reordering.

## Active branch / PR

Branch `mobile/transcript-delta-streaming`, stacked on the PR #1585 branch `mobile/chat-list-compact-project-create` (not `main`). No commit or PR exists for ST-1; draft PR #1585 remains the parent.

## In progress

Manual native timing/layout smoke remains for 375–430pt header/search layouts, 844pt session-sheet fit, auto-scroll behavior, and the native transcript streaming path.

## Risks / known issues

- Full-suite failures are the unchanged base-red issue-1387 offline session/cold-relaunch failures; they are not caused by this slice.
- Broader mega integration context and its existing pause/hand-off remain unchanged.
- The isolated verification sandbox was stopped after the gate. No live-service action occurred.

## Test status

PASS: ST-1 focused contract 12/12, combined chat/ST-1 80/80, Mobile CI foundation, typecheck, and lint (same 3 pre-existing warnings). Full Mobile Jest: 261/265; the same four issue-1387 parent-red failures remain. Real anonymous SDK protocol: 100 deltas visible in 101–104ms, one commit, 0 pre-idle GETs versus parent no visibility/0 commits/1 GET; idle reconciliation deep-equaled after 20% withheld/reversed. Prior NC-1/NC-2 evidence remains: awaited phases 6 → 2, profile GETs 2 → 1, blocking newly-created exact/messages reads 2 → 0.

## Next step

Complete the manual native timing/layout and transcript streaming smoke, then prepare the separate stacked ST-1 PR. Keep the issue-1387 failures as a separate follow-up.

Broader integration context remains unchanged: draft mega PR #1544 on `mega/2026-09-18-mobile-electron-hermes`, the orchestration pause/hand-off, and the existing Hermes, Bot Crossing, shared agents/settings, Colony, memory, profile allowed-skills, and candidate-unblock follow-ups remain recorded in the durable run notes. This slice did not commit, push, merge, deploy, or release.
