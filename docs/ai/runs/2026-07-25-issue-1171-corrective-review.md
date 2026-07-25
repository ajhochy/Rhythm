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

- Added a loopback-only mobile gateway listener with an allowlisted Express
  surface, separate from the full API listener.
- Hardened Tailscale Serve validation to require the exact root proxy target
  and reject Funnel or recursive decoy handlers.
- Bound paired-host metadata to the signed-in Rhythm user and made Mac
  replacement transactional: the old Mac is revoked before the new credential
  becomes authoritative, with rollback when that revoke fails.
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
  src/services/__tests__/mobile_pairing_service.test.ts
  src/__tests__/security_live_behavior.test.ts
  src/__tests__/mobile_pairing_contract.test.ts` — 19/19 pass.
- Rebuilt the vendored fork with
  `cd apps/opencode_fork/packages/opencode && bun run build --single`; standalone
  binary smoke passed.
- Guarded live sandbox run on API `:5297`, real fork engine `:5298`, and
  loopback-only mobile gateway `:5299`:

  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1
  RHYTHM_LIVE_URL=http://127.0.0.1:5297
  RHYTHM_SANDBOX_API_PORT=5297
  RHYTHM_LIVE_MOBILE_GATEWAY_URL=http://127.0.0.1:5299
  RHYTHM_MOBILE_GATEWAY_PORT=5299
  RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox-issue-1171/rhythm.db
  npx vitest run src/__tests__/issue_1171_mobile_access_live.test.ts`
  — 1/1 pass. The test observed unauthenticated rejection, diagnostic and
  compatibility health, exact two-field one-time QR exchange, hashed-at-rest
  verifier, device authentication, legacy-route 404s on the mobile listener,
  and revocation.
- Clean shutdown completed; `/tmp/rhythm-dev-sandbox-issue-1171` was removed
  and `:5297/:5298/:5299` were verified free. Foreign listeners on `:4001`,
  `:4097`, and `:4098` retained the same PIDs.
- `cd apps/api_server && npx vitest run --exclude
  src/__tests__/issue_723_mcp_remove_reconcile.test.ts` — 374 files / 3,247
  tests pass; 43 files / 64 tests skip.
- The raw full API run had one failure after 3,248 passes: unchanged issue #723
  code deterministically fails its VM dynamic-import callback. Its test and
  implementation have no diff from `main`; the same failure reproduces alone.
- `cd apps/mobile && npm run verify:foundation` — pass, including contract
  fingerprint, lint, TypeScript, transport/account/OAuth/credential/persistence
  suites, fake server, and Playwright 19/19.
- `cd apps/desktop_flutter && dart format . --set-exit-if-changed` — pass,
  432 files checked and 0 changed.
- `cd apps/desktop_flutter && flutter analyze --no-fatal-infos` — exit 0 with
  273 pre-existing infos.
- `cd apps/desktop_flutter && flutter test
  test/features/agents/mobile_access_dialog_test.dart` — 8/8 pass.
- Native debug build and launch passed on the dedicated iOS 18.3 simulator
  `Rhythm-1171-iPhone-SE`
  (`27E23B6E-2DEF-4563-90B4-820A1820AA6B`). Build log:
  `/Users/ajhochhalter/Library/Developer/XcodeBuildMCP/workspaces/Rhythm-4c790f0c2895/logs/build_run_sim_2026-07-25T10-10-25-336Z_pid62811_c0626165.log`.
- Native accessibility smoke drove Settings → Pair a Mac → QR callback →
  Connected → confirmed Replace → Connected to the second Mac → Revoke →
  Not paired. The fake gateway audited:
  `GET old`, `POST pair old`, `GET new`, `POST pair new`,
  `DELETE old`, `DELETE new`; both devices ended revoked and no credential was
  rendered. The dedicated simulator was shut down without touching the foreign
  booted simulator.
- `git diff --check` — pass.
- GitNexus `detect-changes --scope unstaged` — MEDIUM, 18 indexed files /
  46 symbols / 3 affected mobile-gateway diagnostic flows.
- GitNexus `detect-changes --scope compare --base-ref main` — CRITICAL,
  468 files / 2,465 symbols / 18 flows. This is long-lived worktree divergence;
  integration should cherry-pick the corrective commit rather than merge the
  branch wholesale.

## Notes

- The first native replacement probe correctly retained the original local
  pairing when the reset fake server no longer knew that device. Resetting
  local and server fixture state together produced the expected transaction.
- The sandbox script's detached child was reaped by the execution environment
  after initially reporting healthy. The successful live run kept the built
  API in an owned foreground PTY and performed an explicit clean shutdown.
- The fork worktree had broken workspace dependency links. A local ignored
  dependency symlink to the canonical cache restored the pinned packages; the
  build's incidental one-line `bun.lock` rewrite was reverted before the diff
  gate.
