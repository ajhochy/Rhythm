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

## Fixture-only native approval signer and sync IPC correction

- Native package `5607e79024` showed that Electron delivered the first `event.returnValue` assignment immediately: the initial `null` in the fixture-origin handler prevented the later actor grant from reaching preload. The handler now makes one conditional assignment. A setter-backed source test asserts exactly one write for actor and ordinary launch paths. Repackaging and native readback remain pending.
- The private fixture creator now generates an ephemeral P-256 key and 32-byte capability under `<fixtureRoot>/approval-signer/` (`0700` directory, `0600` single-link files). Its optional manifest descriptor binds the absolute paths, SHA-256 digests, and uncompressed public point to the exact manifest bytes. The Electron actor validates that descriptor and rechecks authority, file ownership, modes, links, hashes, expiry, and public point before each capability read or signature. An actor without the descriptor retains the explicit unavailable-signer path. Ordinary launches still use the existing Keychain signer, and the API's signature verifier and approval routes are unchanged.
- RED: before signer integration, the actor exposed no signer and the new source contract failed. The VM test-loader import failure in adjacent suites was setup-only and was repaired in three focused loader fixtures. GREEN: Electron adjacent source suite (`node --experimental-vm-modules --test test/agent-server.test.mjs test/agent-server-ownership.test.mjs test/agent-server-retry.test.mjs test/qualification-runtime-ownership.test.mjs test/qualification-synthetic-actor.test.mjs test/e12a-auth-boundary.test.mjs test/security-smoke-receipt.test.mjs`) passed 78/78. The creator-to-Electron integration test then passed 5/5, independently verifying a canonical signature, rejecting a modified nonce, exact revision mismatch, and later private-file mode drift. `node --check` for changed Electron modules and `git diff --check` passed before this note.
- This is source-level evidence only. The parent integration lane owns the next guarded package and native API/UI approval readback; no real Keychain, provider, or external account was used.

## Fresh synthetic workspace membership

- Native package `2aa817b867` reached authenticated UI and API, then the strict audit saw `GET /workspaces/me/members` return Workspace not found for the synthetic owner. The ordinary `/auth/me` response also had `workspace: null`. The fixture bootstrap had seeded the public user and auth session but no workspace.
- RED: the dedicated setup test's `WorkspaceRepository.findForUser(ownerUserId)` returned `null` after synthetic boot. The bootstrap now calls the ordinary `WorkspaceRepository.create` in the private SQLite DB, giving that owner one `[smoke] Qualification <ownerId>` workspace and admin membership. On restart it accepts only that exact sole workspace/member shape; any foreign or drifted row fails closed. Other auth and workspace handlers are unchanged.
- GREEN: qualification fixture setup tests 8/8 and API `tsc -p tsconfig.json --noEmit` passed. GitNexus returned LOW/zero upstream for the bootstrap symbol from an index 266 commits stale; manual affected paths include API startup and all fixture workspace reads. A new guarded package and native `/auth/me` plus `/workspaces/me/members` readback remain pending.

## Owned session history coverage staged from native recon

- The sanitized `docs/testing/results/2026-10-20-synthetic-session-history-recon.json` records a packaged synthetic owner creating a real SDK-backed parent, three engine children, API child pages of 2 then 1 with exact ancestors and a cursor, leaf search, and parent rail count 3. The recon did not establish expanded child rows or delegated-tool/model provenance.
- `apps/web/tests/packaged/packaged-ai-owned-history.spec.ts` now requires the explicit private synthetic manifest and codifies only those observed boundaries. It creates a nonce-owned parent through the packaged UI, three children through the actual engine session API without model calls, checks engine GET, API pagination/ancestor/search, SQLite durable IDs and owner, and the parent rail count. `OwnedRecords` remembers each child and cleans only nonce-owned rows; the spec verifies API/SQLite and engine absence after cleanup.
- `npx playwright test -c tests/packaged/packaged-playwright.config.ts --list tests/packaged/packaged-ai-owned-history.spec.ts` listed the one spec. The new spec has **not** run against a packaged app; it remains staged pending the next exact build and native confirmation.

## Missing-fixture fail and owner display identity

- The owned-history packaged case now fails `UNVERIFIED: explicit disposable synthetic actor manifest required` when the manifest is absent, using base Playwright so no saved real-profile app is launched. The no-manifest command failed exactly 1/1 in under a second; this is an expected prerequisite failure, not feature proof.
- Native package `2aa817b867` showed a synthetic owner in ordinary `/auth/me` while the Shell account trigger/card and Agents rail footer still displayed the fixed AJ demo identity. Record search found prior identity-bound preference work but no matching owner-display fix. GitNexus reported LOW/zero upstream for `Menu`, `Shell`, and `SessionRail` from an index 266 commits stale; manual scope is the shared Shell menu and Agents rail presentation.
- RED: a rendered harness with a different signed-in `Morgan Fixture` identity displayed `AJAJ HochhalterRhythm workspace` in the Shell account trigger. GREEN: the same rendered test passed 1/1 after Shell/Menu and SessionRail read `useAuthUser()` for name/initials; Studio fixture mode keeps its old demo label. Web `tsc -p tsconfig.app.json --noEmit` and `git diff --check` passed. The packaged identity case is staged to compare ordinary `/auth/me`, native `auth.currentSession` user projection, and the two visible labels under an explicit synthetic manifest; it has not run natively.
- The private approval recon helper's Node fetch readback used Playwright's `response.status()` form; it now reads Node's `response.status` property. This was a recon helper error after one owned inert card, not product behavior. A corrected native approval recon remains pending.

## Primary first-use packaged case staged from native recon

- The sanitized `docs/testing/results/2026-10-20-synthetic-primary-first-use-recon.json` recorded the actual packaged fixture UI choosing a profile after `/resolve` 503 and `/setup` 200, then `/setup` 201 creating an owner-bound schema-4 root. Its empty history, null SDK binding, single durable SQLite root, and private LiveArtifacts project are observations from a Coordinator setup with no model turn.
- `apps/web/tests/packaged/packaged-ai-000-primary-first-use.spec.ts` now requires an explicit synthetic manifest before the packaged fixture starts. It asserts zero root/project allocation through profile discovery and dismissal, preserves a nonce-owned ordinary chat, reopens setup, chooses `coding-agent`, and reads back the UI-selected root, open/history responses, SQLite metadata, and private project directory. The Coordinator root is retained only in the disposable synthetic fixture for subsequent primary read cases; the ordinary chat uses nonce-owned cleanup.
- `node node_modules/@playwright/test/cli.js test -c tests/packaged/packaged-ai-playwright.config.ts tests/packaged/packaged-ai-000-primary-first-use.spec.ts --list` listed one case; `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit` and `git diff --check` passed. Running the case without a manifest failed exactly 1/1 with `UNVERIFIED: explicit disposable synthetic actor manifest required` before app launch. Native Confirm is pending, so the old explicit first-use gap stays in place.
