---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: in_progress
tags: [run, Rhythm]
---

# Primary conversation availability when its working directory disappears

## Files

- `apps/api_server/src/services/coordinator_conversation_service.ts`: status checks the designated primary's current owner, project, session, profile, setup provenance and actual working-directory identity before and after asynchronous context work. A missing, replaced, or non-directory primary workspace yields the existing `context_unavailable` response. Fresh owned setup requires its canonical workspace beneath the configured live-artifact root; existing nonfresh primaries retain valid symlinked directories.
- `apps/api_server/src/__tests__/coordinator_conversation_navigation.test.ts`: real temporary project directories and red/green coverage for missing cwd, a disappearance during context assembly, fresh setup provenance, a nondirectory path, an existing symlinked primary, and a generic nonprimary conversation.
- `apps/api_server/src/__tests__/coordinator_calendar_project_context.test.ts`: provide an actual project cwd for its already-designated primary fixture.

## Checks

- Real packaged RED at source `19421753e05a7a1b2d0f09fcbd04063650e8390c`: `packaged-ai-001-primary-missing-cwd.spec.ts` renamed only the inert private canonical cwd and observed the UI saying `Rhythm is ready.`; full native receipt `/private/tmp/rhythm-private-19421753e0-native-confirm.log`. The exact journal, history, ordinary chat, and cwd restoration remained unchanged.
- New focused unit RED before the service edit: the missing-directory case expected `context_unavailable` and received `status` (21 passed, 1 failed). No production identity or authorization gate was weakened to reach it.
- Guarded serial related Coordinator cluster: `npm run build:guard -- npm --prefix apps/api_server test --silent -- src/__tests__/coordinator_calendar_project_context.test.ts src/__tests__/coordinator_conversation_navigation.test.ts src/__tests__/coordinator_conversation_runtime_adapters.test.ts src/__tests__/coordinator_conversation_context.test.ts src/__tests__/coordinator_conversation_setup_scope.test.ts src/__tests__/coordinator_conversation_repository.test.ts src/__tests__/coordinator_conversation_service.test.ts src/__tests__/coordinator_conversation_vertical.test.ts --fileParallelism=false` passed 8 files and 86 tests. Complete output: `/private/tmp/rhythm-primary-cwd-coordinator-cluster-20261020.log`.
- Guarded API TypeScript: `npm run build:guard -- ./node_modules/.bin/tsc -p apps/api_server/tsconfig.json --noEmit` exited 0.

## Notes

- GitNexus upstream impact on `statusForConversation` and `currentRootSelection` was UNKNOWN because its index lagged this worktree by 301 commits. Manual caller inspection classified the shared status/HTTP/mobile/model-status/foreground area HIGH impact; the parent was notified before production edits. The change is limited to designated primary status. Generic conversation status and ordinary-chat behavior remain covered by the related tests.
- The env-gated real packaged/API/engine test above is the behavioral confirmation gate after the next source-matched signed bundle. This source and unit result alone does not qualify the rebuilt native client or foreground message admission.
- Foreground sends reserve a command before confirming workspace availability. A separate admission guard is needed before reservation and after awaits, including the initializer's await before SDK session creation; do not treat the status result as send safety. No foreground behavior was changed in this repair.
