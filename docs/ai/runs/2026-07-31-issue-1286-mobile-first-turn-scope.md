---
date: 2026-07-31
repo: Rhythm
branch: codex/mobile-fixes-rollup
pr: 1284
issues: [1286]
status: passed-local-device-pending
tags: [run, Rhythm]
---

# Issue #1286 — mobile profile scope before first turn

## Files

- `apps/mobile/providers/opencode-provider.tsx`
- `apps/mobile/providers/services/mobile-gateway-service.ts`
- `apps/mobile/tests/transport-clients.test.mjs`
- `apps/api_server/src/services/mobile_opencode_proxy.ts`
- `apps/api_server/src/contract/issue_1286_mobile_first_turn_scope.test.ts`
- `apps/api_server/src/__tests__/issue_1286_mobile_first_turn_scope_live.test.ts`
- `docs/testing/results/recon-issue-1286.md` (local recon artifact; the
  repository intentionally ignores `docs/testing/results/`)

## Checks

- `cd apps/api_server && npx vitest run src/contract/issue_1286_mobile_first_turn_scope.test.ts` — initial RED, 1/2, proving the engine create body lacked agent/model/core permissions; final PASS, 2/2.
- `cd apps/api_server && npx vitest run src/contract/issue_1282_mobile_session_scope_parity.test.ts src/__tests__/issue_1175_mobile_gateway_security.test.ts --no-file-parallelism` — PASS, 11/11.
- `cd apps/api_server && npm run build` — PASS after the final create-model shape correction.
- `cd apps/mobile && npm run test:transport-clients` — PASS, including the real `PairedMacClient` external-I/O assertion for exact Device auth, project header, and `{title, profileId}` create JSON.
- `cd apps/mobile && npx eslint providers/opencode-provider.tsx providers/services/mobile-gateway-service.ts tests/transport-clients.test.mjs` — PASS.
- `cd apps/mobile && npm run typecheck` — PASS.
- `tools/dev/sandbox.sh up` on isolated API/engine/gateway ports 4498/4497/4499 plus direct assertion-free `POST /session` probes — fork build/binary smoke and API build PASS. The real fork returned HTTP 400 for `model.modelID` and HTTP 200 for `model.id`, preserving the supplied agent, permission, MCP, and skill fields; the sandbox was removed.
- Fresh paired live Confirm on isolated API/engine/gateway ports 4598/4597/4599 with an in-shell generated throwaway human-approval capability: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4598 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4597 RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-1286-confirm/rhythm.db RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1286-confirm RHYTHM_SANDBOX_OPENCODE_JSON=/tmp/rhythm-dev-sandbox-1286-confirm/home/.config/opencode/opencode.json RHYTHM_LIVE_SERVER_LOG=/tmp/rhythm-dev-sandbox-1286-confirm/api_server.log RHYTHM_LIVE_HUMAN_CAPABILITY=<throwaway-generated-in-shell> npx vitest run src/__tests__/issue_1286_mobile_first_turn_scope_live.test.ts --no-file-parallelism` — PASS, 4/4; sandbox removed.
- `git diff --check` — PASS for the shared rollup and for the focused #1286 files.
- GitNexus `impact` for `applyMobileSessionCreateScope` — LOW risk, one direct caller, one affected gateway process, 13 upstream symbols.
- GitNexus `detect-changes --scope all` on the shared rollup — MEDIUM, 21 files / 72 symbols / 3 existing mobile-gateway flows. This aggregate includes all concurrently integrated #1285 lanes; the directly edited #1286 symbol remains LOW.
- Parent `ai-workflow checks --level pr` — PASS across every configured
  Flutter, API, MCP, fork, mobile static/contract/fake-server, and browser E2E
  stage on the integrated worktree.
- Final combined isolated live rerun after the API compatibility correction —
  PASS, 3 files / 6 tests, including all four #1286 first-turn assertions.

## Notes

- The mobile SDK v2 serializer dropped the custom `profileId`; paired mobile create now uses the authenticated raw paired client so identity and title arrive atomically before engine session creation.
- The gateway validates the selected profile, strips caller-supplied agent/model/permission/MCP/skill fields, and resolves every scope field from the server-side profile. Invalid stored core-permission JSON fails closed with an internal error instead of degrading to an unrestricted session.
- Failure triage classified the first live HTTP 400 as a recon/codify error: the mocked contract used `modelID`, while the real fork's session-create schema requires `id`. Assertion-free recon preceded the corrected contract and implementation; the unchanged downstream first-model-request test then passed.
- The live control compared restricted and unrestricted profiles and asserted tool/skill contents, relative payload size, truthful returned profile state, and absence of scope-fallback warnings. No physical phone was used because it was disconnected; the parent owns the integrated PR/device gate.
