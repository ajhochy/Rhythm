# Rhythm — Project State

## Current focus

Mobile chat-list polish slice: compact project headers/session rows, full-width search with a separate sort/new-chat row, reduced Chats title, exact-project project-header create action, generation-protected profile loading, and a compact session configuration sheet.

## Active branch / PR

Branch `mobile/chat-list-compact-project-create`, based on `mega/2026-09-18-mobile-electron-hermes` (not `main`). Verification passed; no commit or PR exists yet.

## In progress

Manual smoke remains for 375–430pt header/search layouts and 844pt session-sheet fit.

## Risks / known issues

- Full-suite failures are the unchanged base-red issue-1387 offline session/cold-relaunch failures; they are not caused by this slice.
- Broader mega integration context and its existing pause/hand-off remain unchanged.

## Test status

PASS: lint/typecheck, 50 focused tests, and 8 accessibility tests. Full suite: 236 passed, 4 unchanged base-red issue-1387 failures.

## Next step

Run the two manual smoke checks, then continue the normal draft-PR handoff. Keep the issue-1387 failures as a separate follow-up.

## Existing integration context

Rhythm integration remains in draft mega PR #1544 on `mega/2026-09-18-mobile-electron-hermes`; the broader orchestration pause and hand-off remain unchanged. Hermes clean integration, Bot Crossing, shared agents/settings, Colony, memory, profile allowed-skills management, and the unresolved #1572/#1540/#1576 work remain as previously recorded in the durable run notes.

The 2026-09-28 candidate-unblock state remains unchanged: signed local candidates are required; relay outbox and attachment handling are integrated; the fork SDK/engine contract fingerprint is synchronized; #1584, DB VACUUM, Electron attachment thumbnails, and candidate UI smoke remain open.

## Historical verification boundaries

Prior broad CI/local verification boundaries, issue coverage, and release-acceptance limitations remain historical context rather than current all-green claims. No credential store or vault was modified. The integration worktree remains dirty and diverged; this slice did not commit, push, merge, deploy, or release. Required sandbox teardown is complete.
