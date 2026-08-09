---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-02]
status: READY_FOR_VERIFICATION
tags: [run, api_server, live-artifacts]
---

## Files

- Added live-artifact model, repository, immutable storage service, controller, routes, focused API contract, and env-gated live HTTP test.
- Mounted `/live-artifacts` outside `env.agentExecutionEnabled` in `app.ts`.
- Preserved pre-existing AV-01 schema/env/docs changes. No AV-01 repair was needed.

## Contract

- `docs/ai/contracts/live-artifacts-av02.json`: c1–c9 pass; c9 scope review is recorded below.
- Repair contract before implementation: `cd apps/api_server && npx vitest run src/__tests__/live_artifacts.test.ts --no-file-parallelism` failed 3/11 as intended: revoked shared member still listed (1 vs 0), CSP lacked `sandbox allow-scripts`, and raw `ENOENT` state path/stack reached the captured error log.

## Checks

- `cd apps/api_server && npx vitest run src/__tests__/live_artifacts.test.ts src/__tests__/live_artifacts_schema_parity.test.ts --no-file-parallelism` — PASS, 9 tests.
- `cd apps/api_server && npx vitest run src/__tests__/tasks_permissions.test.ts --no-file-parallelism` — PASS, 4 tests.
- `cd apps/api_server && node_modules/.bin/tsc --noEmit` — PASS.
- `cd apps/api_server && npm run build` — PASS.
- `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status` — PASS; API :4098, engine :4097, isolated storage root.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_SANDBOX_DB="$TMPDIR/rhythm-dev-sandbox/rhythm.db" RHYTHM_LIVE_DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/live_artifacts_live_e2e.test.ts --no-file-parallelism` — PASS, 1 test (real API create/render/read/CAS-update/delete/410).
- `tools/dev/sandbox.sh down` — PASS.
- `git diff --check` — PASS.
- `gitnexus_detect_changes(scope=all)` — LOW; index reports only pre-existing indexed AV-01 symbols plus `createApp`, with zero affected processes. Route map has no result because the GitNexus index predates this uncommitted route.
- Repair focused regression: `cd apps/api_server && npx vitest run src/__tests__/live_artifacts.test.ts src/__tests__/tasks_permissions.test.ts --no-file-parallelism` — PASS, 20 tests.
- Repair static checks: `cd apps/api_server && node_modules/.bin/tsc --noEmit && npm run build` — PASS.
- Repair sandbox: `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status` — PASS (API :4098, engine :4097, isolated storage root); the lifecycle rebuilt the fork/API. `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_SANDBOX_DB="$TMPDIR/rhythm-dev-sandbox/rhythm.db" RHYTHM_LIVE_DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" DB_PATH="$TMPDIR/rhythm-dev-sandbox/rhythm.db" npx vitest run src/__tests__/live_artifacts_live_e2e.test.ts --no-file-parallelism` — PASS, 2 tests: real HTTP CAS, revocation list/detail 404, missing state response/log path-stack probe. `tools/dev/sandbox.sh down` — PASS; generated storage removed.
- `git diff --check` — PASS. Changed-file ownership is limited to authorized AV-02 repository/storage/controller, focused API/live tests, contract, and run note; existing AV-01 untracked/modified files remain untouched.

## Notes

- Final atomic-publish repair acceptance contract was written before implementation and failed as intended: 2/20 failures, with updated bundle render returning `500` (missing files after the old early `mkdir(destination)` return) and a legacy empty hash destination remaining empty. The same contract passes after the storage-only repair: 20/20.
- Final repair impact was assessed manually because GitNexus cannot index uncommitted `publishBundle` (impact lookup returned target-not-found). Triage traced exactly two callers (`create` and `updateBundle`) and the render reader; DB pointer writes remain after successful publication. Blast radius is confined to the three live-artifact routes. `publishState` was intentionally untouched because triage proved second-state publication works.
- Final repair checks: focused API/auth/schema suite PASS, 25 tests; API `tsc --noEmit` PASS; API build PASS; restarted sandbox `:4098`/engine `:4097` PASS; env-gated live HTTP E2E PASS, 2 tests including bundle update → render; `.gitignore` excludes `apps/api_server/live-artifacts/` and focused test cleanup removes generated storage.
- `publishBundle()` now creates the parent and unique temp directory, writes all fixed files, then renames. Rename collisions are idempotent only for an exact three-file bundle whose canonical hash matches; only a confirmed empty legacy destination is removed for one retry. All other failures reach `fail()` and clean the temp directory.
- 2026-08-08 AV-02 repair attempt 1 pre-edit impact: GitNexus cannot resolve the uncommitted AV-02 symbols because its index predates this branch (all `canRead`, `LiveArtifactStorage`, and `LiveArtifactsController` queries returned not found). Manual assessment: `LiveArtifactsRepository.canRead()` gates list plus detail/render/state/bundle/metadata/collaborator/delete handlers and is security-sensitive; this repair centralizes current workspace membership there. `LiveArtifactStorage` contains the four filesystem boundaries. The stale route index lacks `/live-artifacts`. `errorHandler` has true app-wide runtime blast radius despite stale GitNexus LOW/0 and is intentionally untouched.
- Server CSP evidence is complete: assembled documents have `sandbox allow-scripts` and `frame-ancestors 'none'`, no permissive sandbox tokens, stripped stored meta refresh, and only the two injected tags carry the response nonce. Native WKWebView runtime enforcement is **not_tested**: AV-06 owns that client surface; no Flutter/WebView change was made.
- The first live-test attempt was correctly rejected by the isolation guard because `DB_PATH` was omitted; rerun included the sandbox DB path and passed.
- Documented pre-existing order-dependent API-suite flake was not run or modified; focused clean-shell suites were used.

## c9 code-scope review

- Product changes are exactly the shared `canRead()` membership guard, the `LiveArtifactStorage` filesystem-error containment helper at four boundaries, and render-only CSP/template hardening.
- No MCP, Flutter, PCO, Gallery, schema, app mount, or global error/logging capability was implemented or changed. `WorkspaceRepository.findMember` is SQLite-only; the existing dual-dialect `isWorkspaceMember()` was deliberately reused so Postgres remains correct.
