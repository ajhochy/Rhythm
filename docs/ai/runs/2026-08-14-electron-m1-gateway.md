---
date: 2026-08-14
repo: Rhythm
branch: codex/react-electron-live-suite
pr: null
issues: [react-desktop-gateway-v1-slice-2]
status: ready_for_verification
tags: [run, Rhythm]
---

# Electron M1 gateway — Slice 2

## Contract

- Contract: `docs/ai/contracts/react-desktop-gateway-v1.md`
- WAIVED: checksum/provenance bookkeeping only with no product behavior change; verification is exact SHA-256 manifest validation, 144-entry count, root digest, owned-file diff check, and git status.
- Pre-implementation command: `cd apps/web && npx playwright test tests/gateway/gateway.spec.ts tests/gateway/receipt.spec.ts --workers=1`
- Expected failing result: **7 failed**. Six failed with `renderer gateway module must exist`; the UI contract failed because the accessible `Environment receipt` did not exist.
- Additional pre-implementation command: `cd apps/web && npx playwright test --config tests/gateway/invalid-live-playwright.config.ts`
- Expected failing result: **1 failed**, no fatal requested-live alert rendered.

## Files changed

- `apps/web/src/gateway/index.ts`
- `apps/web/src/gateway/context.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/main.tsx`
- `apps/web/tests/gateway/gateway.spec.ts`
- `apps/web/tests/gateway/receipt.spec.ts`
- `apps/web/tests/gateway/invalid-live.spec.ts`
- `apps/web/tests/gateway/invalid-live-playwright.config.ts`
- `apps/web/tests/gateway/live.spec.ts`
- `apps/web/tests/gateway/live-playwright.config.ts`
- `apps/web/package.json`
- `apps/web/index.html`
- `apps/web/PROVENANCE.md`
- `apps/web/SHA256SUMS`
- `docs/ai/contracts/react-desktop-gateway-v1.md`
- `docs/ai/runs/2026-08-14-electron-m1-gateway.md`

No dependency or lockfile change was made. Existing feature/page/store implementations and imported fixture tests were not modified.

## Checks run

- `npm run typecheck` — initial FAIL: three missing `ImportMeta.env` type errors; after the minimal local type annotation, **PASS**.
- `npm run test:fixture` — initial focused repair found one test-boundary URL predicate error; after correction, **PASS: 7 gateway unit/fixture tests + 1 invalid-live startup UI test**.
- `npm run build` — **PASS**; Vite built 1,628 modules. Existing >500 kB chunk warning remains.
- Pre-c19 `npm run test:list` receipt (superseded by the fresh c19 discovery below) — **PASS: 248 tests in 36 files**; 239 imported baseline tests plus 9 then-current Slice 2 tests.
- `npx playwright test tests/shell.spec.ts tests/pages/dashboard.spec.ts --grep "navigates the shell|Dashboard distributes" --workers=1` — **PASS: 2/2** targeted shell/route smoke tests.
- `tools/dev/sandbox.sh status` — **PASS**: API listener `:4098`, engine listener `:4097`, gateway listener `:4099`. No service was started, stopped, or restarted.
- Direct observed API response: `curl http://127.0.0.1:4098/health` → `200`, `{"status":"ok","service":"rhythm-api-server","commit":"dev",...}`.
- Direct observed engine response: `curl http://127.0.0.1:4097/global/health` → `200`, `{"healthy":true,"version":"0.0.0-codex/react-electron-live-suite-202608142141",...}`.
- `RHYTHM_LIVE_E2E=1 npm run test:live` — **FAIL after two focused repair attempts**: the real browser receipt settled at `Environment: Live · API :4098 error · Engine :4097 error`; expected both `healthy`. The test uses no route mocks and therefore remains red against the renderer's actual GETs.
- CORS recon: API health with `Origin: http://127.0.0.1:4175` returned `403`; engine health returned `200` with `Access-Control-Allow-Origin: http://127.0.0.1:4175`. Test-only Chromium security flags did not make the real receipt pass and were removed.
- Screenshot: **not captured as durable evidence** because the live test did not reach its passing screenshot step. No `electron-m1-gateway-live.png` was created, so no dimensions/hash are claimed.
- `git diff --check` — **PASS**.
- `git status --short --branch` — correct branch; the imported `apps/web/` tree remains all-new/untracked as dispatched, alongside pre-existing Slice 0/1 artifacts.
- `gitnexus_detect_changes(scope=all, worktree=/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite)` — **0 changed symbols, 0 affected processes, risk none / no changes detected**, consistent with the new unindexed tree.

## Notes

