---
date: 2026-09-27
repo: rhythm
branch: codex/finish-1576-1582
pr: 1544
issues: [1576]
status: pushed-to-draft-pr
tags: [run, rhythm]
---

# Issue #1576 completion

## Files

- Fork stamp/trust boundary: `message-v2.ts`, `processor.ts`, `handlers/session.ts`, `served-provenance.test.ts`.
- API dispatch/projection wiring: `opencode_client_service.ts`, `agent_model_resolver.ts`, `ws_gateway.ts`, `turn_redispatch.ts`, `agent_runner.ts`, delegation/continuation services, `opencode_stream_bridge.ts`, provenance repository/service, and the prompt controller's trusted HTTP origin call.
- Contracts: `issue_1576_dispatch_writes.test.ts`, `issue_1576_routed_provenance_live_e2e.test.ts`, and `docs/ai/contracts/issue-1576-completion.json`.
- No #1582 web transcript, dependency, lock, packaged-output, PR-body, or project-state files changed.

## Checks

- Invoked `acceptance-contract` before implementation work.
- Confirmed `git status --short --branch` reported `codex/finish-1576-1582...origin/mega/2026-09-18-mobile-electron-hermes` with no worktree changes before this note.
- Preserved the first failed probe: model `{ providerID: "openrouter", modelID: "free" }` returned HTTP 400 with both sanitized booleans false. See the separate retrospective.
- Before the authorized corrected retry, `GET /provider` and the checked-in catalog fixture proved `{ providerID: "openrouter", modelID: "openrouter/free" }` existed. The running instance was not connected because the approved auth fixture had not been mounted by the file-form config path. A temporary symlink referenced the mode-0600 approved fixture without reading or copying it; `/instance/dispose` reloaded the instance and sanitized readiness became `correctedModelPresent=true`, `openrouterConnected=true`.
- Corrected pre-implementation request reached the provider successfully. Its served booleans remained false because the fork had not yet implemented the stamp; this was retained as the live RED condition rather than treated as provider failure.
- RED: `bun test test/session/served-provenance.test.ts` → 3 assertion failures (served schema/helper/trust boundary absent).
- RED: `npx vitest run src/__tests__/issue_1576_dispatch_writes.test.ts` → 5 assertion failures and 1 pass (dispatch writes, detailed resolution, linkage, projection absent).
- GitNexus pre-edit impact (indexed sibling): `OpencodeStreamBridge` MEDIUM, 53 affected/8 direct; `OpencodeClientService` MEDIUM, 88 affected/7 direct; resolver LOW. Target sibling index failed version compatibility, so the current compatible Rhythm index was used. Final `detect_changes(scope=all, worktree=...)` reported MEDIUM, 15 changed source files, 5 affected processes.
- `bun test test/session/served-provenance.test.ts && bun run typecheck` → 3 passed; typecheck passed.
- Fork build: `MODELS_DEV_API_JSON=... bun run build --single --skip-install --skip-embed-web-ui` → build and binary smoke passed.
- `npx vitest run` over issue B1/projection/new dispatch, resolver, redispatch/auth cascade, delegation auth, approval continuation, schema parity, and client tests → 11 files, 139 tests passed.
- `npm run build` in `apps/api_server` → TypeScript build and postbuild passed.
- `bun test test/session/message-v2.test.ts test/server/httpapi-session.test.ts test/session/processor-effect.test.ts` → 58 passed, 1 pre-existing permission-route failure (`Permission request not found`); isolated rerun reproduced 10 passed/1 failed. The changed #1576 fork contract and typecheck remain green.
- Exact sandbox restart variables from the dispatch were used after fork/API builds. Readiness: API `:4098`, engine `:4097`, gateway `:4099`.
- Live: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_SANDBOX_DIR=... npx vitest run src/__tests__/issue_1576_routed_provenance_live_e2e.test.ts` → first run proved concrete/gen/PATCH/projection but exposed wrong trusted HTTP origin (`ws_input`); surgical repair changed only the server-owned third argument. Rerun: 2 passed.
- Restart durability probe recorded only `preRestartConcreteAndGeneration=true` and `postRestartHistoryRetainsConcreteAndGeneration=true` around an exact-variable sandbox restart.
- Cleanup checks: `disposableSessionsRemoved=true`, `disposableProfilesRemoved=true`; disposable engine sessions were deleted. The temporary auth symlink was removed, the sandbox was restarted, and sanitized status reported `sandboxHealthy=true`, `temporaryOpenRouterConnectionRemoved=true`.
- `git diff --check` passed. No commit, push, merge, deploy, or credential output occurred during verification. Required final sandbox teardown later succeeded; the sandbox was removed and diagnostics were preserved at `/private/tmp/rhythm-finish-partials-sandbox-20260927.evidence.C2M6AP`.

## Notes

- Provider credentials and auth-file contents were never read, printed, logged, tokenized, or copied. Only connection/provenance booleans were emitted.
- Live OpenRouter assertions proved the routed alias differed from the concrete served model and the response ID matched `^gen-`; no identifier value was printed or recorded.
- Safe synthetic resolver/redispatch suites cover fallback and budget behavior. No production-only budget knob was fabricated; no additional provider credential was used.
- Existing slim Inspector remains unchanged; no dispatch-history UI was added.
- PUSHED-TO-DRAFT-PR. Commit `ca651a34` completes routed-model provenance in draft PR #1544: https://github.com/ajhochy/Rhythm/pull/1544. Residual unrelated gate: the fork's existing `httpapi-session.test.ts` permission response case remains red as documented above. Follow-up recording commit `83dc468a` is also pushed; no force push, merge, deployment, or release.

## Integrated repair attempt 1

WAIVED: test-fixture and evidence-only repair with no product behavior change; verification is the exact nine-file clean-env gate, full clean-env API suite, API build, JSON validation, and diff check.

- Updated only the nine authorized stale test seams: resolver mocks now expose the additive provenance wrapper; prompt assertions retain their behavior checks and accept the trusted trailing provenance object without matching generated IDs or the full record.
- No product source, provider, image, or sandbox lifecycle operation was used in this repair.
- Exact clean-env focused command unset `RHYTHM_API_BASE`, `RHYTHM_LIVE_API_URL`, `RHYTHM_LIVE_ENGINE_URL`, `RHYTHM_OPENCODE_ENGINE_PORT`, and `RHYTHM_MOBILE_GATEWAY_PORT`, then ran the nine authorized files. Attempt 1: 8 files/64 tests passed and one `issue_738_agent_runner` assertion failed because that intentionally DB-less case correctly supplied trailing provenance as `undefined`; no product fallback was added. Assertion repair preserved that boundary while the DB-backed AgentRunner case still requires `origin: agent_runner` and trusted IDs/model fields.
- Exact nine-file clean-env rerun: 9 files, 65 tests passed.
- Full clean-env API suite: 709 files passed, 147 skipped; 6,680 tests passed, 284 skipped (856 files / 6,964 tests total).
- Clean-env `npm run build`: TypeScript build and postbuild passed.
- Both completion contract JSON files parsed successfully; final `git diff --check` passed. No provider calls, images, sandbox stop/restart, commit, push, or merge occurred.
