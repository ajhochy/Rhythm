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
- The initial status-only commit left foreground sends unqualified; they reserved a command before confirming workspace availability. The continuation below addresses that separate admission path.

## Foreground admission continuation

- `apps/api_server/src/services/coordinator_conversation_service.ts` now refuses a missing primary workspace before natural-goal capture and ordinary foreground reservation. The same server-derived owner/project/profile/cwd/inode proof is rechecked after root initialization, during Auto routing, after context assembly, and through the sender's current callbacks. A missing workspace after reservation keeps the existing uncertain settlement rather than authorizing a send.
- `apps/api_server/src/server.ts` receives a required trusted `workspaceCurrent` callback from the service and checks it before and after profile resolution, immediately before `opencodeClient.createSession`, and after SDK creation before binding the session. It is not a browser-supplied flag or an optional default-true bypass.
- `apps/api_server/src/__tests__/coordinator_chat_controls_parity.test.ts` uses a real private temporary workspace and covers absent-cwd zero reservation/route/SDK send, a held profile-resolution await with cwd rename before session creation, and valid-workspace ordinary chat when optional context fails. `apps/api_server/src/__tests__/coordinator_conversation_navigation.test.ts` covers absent-cwd zero natural-goal capture.
- `apps/api_server/src/__tests__/live_e2e_primary_missing_cwd.test.ts` is an opt-in synthetic-only sandbox API/engine test. It creates one private primary through normal setup, confirms real status, renames only its empty canonical cwd, observes 503 `context_unavailable` and unchanged root/history/engine sessions, restores the same inode, and confirms status recovers. It is default-skipped and **has not been run live yet**.

### Checks

- RED before admission guard: guarded targeted parity test expected `context_unavailable` for a missing primary cwd but got `foreground_uncertain` after the reservation path. One test failed, 45 skipped.
- GREEN: `npm run build:guard -- npm --prefix apps/api_server test --silent -- src/__tests__/coordinator_calendar_project_context.test.ts src/__tests__/coordinator_conversation_navigation.test.ts src/__tests__/coordinator_conversation_runtime_adapters.test.ts src/__tests__/coordinator_conversation_context.test.ts src/__tests__/coordinator_conversation_setup_scope.test.ts src/__tests__/coordinator_conversation_repository.test.ts src/__tests__/coordinator_conversation_service.test.ts src/__tests__/coordinator_conversation_vertical.test.ts src/__tests__/coordinator_chat_controls_parity.test.ts src/__tests__/live_e2e_primary_missing_cwd.test.ts --fileParallelism=false` passed 9 files/135 tests; the one live file/test skipped by default.
- `npm run build:guard -- ./node_modules/.bin/tsc -p apps/api_server/tsconfig.json --noEmit` exited 0 after the foreground edits.
- GitNexus upstream impact on foreground symbols was UNKNOWN/not found against an index 304 commits behind; `server.ts:main` mapped zero callers/LOW in that stale index. Manual blast radius remains HIGH across foreground HTTP/mobile, root SDK initialization, and Grid routing. No API or native runtime was launched during this continuation.

### Private sandbox behavioral observation

- On source commit `7b71e1cbad`, the guarded env-gated `live_e2e_primary_missing_cwd.test.ts` ran against the owned API 4098/fork 4097 sandbox built from the same source. It passed 1/1 (Vitest 1.71 s, command exit 0); full output `/private/tmp/rhythm-primary-missing-cwd-live-20261020-a.log`. Normal setup created one synthetic owner-1 primary using `config-doctor`; the test observed status 200, then missing-cwd status 503 `context_unavailable`, unchanged open/history/journal and no engine sessions in the cwd, same-inode restore, and recovered status 200. No message or model was sent in this first gate.
- A separate bounded real-API Recon then sent one benign arithmetic foreground request only while that exact empty owned cwd was renamed. It observed HTTP 503 `{kind:'context_unavailable'}` and zero children, durable commands, Grid route attempts, dispatches, or SDK sessions; the journal bytes were unchanged and the same inode was restored. Complete guarded output `/private/tmp/rhythm-primary-foreground-recon-20261020-a.log`; private 0600 metadata `/private/tmp/rhythm-primary-foreground-recon-20261020-a.json`. This was not a positive model turn.
- The env-gated live test now includes the observed missing-cwd foreground denial and zero-effects assertions. Its combined status-plus-message Confirm requires a fresh zero-root sandbox after this test-only edit; the first sandbox retains its owned root until the orchestrator's controlled teardown. No product source changed in this continuation.