- The gateway is deliberately only a composition seam. Existing pages still consume `FixtureProvider`; no feature was silently migrated to live data.
- Live URLs fail closed to exact HTTP loopback `:4098`/`:4097`, health calls use `AbortSignal.timeout`, fixture mode performs no network, and invalid explicit-live startup renders a fatal alert rather than fixtures.
- **Blocker classification: integration/scope.** Direct sandbox endpoints are healthy, but renderer-origin GETs do not both succeed. Resolving this truthfully requires an approved cross-origin/proxy/Electron bridge decision in files outside Slice 2 ownership (API CORS, Vite proxy, or Electron preload/main transport). Do not weaken health semantics with `no-cors`, disable browser security, or mark opaque responses healthy.

## Approved local-renderer repair

### Files changed by this repair

- `apps/api_server/src/config/env.ts`
- `apps/api_server/src/middleware/local_agent_surface_guard.ts`
- `apps/api_server/src/app.ts`
- `apps/api_server/src/contract/local_agent_surface_hardening.test.ts`
- `tools/dev/sandbox.sh`
- `docs/ai/contracts/react-desktop-gateway-v1.md`
- `docs/ai/runs/2026-08-14-electron-m1-gateway.md`

No dependency or lockfile changed.

### Acceptance-first evidence

- `cd apps/api_server && npx vitest run src/contract/local_agent_surface_hardening.test.ts` before implementation — **FAIL as expected: 22 failed, 26 passed**. Missing parser assertions failed, exact configured renderer HTTP returned `403` instead of `200`, and `/ws/agents` did not open.
- The contract now covers exact/deduplicated parser acceptance; rejection of wildcard, `null`, file, HTTPS/non-loopback/localhost, credentials, missing/invalid port, path/query/fragment, prefix/suffix and malformed values; exact renderer HTTP/CORS; `/ws/agents` and PTY upgrades; empty-list rejection; loopback Host; headerless native HTTP/WS; kill-switch; and hosted configured CORS.

### Repair checks

- `cd apps/api_server && npx vitest run src/contract/local_agent_surface_hardening.test.ts` — **PASS: 48/48**.
- `cd apps/api_server && npm run build` — **PASS** (`tsc -p tsconfig.json` plus advisories postbuild).
- `tools/dev/sandbox.sh down && tools/dev/sandbox.sh up && tools/dev/sandbox.sh status` — **PASS**. Sandbox rebuilt through the approved lifecycle and reported API `:4098`, engine `:4097`, and gateway `:4099` listeners. Both sandbox runtime arrays set only `RHYTHM_LOCAL_RENDERER_ORIGINS=http://127.0.0.1:4175`; the origin guard remains enabled.
- Positive live HTTP: `Origin: http://127.0.0.1:4175` plus `Sec-Fetch-Site: same-site` → **200**, `Access-Control-Allow-Origin: http://127.0.0.1:4175`, health JSON.
- Negative live HTTP: `Origin: http://127.0.0.1:4176` → **403**, 37-byte `FORBIDDEN_ORIGIN`, no ACAO. `Origin: http://localhost:4175` → the same concise **403**, no ACAO.
- Headerless `GET http://127.0.0.1:4098/health` → **200**.
- Live `/ws/agents` with exact Origin `http://127.0.0.1:4175` and `Sec-Fetch-Site: same-site` → **opened** and received a real `sessions.list` frame.
- Engine CORS recon: exact renderer Origin to `http://127.0.0.1:4097/global/health` → **200** with exact ACAO.
- `cd apps/web && npm run test:fixture` — **PASS: 7/7 gateway tests and 1/1 invalid-live UI test**.
- `cd apps/web && npm run typecheck` — **PASS**.
- `cd apps/web && npm run build` — **PASS**, 1,628 modules; existing chunk-size warning only.
- Pre-c19 `cd apps/web && npm run test:list` receipt (superseded by the fresh c19 discovery below) — **PASS: 248 tests in 36 files**.
- `cd apps/web && npm run test:dist-smoke` — **PASS**, index and two relative assets verified.
- `git status --short` after sandbox rebuild showed no tracked/generated lockfile or build-output changes; only the intended backend/sandbox edits and pre-existing untracked Slice files remain.
- `git diff --check` — **PASS**.
- `gitnexus_detect_changes(scope=all, worktree=/Users/ajhochhalter/Documents/Rhythm-react-electron-live-suite)` — **LOW risk**, 7 changed indexed symbols in 5 files, 0 affected processes. Expected touched symbols include `createApp`, its CORS origin callback, `env`, `startScenario`, the contract HTTP helper, and `isAllowedLocalAgentSurfaceRequest`; the additive parser was not present in the prior index.

### Approved CSP ownership expansion

