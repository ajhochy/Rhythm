---
date: 2026-08-20
repo: Rhythm
branch: codex/mega-a-react-electron
pr: null
issues: [1407, 1411, 1413, 1414, 1415, 1447]
status: blocked
tags: [run, rhythm]
---

## Contract
- Contract: `docs/ai/contracts/task-bucket-a-verification-repair-1.json`.
- Before implementation, `npx playwright test tests/gateway/gateway.spec.ts --workers=1` failed the new trusted alternate-base test (7 passed, 1 failed): `:4798` was rejected in favor of fixed `:4098`.
- Before implementation, `node --test test/production-api-security.test.mjs` failed 0/1 because the production security helper did not exist.
- The rendered acceptance criterion was recorded failing because no dedicated rendered harness existed; package serialization was failing because the test script had no concurrency bound.

## Files
- Expected-base seam and harnesses: `apps/web/src/gateway/index.ts`, `apps/web/src/gateway/sessions.ts`, `apps/web/src/main.tsx`, `apps/web/tests/live-environment.ts`, phase-1/task/session live harnesses, and gateway tests.
- Rendered evidence: `apps/web/tests/bucket-a-rendered-repair.spec.ts` plus its dedicated Playwright config and five screenshots below.
- Electron security/serialization: `apps/electron/src/production-api-config.mjs`, `src/main.mjs`, package copy script, security test, package tests, and serialized npm test script.
- Contracts reconciled: issue 1414/1407 all pass; issue 1415/1413/1411 points to rendered tests; task UI criteria c1-c5 point to rendered tests while Unicode c6 remains the unit check; issue 1447 c1/c3/c4 remain honestly not tested.

## Expected-base trust design
- Shipping defaults remain exactly API `http://127.0.0.1:4098` and engine `http://127.0.0.1:4097`.
- Alternate expectations must parse as plain credential-free/path-free/query-free/fragment-free `http://127.0.0.1:<1024-65535>` URLs and API/engine ports must differ.
- Configured bases must equal those trusted expectations. Electron-owned frozen runtime metadata supplies Electron expectations; browser harness alternates require explicit `VITE_RHYTHM_EXPECTED_API_BASE` and `VITE_RHYTHM_EXPECTED_ENGINE_BASE`.
- `tests/live-environment.ts` parses `RHYTHM_LIVE_API_URL`, `RHYTHM_LIVE_ENGINE_URL`, and `RHYTHM_LIVE_PRODUCTION_API_URL`, falls back to 4098/4097/API, and derives WebSocket from API. The live session gateway now derives its WebSocket URL from the validated API base.

## Checks
- `node .gitnexus/run.cjs analyze` — PASS; full index rebuild, 80,874 nodes / 160,428 edges / 300 flows. It changed generated instruction counts, which were restored to HEAD.
- GitNexus upstream impact — LOW: `Profiles` (0 direct), `SessionRail` (1 direct: `AgentsWorkspace`), `ToolWorkspace` (0 direct). `validateLiveBase`, `composeGateway`, Electron registration, and `createLiveSessionsGateway` were unresolved/UNKNOWN; expected-base and production persistence were manually treated HIGH.
- `npm run typecheck` (web) — PASS.
- `npm run build` (web) — PASS.
- `node --test src/components/ToolWorkspace.contract.test.mjs` — PASS 9/9.
- `npx playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts` — PASS 5/5.
- `npm run test:fixture` — PASS 15/15 plus invalid-live 1/1.
- `npx playwright test tests/inspector-profiles.spec.ts tests/sessions.spec.ts --workers=1` — PASS 6/6.
- `npm run test:contract` — PASS 134/134.
- `node --test test/production-api-security.test.mjs` — PASS 3/3: unauthorized sender saved 0 times; file/credentials/query/fragment saved 0 times; persisted file mode was exactly 0600.
- Scoped strict Electron typecheck over repaired files — PASS; `node --check` over repaired files — PASS.
- Full `npm run typecheck` (Electron) — expected pre-existing nonzero disposition: the unchanged 12 `src/artifact-policy.mjs` errors only. No full-typecheck pass is claimed.
- `RHYTHM_LIVE_*=:4798/:4797 ... post-m1-phase-1-readiness-live-playwright.config.ts` — PASS 1/1.
- Custom-port task live suite — reached `:4798`, rendered/captured its lifecycle, then FAIL 0/1 because collaborator PATCH returned `isShared:false` after the collaborator list had returned `isShared:true`. Assertion retained.
- Custom-port session live suite first exposed the hard-coded `:4098` WebSocket. After the bounded API-derived WebSocket repair, it sent/accepted the real frame and reached the provider, then FAIL 0/1 because hard delete returned `502 WORKTREE_REMOVE_FAILED` instead of 204. Assertion retained; cleanup counts were all zero.
- `RHYTHM_LIVE_API_URL=:4798 RHYTHM_LIVE_ENGINE_URL=:4797 RHYTHM_LIVE_PRODUCTION_API_URL=:4798 npm test` (Electron) — PASS 35/35, serialized; packaged live smoke passed against custom ports and canonical `dist/Rhythm.app` remained shared.

## Rendered evidence
All screenshots are 1440x900.

| File | SHA-256 |
|---|---|
| `bucket-a-profile-asset-fallback.png` | `b1b3282c715d898bbc712950a069133623efe9c86e6af042646b640d16b5534a` |
| `bucket-a-session-cwd-branch-reset.png` | `c92355b699ec64ed3a5507a9116e7ace486e154b0207bd85bf81f603a7de1523` |
| `bucket-a-gallery-media-fallback.png` | `c8a08c38ee2f6228e4a52ea499d7db7f5b510e597a9ef965eccd117bf5745e10` |
| `bucket-a-skills-loading-error.png` | `eb670a60aaf37bffa497a7b648049ab42809cd0855f86f86049347a1ab175b9b` |
| `bucket-a-settings-honesty.png` | `309b66a8243d789932cea62fdddb6c8f5334e161493718aac9bd1d0838c90ac6` |

## Sandbox and safety
- Requested sandbox directory: `/tmp/rhythm-dev-sandbox-mega-a-repair`; API `4798`, engine `4797`, gateway `4799` (the documented default gateway `4099` was occupied, so the sandbox-owned alternate was used).
- Before: 4798/4797/4799 free. Protected listeners were API `:4001` PID 30369 and engine `:4096` PID 30381.
- `tools/dev/sandbox.sh status` confirmed sandbox listeners; no server was started manually.
- `tools/dev/sandbox.sh down` removed the sandbox. After: 4798/4797/4799 had no listeners; protected PIDs 30369/30381 were unchanged.
- No request targeted `api.vcrcapps.com`. Production base during live/package checks was loopback `:4798` only.

## Blocker
Issue 1447 c4 cannot honestly become pass in this repair attempt: the expected-base seam, phase-1 gate, and packaged custom-port smoke are green, but the mandated task/session suites now exercise the custom sandbox and fail on two behavior defects outside the triaged owned repair files (`isShared` response semantics and worktree removal 502). A second triage must either own those backend defects or explicitly disposition the pre-existing assertions.
