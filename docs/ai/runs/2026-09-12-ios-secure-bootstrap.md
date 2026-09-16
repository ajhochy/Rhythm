---
date: 2026-09-12
repo: Rhythm
branch: feature/ios-secure-bootstrap
pr: null
issues: [ios-secure-bootstrap-b1]
status: ready_for_verification
tags: [run, Rhythm]
---

# iOS secure bootstrap B1

## Files

- Added the executable contract and env-gated live relay/bootstrap test.
- Added authenticated relay environment discovery/connect backed by the sole durable `mobile_devices` owner/host enrollment.
- Added account-bound device grant issuance through the existing pairing repository and Device authentication lifecycle.
- Bound production uplinks to the enrolled owner/host and changed default bearer resolution to the existing cloud/local Google identity mapper.
- Added owner/project/session metadata to relay artifact caching and fail-closed cached reads.
- No schema change was needed; SQLite/Postgres pairing schema remains unchanged.
- Repaired the relay artifact test fixture to store the SHA-256 of the actual
  fixture bytes instead of an artifact ID in the schema-constrained checksum.

## Checks

- Pre-implementation contract: `npx vitest run src/contract/ios_secure_bootstrap.test.ts src/__tests__/ios_secure_bootstrap_live_e2e.test.ts --no-file-parallelism` — expected FAIL: 4 behavior assertions failed (`404` discovery/connect, unenrolled uplink remained open, foreign cached artifact returned `200`); live test skipped.
- Contract after implementation: same command — PASS: 7 passed, 1 skipped.
- `npm run build` — PASS after one TypeScript test-cast repair.
- Focused compatibility command: `npx vitest run src/contract/ios_secure_bootstrap.test.ts src/__tests__/ios_secure_bootstrap_live_e2e.test.ts src/services/__tests__/mobile_pairing_service.test.ts src/services/__tests__/mobile_cloud_identity_service.test.ts src/__tests__/relay_uplink_client_contract.test.ts src/__tests__/relay_uplink_server_contract.test.ts src/__tests__/relay_artifacts_contract.test.ts src/__tests__/mobile_gateway_routes.test.ts src/__tests__/mobile_gateway_postgres_schema.test.ts --no-file-parallelism` — first run: 41 passed, 14 failed, 1 skipped; root causes were unenrolled legacy harnesses and ownership-free artifact fixtures.
- Focused compatibility command after repair 1 — 53 passed, 2 failed, 1 skipped; remaining failures were synthetic artifact rows missing required foreign-key parents.
- `npx vitest run src/__tests__/relay_artifacts_contract.test.ts --no-file-parallelism` — reproduced 8 passed / 2 failed at `seedOwnership` with `CHECK constraint failed: length(checksum) = 64`; after using real fixture-byte SHA-256 values, PASS: 10 passed.
- Focused compatibility command from line 27 after fixture repair — PASS: 55 passed, 1 skipped (the env-gated live test).
- Synthetic fixture construction used the repository migrations and repositories to create a fresh SQLite database containing only one synthetic user, active session, and durable mobile enrollment, plus a minimal disabled local MCP config. Both sources were made read-only. Counts: `1|1|1`; source SHA-256 before and after sandbox use: DB `7ff4dad70124923eee01ff0e1f96a5be528274d4bf2fddcdaa870534f47026ed`, config `7c816ae4512fcc8667fa479b3d3ddb49d6f9aaf9dacc9acf9b550b76705f1b22`.
- Free-port preflight for `4198/4197/4199` — PASS, no listeners.
- First isolated `tools/dev/sandbox.sh up` attempt accepted preflight but stopped before process launch because the fork dependency tree lacked `@opentui/solid/preload`. `bunx bun@1.3.13 install --no-save` restored the lockfile-declared dependencies without retained manifest/lockfile changes.
- `RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-ios-bootstrap-fixture-20260912-2249 RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-ios-bootstrap-fixture-20260912-2249/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-ios-bootstrap-fixture-20260912-2249/opencode-config RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-ios-bootstrap-sandbox-20260912-2249 RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 RHYTHM_SANDBOX_GATEWAY_PORT=4199 RHYTHM_OPTIMIZER_MODE=shadow tools/dev/sandbox.sh up` — PASS: sandbox ready; API PID 82108 on `:4198`, fork engine PID 82129 on `:4197`, gateway PID 82108 on `:4199`; API build passed inside the workflow.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4198 RHYTHM_LIVE_IOS_BOOTSTRAP_BEARER=<synthetic> npx vitest run src/__tests__/ios_secure_bootstrap_live_e2e.test.ts --no-file-parallelism` — BLOCKED at the real HTTP discovery surface: expected `200`, received `404`. The one-process sandbox starts the default `all` role, which intentionally does not mount `/relay`; the `relay` role mounts it but intentionally disables the local engine/mobile gateway and still requires a separately managed authenticated uplink. `sandbox.sh` has no dual-role relay + local lifecycle, so no hand-rolled second server was started and this is not claimed as a live behavior pass.
- Prior single-role scoped `tools/dev/sandbox.sh down` — PASS; sandbox removed, all three assigned ports free, fixture hashes unchanged. Criterion `task-ios-secure-bootstrap-c8` was still `UNVERIFIED` at that stage.
- Dual-role continuation pre-implementation contract: `bash tools/dev/sandbox_dual_role_test.sh` — expected FAIL: 0 passed, 4 failed; relay mode/runtime variables, relay-port collision validation, and lifecycle cleanup hooks were absent.

## GitNexus

- LOW: `createRelayGatewayRouter` — 1 direct caller, 0 processes.
- LOW: `RelayUplinkServer` — 2 direct importers (`server.ts`, `relay_gateway_routes.ts`), 0 processes.
- MEDIUM: `MobilePairingService` — 8 direct dependents, 0 processes.
- MEDIUM: `MobileDevicesRepository` — 9 direct dependents, 0 processes.
- LOW: `createMobileGatewayRouter` — 3 direct callers, 0 processes.
- LOW: `RelayUplinkClient.pushArtifact` — 1 direct caller, 0 processes.
- LOW: `RelayUplinkClient.initializeConnection` — 1 direct caller, 0 processes.
- LOW: `MobileGatewayController` — 3 direct dependents; `createMobileGatewayRouter` process affected.
- LOW: `MediaArtifactsController` — 3 direct dependents; `createMobileGatewayRouter` process affected.
- HIGH, not edited: `OpencodeStreamBridge._relayEvent`, `apps/api_server/src/services/opencode_stream_bridge.ts` — 2 direct callers, 12-symbol blast radius, processes `resume`, `fork`, `create`, modules Services/Controllers/Models. Ownership metadata was derived in LOW-risk `RelayUplinkClient.pushArtifact` instead.
- Final `detect_changes(scope=all)` — MEDIUM: 36 indexed symbols changed, 3 affected processes, 9 indexed files. The affected processes are the existing `createMobileGatewayRouter` diagnostic flows (`RunCommand`, `MissingDiagnostic`, `LoggedOutDiagnostic`); no HIGH/CRITICAL changed-symbol result was reported.

## Deployment prerequisites

- Verify the Synology relay version and health before any rollout; this run did not touch production.
- Relay persistence must contain exactly one durable `(host_id, user_id)` enrollment in `mobile_devices`; zero or ambiguous owner/host pairs fail closed.
- The relay `users` row for that local owner must carry the Google subject/email binding matching the cloud `/auth/me` identity. Cloud numeric IDs are not trusted as local owner IDs.
- The enrolled Mac must use its existing configured `RHYTHM_RELAY_BEARER`; the updated client advertises the pairing service's durable host ID in the uplink hello.
- Final Cloudflare/Synology and iOS Simulator smoke remains manager-owned. The
  local sandbox now represents the required two roles without a third auth
  process.

## Notes

- No credentials, production actions, mobile files, shared project state/current plan, commits, pushes, or deployments were performed.
- Fixture and focused compatibility failures are fixed. The safe local
  dual-role behavioral slice is ready for verification; this is not production
  or real iOS Simulator evidence.
- Final tracked `git diff --numstat`:
  - `47 12 apps/api_server/src/__tests__/relay_artifacts_contract.test.ts`
  - `3 0 apps/api_server/src/controllers/media_artifacts_controller.ts`
  - `26 0 apps/api_server/src/controllers/mobile_gateway_controller.ts`
  - `37 0 apps/api_server/src/repositories/mobile_devices_repository.ts`
  - `6 0 apps/api_server/src/routes/mobile_gateway_routes.ts`
  - `137 10 apps/api_server/src/routes/relay_gateway_routes.ts`
  - `23 0 apps/api_server/src/services/mobile_pairing_service.ts`
  - `32 2 apps/api_server/src/services/relay_uplink_client.ts`
  - `30 34 apps/api_server/src/services/relay_uplink_server.ts`
- Final untracked diff names: `apps/api_server/src/__tests__/ios_secure_bootstrap_live_e2e.test.ts`, `apps/api_server/src/contract/ios_secure_bootstrap.test.ts`, `docs/ai/contracts/ios-secure-bootstrap.json`, `docs/ai/runs/2026-09-12-ios-secure-bootstrap.md`.
- The sandbox build's temporary `apps/opencode_fork/bun.lock` side effect was
  restored; no fork source or lockfile diff remains. `git diff --check` passed.

## Dual-role continuation

- Added opt-in `RHYTHM_SANDBOX_RELAY=1`; optional
  `RHYTHM_SANDBOX_RELAY_PORT` defaults to `4100`. Existing `up`, `down`,
  `status`, `restart`, and `restart-engine` commands and default
  `4098/4097/4099` topology are unchanged when the opt-in is absent.
- Relay runtime is isolated under `$RHYTHM_SANDBOX_DIR/relay` with its own
  writable DB copy, HOME, live-artifact storage, PID, and log. The local role
  receives only `ws://127.0.0.1:<relay-port>/relay/uplink` and the active
  synthetic session token from its copied DB. The relay validates that token
  through the existing local-session-first identity service; no bypass or
  production bearer weakening was added, and no token was printed.
