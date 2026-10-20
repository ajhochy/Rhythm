---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: unverified
tags: [run, Rhythm]
---

# Disposable packaged synthetic actor seam

## Files

- `apps/api_server/src/services/qualification_fixture_authority.ts` validates an optional private synthetic actor token and expiry under the existing exact-build manifest.
- `apps/api_server/src/services/qualification_fixture_bootstrap.ts` seeds that token as one ordinary SQLite auth session for the synthetic public owner; it refuses foreign sessions.
- `apps/electron/src/agent-server.mjs` validates the actor before startup, refuses occupied API/engine ports, omits the native approval Keychain for actor mode, and confines child stores and inherited credentials.
- `apps/electron/src/main.mjs` verifies the actor through owned local `/auth/me`, holds sign-in in memory, pins its API origin to loopback, and disables external OAuth, remote attach, real-account discovery, and native approval signing for this fixture.
- Focused API/Electron tests cover normal middleware auth, private/exact-build/expiry guards, runtime ownership, Keychain avoidance, and main bridge confinement.

## Checks

- RED: qualification setup test failed `SessionsRepository.findUserByToken(token)` (null); Electron occupied-runtime test failed `ready !== failed` because the former path adopted a healthy foreign runtime. The first new helper import failure was only test setup, not behavioral proof.
- PASS: API `vitest run src/__tests__/qualification_fixture_setup.test.ts --maxWorkers=1` (8/8); API `tsc -p tsconfig.json --noEmit`.
- PASS: Electron `node --experimental-vm-modules --test` on agent-server, E12A auth boundary, main runtime, and both qualification tests (37/37); `node --check` for changed Electron modules; `git diff --check`.
- No packaged build, native launch, running backend, or real provider was used in this subtask. Those gates remain for integration.

## Notes

- Fixture launcher contract: create a fresh owned `0700` `/private/tmp` root with `electron-user-data/` and `home/` at `0700`; write a 64-character random hex `actor-token` file and `manifest.json` at `0600`. Manifest uses schema 1, the packaged API source revision, `dbPath=<root>/rhythm.db`, a positive synthetic owner ID, matching token SHA-256, `.invalid` email, `qualification-fixture:<nonce>` Google subject, and `syntheticActor: { tokenPath: <root>/actor-token, expiresAt: <future ISO time within 24h> }`. Launch the exact packaged executable with `RHYTHM_QUALIFICATION_FIXTURE_MANIFEST` and `RHYTHM_SHELL_USER_DATA=<root>/electron-user-data`, with ports 4001/4096 vacant. Stop its owned processes and remove only that root after checked cleanup.
- This actor authenticates ordinary local API routes; it does not prove real OAuth, provider execution, second-owner UI switching, native signed approvals, or a packaged run. These require separately owned fixtures and receipts.
- GitNexus impact on fixture symbols was stale by 263 commits and returned LOW/zero callers; manual direct callers include server bootstrap, Electron runtime startup, and main auth/gateway. Treat the seam as security-sensitive despite the stale graph result.

## Follow-up security checks

- RED: direct real-filesystem actor token tests accepted a later `0644` file, a same-byte symlink, and an expired token (3/3 failed before repair). The token helper now rechecks canonical private ownership, regular single-link `0600` mode, and live expiry on every read. API qualification tests pass 11/11 and `tsc -p tsconfig.json --noEmit` passes.
- RED: the embedded Hermes host received no actor credential options and could fall back to its default home. Actor mode now gives it a verified, private fixture Hermes home and empty backend environment. The focused Electron test rejects a substituted symlink; 24/24 focused Electron tests pass.
- Recovery provenance only: `rollout-2026-10-06T08-58-26-01a111f0-08ea-7e71-97df-d524bee4bf0b.jsonl.zst` line 158 `payload.item.stdout` SHA-256 `9253c7a73686b09bdcf22f80c7d8f1fea6de233a0a867be16f86276a21167f56`.
- Recovery provenance only: `rollout-2026-10-06T13-26-31-01a112e5-790a-74d0-858d-a130283788c8.jsonl.zst` line 33 `payload.item.stdout` SHA-256 `c1b5c5e05292122ef0a10d5816dcafbe9fd1f0d40c0262d5907de7eb93b1c86d`.

## Packaged renderer gateway repair

- Native qualification boot at source `8b6a4c3f24` reached healthy API and engine but the renderer showed `Live gateway could not start`: its production origin validator correctly rejected the fixture's loopback API. The 2026-09-12 Tasks run recorded the same guard; ordinary production origins remain restricted to remote HTTPS.
- Electron main grants `http://127.0.0.1:4001` only from a validated synthetic actor and an owned top-level `rhythm://app/index.html` document. Preload exposes this bounded scalar. The web gateway accepts loopback only when the native grant, local API base, and production base are all exactly that origin. A browser-only Vite environment has no path to provide the grant. The actor's seeded bearer now reaches ordinary local routes so owner-scoped writes use normal session middleware; non-actor local traffic still strips cloud Authorization.
- RED: the gateway contract rejected fixture loopback; native actor preload exposed no fixture grant; then local session calls stripped the actor bearer. GREEN: the complete gateway contract suite passed 3/3, and Electron E12A plus security receipt suites passed 33/33. Web `tsc -p tsconfig.app.json --noEmit`, Electron `node --check`, and `git diff --check` passed.
- The original gateway contract's approval request failed before this repair because it lacked the now-required native approval capability. Running its unchanged HEAD test body through Node reproduced the same failure. Its focused test fixture now supplies a disposable native capability and asserts that only the protected approvals route receives that capability and bearer; no approval product behavior changed.
- Packaged rebuild and native API/UI readback remain pending with the parent integration lane. No new native launch or provider call was made in this repair.
- Review caught a synchronous IPC liveness edge: denials and ordinary launches now explicitly return inert `null`, which preload normalizes to `undefined`, rather than leaving a native `sendSync` unanswered. Tests cover foreign sender, subframe, wrong URL, unexpected payload, and ordinary mode denial.
