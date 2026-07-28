---
date: 2026-07-25
repo: Rhythm
branch: codex/mobile-1171-pairing-ui
pr: null
issues: [1171]
status: verified-corrective
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue #1171 — corrective security, ownership, and native review

## Files

- Restricted the phone-facing listener to health, pair, project, owner revoke,
  and device-scoped OpenCode routes. Pairing-code administration, device
  listing, access toggles, and the full legacy API remain loopback-only.
- Hardened Tailscale Serve validation to require the exact root proxy target
  and reject Funnel or recursive decoy handlers.
- Made Mac replacement transactional through local storage failure: after the
  old device is revoked, failure to persist the new host revokes the newly
  paired device and reports a truthful revoked or unhealthy state. Rollback
  failure preserves enough metadata for an actionable owner revoke.
- Made revoke and forget failures visible and retryable in Settings without
  swallowed or unhandled promise rejections.
- Added real pairing/replacement/rollback/revoke Playwright coverage, small
  viewport and enlarged-text coverage, fake-gateway device auditing, and
  expanded credential/state-machine tests.
- Synced the mobile OpenAPI manifest and compatibility fingerprint to
  `4d4e279ce858a0bdb33399b004ef1268e415b7fcbe5029eee93bee94e5759636`.

## Checks

- `cd apps/api_server && npm run build` — pass.
- `cd apps/api_server && npx vitest run
  src/services/__tests__/tailscale_serve_service.test.ts
  src/services/__tests__/mobile_gateway_surface.test.ts
  src/services/__tests__/mobile_pairing_service.test.ts` — 19/19 pass.
- Rebuilt the vendored fork with
  `cd apps/opencode_fork/packages/opencode && bun run build --single`; standalone
  binary smoke passed.
- Guarded live sandbox run on API `:5597`, real fork engine `:5598`, and
  loopback-only mobile gateway `:5599`:

  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1
  RHYTHM_LIVE_URL=http://127.0.0.1:5597
  RHYTHM_SANDBOX_API_PORT=5597
  RHYTHM_LIVE_MOBILE_GATEWAY_URL=http://127.0.0.1:5599
  RHYTHM_MOBILE_GATEWAY_PORT=5599
  RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-issue-1171-round2/rhythm.db
  npx vitest run src/__tests__/issue_1171_mobile_access_live.test.ts`
  — 1/1 pass. The test observed unauthenticated rejection, diagnostic and
  compatibility health, exact two-field one-time QR exchange, hashed-at-rest
  verifier, device authentication, legacy-route 404s on the mobile listener,
  and revocation.
- Clean shutdown completed; `/tmp/rhythm-dev-sandbox-issue-1171-round2` was
  removed and `:5597/:5598/:5599` were verified free. Foreign listeners on `:4001`,
  `:4097`, and `:4098` retained the same PIDs.
- `cd apps/api_server && npx vitest run --exclude
  src/__tests__/issue_723_mcp_remove_reconcile.test.ts` — 374 files / 3,247
  tests pass; 43 files / 64 tests skip.
- The raw full API run had one failure after 3,248 passes: unchanged issue #723
  code deterministically fails its VM dynamic-import callback. Its test and
  implementation have no diff from `main`; the same failure reproduces alone.
- `cd apps/mobile && npm run verify:foundation` — pass, including contract
  fingerprint, lint, TypeScript, transport/account/OAuth/credential/persistence
  suites, fake server, and Playwright 21/21.
- Final storage cleanup regressions: `npm run test:paired-host` — 20/20 pass;
  `npm run lint` and `npm run typecheck` — pass.
- The Playwright harness now validates configurable ports and clears Expo's
  bundler cache before each isolated build. A final run with
  `PLAYWRIGHT_WEB_PORT=19171 PLAYWRIGHT_FAKE_PORT=44171 npx playwright test
  tests/e2e/pairing.spec.mjs` passed 6/6 without reusing another worktree's
  server.
- `cd apps/desktop_flutter && dart format . --set-exit-if-changed` — pass,
  432 files checked and 0 changed.
- `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — exit 0 with
  273 pre-existing infos.
- `cd apps/desktop_flutter && flutter test
  test/features/agents/mobile_access_dialog_test.dart` — 8/8 pass.
- Native debug build and launch passed on the dedicated iOS 18.3 simulator
  `Rhythm-1171-iPhone-SE`
  (`[redacted-device-identifier]`). Build log:
  `/Users/ajhochhalter/Library/Developer/XcodeBuildMCP/workspaces/Rhythm-4c790f0c2895/logs/build_run_sim_2026-07-25T10-10-25-336Z_pid62811_c0626165.log`.
