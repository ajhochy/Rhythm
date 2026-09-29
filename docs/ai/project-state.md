# Rhythm — Project State

## Current focus

Verified NC-1/NC-2 new-chat performance repair for the mobile chat-list polish slice. Actual baseline/current provider flows measure awaited phases 6 → 2, profile GETs 2 → 1, and blocking newly-created exact/messages reads 2 → 0.

## Active branch / PR

Branch `mobile/chat-list-compact-project-create`, based on `mega/2026-09-18-mobile-electron-hermes` (not `main`). Draft PR #1585 exists. The verified new-chat repair remains uncommitted and unpushed.

## In progress

Manual native timing/layout smoke remains for 375–430pt header/search layouts, 844pt session-sheet fit, and auto-scroll behavior. Streaming ST-1 is next as a separate stacked PR.

## Risks / known issues

- Full-suite failures are the unchanged base-red issue-1387 offline session/cold-relaunch failures; they are not caused by this slice.
- Broader mega integration context and its existing pause/hand-off remain unchanged.

## Test status

PASS: repeated focused NC-1/NC-2 verification 10/10, combined chat contracts 68/68, lint/typecheck. Actual provider baseline/current flow evidence: awaited phases 6 → 2, profile GETs 2 → 1, blocking newly-created exact/messages reads 2 → 0.

## Next step

Complete the manual native timing/layout smoke, then prepare the separate stacked ST-1 streaming PR. Keep the issue-1387 failures as a separate follow-up.

Broader integration context remains unchanged: draft mega PR #1544 on `mega/2026-09-18-mobile-electron-hermes`, the orchestration pause/hand-off, and the existing Hermes, Bot Crossing, shared agents/settings, Colony, memory, profile allowed-skills, and candidate-unblock follow-ups remain recorded in the durable run notes. This slice did not commit, push, merge, deploy, or release.