- `bash -n tools/dev/sandbox.sh tools/dev/sandbox_guard_test.sh tools/dev/sandbox_dual_role_test.sh` — PASS.
- `bash tools/dev/sandbox_dual_role_test.sh` — PASS: 5 passed, 0 failed.
- `bash tools/dev/sandbox_guard_test.sh` — PASS: 18 passed, 0 failed.
- Initial final focused compatibility rerun — PASS: 55 passed, 1 env-gated
  skip. After the live-found gateway allowlist repair, the expanded final run
  including `mobile_gateway_surface.test.ts` passed 57, with 1 env-gated skip.
- Fixture preflight — PASS: source DB/config mode `-r--------`; one active
  enrolled user/session with non-null synthetic Google subject/email mapping;
  ports `4198/4197/4199/4200` free.
- Dual-role `tools/dev/sandbox.sh up` with the approved fixture, sandbox dir
  `/private/tmp/rhythm-ios-bootstrap-sandbox-20260912-2249`, local API `4198`,
  engine `4197`, gateway `4199`, relay `4200`, optimizer `shadow`, and relay
  opt-in — PASS. Fork smoke built
  `0.0.0-feature/ios-secure-bootstrap-202609130609`; API TypeScript build
  passed; relay connected and reported `macOnline: true`.