- Native accessibility smoke used
  `accessibility-extra-extra-extra-large`. The first screenshot exposed compact
  title/status overlap; after correction, the Pair header and Paired Mac card
  rendered cleanly, every action was scroll-reachable, and the accessibility
  tree exposed pair, scan, refresh, revoke, and forget labels. Activating the
  test QR control and confirming replacement returned Settings to Connected.
  Retained evidence:
  `docs/ai/runs/artifacts/issue-1171/native-accessibility.json`,
  `native-accessibility-tree.txt`, `native-large-text-pair-top.png`, and
  `native-large-text-connected.png`. The dedicated simulator was reset and shut
  down without touching the foreign booted simulator.
- `node tests/contract/issue-1171.mjs all` — all six executable criteria pass;
  this reruns API security/surface tests, Flutter behavior/format/analyze,
  paired-host state/rollback tests, failure-state/computed-font Playwright, and
  retained native evidence validation.
- `git diff --check` — pass.
- GitNexus `detect-changes --scope unstaged` — MEDIUM, 18 indexed files /
  26 symbols / 4 affected Settings notification flows.
- GitNexus `detect-changes --scope compare --base-ref main` — CRITICAL,
  474 files / 2,465 symbols / 18 flows. This is long-lived worktree divergence;
  integration should cherry-pick the corrective commit rather than merge the
  branch wholesale.

## Notes

- The first native replacement probe correctly retained the original local
  pairing when the reset fake server no longer knew that device. Resetting
  local and server fixture state together produced the expected transaction.
- The sandbox script's detached child was reaped by the execution environment
  after initially reporting healthy. The successful live run kept the built
  API in an owned foreground PTY and performed an explicit clean shutdown.
- A final Playwright rerun initially loaded another worktree's app from the
  legacy shared `:19006`, then exposed Expo's cached `:44096` manifest after
  moving only the server. Parameterized, validated web/fake ports plus
  `expo export --clear` made the test and compiled app use the same isolated
  endpoints.
- The fork worktree had broken workspace dependency links. A local ignored
  dependency symlink to the canonical cache restored the pinned packages; the
  build's incidental one-line `bun.lock` rewrite was reverted before the diff
  gate.

## Second independent-review corrections

- Malformed QR parsing now occurs inside the paired-host transaction. A parse
  failure restores the previous host/state, publishes the actionable error,
  and lets the provider and scanner retry without restarting the app.
- Cross-Mac replacement now distinguishes the initial new-token Keychain write
  from credential cleanup. Its rollback truth table records whether the new
  device remains active and whether the old or new credential remains, then
  persists a recovery marker for the host on which the next revoke/forget
  action is meaningful. Provider restart restores that actionable state
  without sending a mismatched device token to the new host.
- Failure to revoke the previous Mac now verifies cleanup of the newly created
  device. If that cleanup also fails, the app reports both active
  registrations instead of falsely claiming the original pairing was the only
  remaining device.
- Both Playwright-managed servers now unconditionally set
  `reuseExistingServer: false`; parameterized occupied ports are rejected in
  local and CI modes before any foreign server can be reused.
- Regression-first red evidence:
  `npm run test:paired-host` observed `pairing` instead of `unpaired` after a
  malformed payload, and `node tests/playwright-port-isolation.test.mjs`
  reached a web build instead of rejecting an occupied port.
- Final focused checks:
  - `cd apps/mobile && npm run test:paired-host` — 22/22 pass.
  - `cd apps/mobile && node tests/playwright-port-isolation.test.mjs` — pass in
    both local and CI modes.
  - `cd apps/mobile && npm run test:fake-server:self` — pass.
  - `cd apps/mobile && npm run lint && npm run typecheck` — pass.
  - `PLAYWRIGHT_FAKE_PORT=44271 PLAYWRIGHT_WEB_PORT=19271 npx playwright test
    tests/e2e/pairing.spec.mjs --grep "malformed scanner|replacement
    secure-write"` — 3/3 pass on dedicated ports. No API, engine, or simulator
    was started.
- Failure triage: the first focused browser run found an ambiguous duplicate
  error-text locator while the correct retryable state was visible; the smoke
  assertion was scoped to the inline live-region and then passed. A later
  typecheck found TypeScript had lost a non-null narrowing inside the
  `existingRevoked` branch; an explicit assertion at that proven branch fixed
  it, and typecheck plus 22/22 store scenarios passed again.
- Final GitNexus `detect-changes --scope staged` — LOW, 12 files /
  25 indexed symbols / 0 affected flows.
- Final GitNexus `detect-changes --scope compare --base-ref main` — CRITICAL,
  477 files / 2,465 symbols / 18 flows. The branch remains intentionally
  unsuitable for wholesale merge; cherry-pick the exact second corrective
  commit.
