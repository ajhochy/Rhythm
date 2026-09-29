# Rhythm — Project State

## Current focus

Mobile chat-list polish plus verified auto-scroll follow-up: compact project headers/session rows, full-width search with a separate sort/new-chat row, exact-project project-header create action, generation-protected profile loading, compact session configuration, and reliable chat transcript positioning.

## Active branch / PR

Branch `mobile/chat-list-compact-project-create`, based on `mega/2026-09-18-mobile-electron-hermes` (not `main`). Draft PR #1585 exists. Auto-scroll changes remain uncommitted and unpushed.

## In progress

Manual native timing/layout smoke remains for 375–430pt header/search layouts, 844pt session-sheet fit, and auto-scroll behavior.

## Risks / known issues

- Full-suite failures are the unchanged base-red issue-1387 offline session/cold-relaunch failures; they are not caused by this slice.
- Broader mega integration context and its existing pause/hand-off remain unchanged.

## Test status

PASS: focused auto-scroll 8/8, combined chat contracts 58/58, accessibility 8/8, lint/typecheck. Full suite: 239 passed, 4 unchanged base-red issue-1387 failures.

## Next step

Complete the manual native timing/layout smoke, then continue the draft-PR handoff. Keep the issue-1387 failures as a separate follow-up.

## Existing integration context

Rhythm integration remains in draft mega PR #1544 on `mega/2026-09-18-mobile-electron-hermes`; the broader orchestration pause and hand-off remain unchanged. Hermes clean integration, Bot Crossing, shared agents/settings, Colony, memory, profile allowed-skills management, and the unresolved #1572/#1540/#1576 work remain as previously recorded in the durable run notes.

The 2026-09-28 candidate-unblock state remains unchanged: signed local candidates are required; relay outbox and attachment handling are integrated; the fork SDK/engine contract fingerprint is synchronized; #1584, DB VACUUM, Electron attachment thumbnails, and candidate UI smoke remain open.

## Historical verification boundaries

Prior broad CI/local verification boundaries, issue coverage, and release-acceptance limitations remain historical context rather than current all-green claims. No credential store or vault was modified. The integration worktree remains dirty and diverged; this slice did not commit, push, merge, deploy, or release. Required sandbox teardown is complete.