- Live attempt 1 reached relay discovery and failed connect `404`: the new
  `/mobile-gateway/bootstrap/connect` route was missing from the separate phone
  gateway's closed route allowlist. GitNexus impact for
  `isPhoneGatewayRoute` was LOW (1 direct caller, 2 total, no process), and the
  one-line allowlist repair was applied.
- Managed dual-role `restart` after rebuild — PASS. `status` reported local API
  PID/listeners on `4198/4199`, fork listener on `4197`, and distinct relay PID
  on `4200`.
- Live attempt 2 proved connect issuance but the initially selected session
  request returned `404 Mobile project not found`; the fixture intentionally
  has no project. The live assertion was narrowed to Device-authenticated
  `GET /projects`, a protected route that tunnels through relay to the local
  gateway without requiring a fabricated project.
- `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_API_URL=http://127.0.0.1:4200 RHYTHM_LIVE_IOS_BOOTSTRAP_BEARER=<synthetic-from-read-only-fixture> npx vitest run src/__tests__/ios_secure_bootstrap_live_e2e.test.ts --no-file-parallelism` — PASS: 1 passed. Observable behavior: one enrolled environment, connect grant, Device credential, relay health, and Device-authenticated local `/projects` response.
- Manager canonical re-verification used only the managed dual-role sandbox on
  engine `4397`, API `4398`, gateway `4399`, and relay `4400` — PASS: 1/1.
  Discovery/connect returned `gatewayBaseUrl`; the issued Device credential
  authenticated `/projects`. Scoped down released all four ports and source
  fixture hashes remained unchanged. Criterion C8 is now `pass`.
- Before down, both role DB copies were writable, path-distinct, and matched
  `(host_id,user_id)` plus Google subject/email mapping. Scoped dual-role
  `down` removed the sandbox; all four ports were free afterward.
- Source hashes after cleanup matched before launch: DB
  `7ff4dad70124923eee01ff0e1f96a5be528274d4bf2fddcdaa870534f47026ed`;
  config
  `7c816ae4512fcc8667fa479b3d3ddb49d6f9aaf9dacc9acf9b550b76705f1b22`.
- Security caveat: this proves only synthetic loopback dual-role behavior. It
  does not prove Cloudflare routing, Synology persistence/runtime, real Google
  credentials, production DB state, or the iOS Simulator UI/bootstrap flow.
- Final `gitnexus_detect_changes(scope=all)` — MEDIUM: 40 changed indexed
  symbols, 3 affected existing `createMobileGatewayRouter` diagnostic flows,
  13 indexed files; no HIGH/CRITICAL changed-symbol result.
- Continuation tracked numstat: `1 0 mobile_gateway_surface.ts`, `18 0
  docs/ai/testing-guide.md`, `170 6 tools/dev/sandbox.sh`, `3 3
  tools/dev/sandbox_guard_test.sh`. New files: 43-line live test, 137-line
  contract JSON, 84-line dual-role shell contract; the pre-existing 337-line
  backend contract and this run note remain untracked as preserved prior work.