- Root cause: the imported `apps/web/index.html` meta CSP contained `connect-src 'none'`, so Chromium blocked both health requests before network dispatch despite the repaired exact renderer allowlist. The expansion replaced only that directive value with `http://127.0.0.1:4098 http://127.0.0.1:4097`; all other CSP directives are byte-for-byte unchanged. No wildcard, localhost alias, arbitrary port, WebSocket origin, browser bypass, proxy, IPC, dependency, or fixture fallback was added.
- Acceptance-first command: `cd apps/web && npx playwright test tests/gateway/gateway.spec.ts --workers=1` — **FAIL as expected: 1 failed / 6 passed**. The new `slice-2-c19` assertion expected the two exact destinations and observed `['none']`.
- `cd apps/api_server && npx vitest run src/contract/local_agent_surface_hardening.test.ts` — **PASS: 48/48** on the retained backend allowlist repair.
- `cd apps/api_server && npm run build` — **PASS**.
- `cd apps/web && npm run test:fixture` — **PASS: 8/8 gateway/receipt tests + 1/1 invalid-live startup test**. The focused CSP test parses source `index.html` and requires the complete `connect-src` token list to equal only the two approved endpoints, excluding wildcard, localhost, `:4001`, `:4096`, WebSocket, and every other network destination by exact equality.
- `cd apps/web && npm run typecheck` — **PASS**.
- `cd apps/web && npm run build` — **PASS**, 1,628 modules; existing chunk-size warning only.
- `cd apps/web && npm run test:dist-smoke` — **PASS**, index and two relative assets verified.
- Verification-gate fresh `npm run test:list` discovery after c19 — **PASS: 249 tests in 36 files**, comprising **239 imported baseline tests + 10 Slice 2 gateway tests**. This is the authoritative inventory.
- `tools/dev/sandbox.sh status` — **PASS** without lifecycle changes: API `:4098`, engine `:4097`, gateway `:4099` listeners healthy.
- `cd apps/web && RHYTHM_LIVE_E2E=1 npm run test:live` — **PASS: 1/1**. Browser response evidence was exactly `GET http://127.0.0.1:4098/health 200` and `GET http://127.0.0.1:4097/global/health 200`; the rendered receipt read `Environment: Live · API :4098 healthy · Engine :4097 healthy`. The live test defines no route mocks and has no fixture fallback.
- Evidence: `docs/ai/runs/evidence/electron-m1-gateway-live.png`, **384 × 17**, SHA-256 `7918a310c0e44ed19b2c1d28af5901428806fadf9fd38b2597154d44b76d3597`. Visual review is baseline-valid for the intentionally receipt-only crop: readable dark-theme Live label plus separate healthy API and engine statuses, with no clipping or error state.
- Inventory remains **144 entries**. `index.html` verifies at SHA-256 `656a3b23137d62024e67a3ed59f53c66b4ff72e536e64d9edbdaaf5eba6ed028`; the interim index-only Slice 2 inventory root was `61e38539acd82295d9dfe7aec6dce0781d191644ca665037fa86ac41a757128b`. `PROVENANCE.md` preserves the original and earlier adaptation hashes and makes no byte-identical-source claim.
- Checksum ownership was subsequently clarified for the three retained Slice 2 imported-file adaptations. `package.json` now verifies at `d1fb7f57e218be020ee2bfb5be4d88f7af4d65b2b8719a765e26b190dc8dba12`, `src/App.tsx` at `1280567f9da7cc75ffd19f3e1012b4b5e3c1abbd162239ef15c85b00fa150554`, `src/main.tsx` at `3fee9e3175c40f48f6c8fdfe68cd423c47a84dfcb1a5684ba54787c43d80773f`, and the already-correct `index.html` at `656a3b23137d62024e67a3ed59f53c66b4ff72e536e64d9edbdaaf5eba6ed028`. Full `shasum -a 256 -c SHA256SUMS` is **PASS: 144/144**; `wc -l < SHA256SUMS` is **144**; the reconciled inventory root is `9015d2f78ab85a324548dc0472f1071014a1a87bfcdbf017495f19bbf6e412c7`.
- Reconciliation checks: `shasum -a 256 SHA256SUMS` — **PASS**, root above; `git diff --check -- apps/web/SHA256SUMS apps/web/PROVENANCE.md docs/ai/contracts/react-desktop-gateway-v1.md docs/ai/runs/2026-08-14-electron-m1-gateway.md` — **PASS**; `git status --short --branch` — **PASS**, branch `codex/react-electron-live-suite`, with this bookkeeping dispatch confined to the four approved files amid the pre-existing Slice 2 worktree changes. No API, web, live, or sandbox lifecycle command was rerun.
- All commands intentionally targeted only sandbox/API/engine/renderer ports `:4098`, `:4097`, `:4099`, and `:4175`. This is a command-level observation, not a packet-capture claim about `:4001` or `:4096`.
- Prior verification result: **FAIL** only because c8 and the active run-note inventory still required the stale 248/36 and 9-test counts; runtime and security checks passed.
- Docs-only reconciliation: c8 and this run note now use the authoritative **249 tests in 36 files = 239 imported baseline + 10 Slice 2 gateway** discovery. Status remains `ready_for_verification`; no test, build, service, install, or sandbox command was rerun.
- WAIVED: docs-only inventory-count reconciliation with no behavior change; verification is: exact-text consistency, git diff --check on the two owned files, and git diff/status review
