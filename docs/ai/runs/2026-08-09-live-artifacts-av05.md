---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-05]
status: READY_FOR_VERIFICATION
tags: [run, api_server, live-artifacts]
---

# AV-05 — Live artifact PCO capability

## Files

- `docs/ai/contracts/live-artifacts-av05.json`
- `apps/api_server/src/controllers/live_artifact_capabilities_controller.ts`
- `apps/api_server/src/routes/live_artifacts_routes.ts`
- `apps/api_server/src/integrations/planning_center/planning_center_service.ts`
- `apps/api_server/src/__tests__/live_artifact_capabilities.test.ts`
- `apps/api_server/src/__tests__/live_artifacts_live_e2e.test.ts`
- `apps/api_server/src/__tests__/pco_broker.test.ts`

## Checks

- Worktree verification: `pwd && git status --short && git rev-parse HEAD && git branch --show-current`
  - `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-artifact-viewer`
  - clean baseline before contract work; `e965cf07e5099a6a06fed544149986a68eca40dd`; `feat/artifact-viewer`.
- Contract failure: `cd apps/api_server && npx vitest run src/__tests__/live_artifact_capabilities.test.ts`
  - Failed as required before implementation: 6 assertions expected the authenticated declared route or closed validation response and received `404`.
- GitNexus impact before any existing-symbol edit:
  - `createApp` upstream: LOW, 0 direct callers/processes.
  - `PlanningCenterService` upstream: LOW, 1 direct caller, 0 processes.
  - `IntegrationsService` upstream: LOW, 0 direct callers/processes.

 - Focused contract + existing PCO broker checks: `cd apps/api_server && npx vitest run src/__tests__/live_artifact_capabilities.test.ts src/__tests__/pco_broker.test.ts src/__tests__/pco_broker_routes.test.ts`
   - PASS — 22 tests.
 - Static/build: `cd apps/api_server && node_modules/.bin/tsc --noEmit && npm run build`
   - PASS.

## Verification repair (attempt 1)

Verification returned the endpoint green but the evidence thin: several criteria passed on assertions
that could not fail. Repair closed the coverage gaps, fixed the two defects the new tests exposed, and
mutation-proved every added assertion.

### Product changes (3, all inside the new capability controller)

1. **Disconnected PCO now has a stable machine code.** `ensureFreshPlanningCenterAccount` throws
   `AppError.badRequest('Planning Center is not connected')`, so a disconnected account was
   indistinguishable from a rejected request — both `400 BAD_REQUEST`. The capability boundary now maps
   *only* that exact known error to `400 pco_not_connected`; every other error propagates untouched and
   shared `IntegrationsService` behavior is unchanged.
2. **Audit fields made consistent and complete.** Both audit call sites now emit the same five-field
   record (`actorUserId`, `artifactId`, `operation`, `at`, `outcome`) via one local helper, and the 410
   and 429 early returns — previously unaudited — are now recorded. `outcome` stays one bit
   (`success`/`failure`); the error response already carries the machine code.
3. **Rate-limiter test seam.** `capabilityRateLimit` exports `now`/`reset`/`size` so window-reset and
   pruning are testable without wall-clock timers, and the module-level window is cleared between tests
   (it previously leaked across tests in the file).

### Test-harness defect found and fixed

Adding tests to `live_artifact_capabilities.test.ts` turned a latent race into a hard failure: that file
and `live_artifacts.test.ts` both wrote to, and recursively wiped, the single cwd-relative
`apps/api_server/live-artifacts` directory. Under vitest's parallel file execution one file's `afterEach`
wipe raced the other's artifact writes — `ENOTEMPTY` on `rmdir` and a `500` on a create landing in a
directory being removed. `live_artifact_capabilities.test.ts` now owns a private `tmpdir()` storage root
(`env.liveArtifactStorageDir` is read lazily per call by `live_artifact_storage.ts`) and deletes only
that. Classified test-harness, not product: nothing shares this directory in a real deployment.

### Coverage added

- **c2** organization viewer who is *not* a collaborator gets `200` on their own PCO connection; a
  non-member gets a non-disclosing `404 NOT_FOUND`; an accessible-but-undeclared org artifact gets
  `403 capability_not_declared`.
- **c3** two table-driven adversarial suites (30 cases) — unknown/write operations
  (`create_plan`, `update_plan_item`, `delete_plan_item`, `list_needed_positions`, raw HTTP verbs),
  transport smuggling (`headers`, `method`, `accessToken`, `body`, `url`, `baseUrl`), identifier abuse
  (path traversal, whitespace, absolute URL, query smuggling, oversize >128 chars, empty, numeric,
  object, array), filter abuse, extra keys, non-object and prototype-polluting raw bodies, and an
  oversize (>1 MB) body. Every case asserts the request never reached the upstream fixture.
- **c4** disconnected → `pco_not_connected`, schema rejection → `BAD_REQUEST`, PCO denial →
  `pco_permission_denied`, with no token or upstream URL in any payload.
- **c5** exact-shape projection assertions for all three reads, and a deny-list sweep over the combined
  response for `links`/`meta`/`authorization`/`Bearer`/the account token/the fixture URL.
- **c6** limiter key isolation (same user + different artifact, and different user + same artifact both
  keep their own budget), window expiry at the boundary (`+59s` still denied, `+61s` allowed), and
  pruning (map shrinks from 3 keys to 1 after the window rolls).
- **c7** audit assertion on the real `logger.info` output: exact key set, exact values, parseable
  timestamp, on both the success and denial paths, plus a deny-list sweep for tokens/paths.
- **c8** the live probe now uses an `organization`-visible undeclared artifact and first proves the
  viewer can read it (`GET /live-artifacts/:id` → `200`) before asserting
  `403 capability_not_declared` — the previous probe used a private artifact and only ever exercised the
  inaccessible `404` branch. The inaccessible `404` case is kept as a separate assertion.
- **PCO base URL** committed safety regressions in `pco_broker.test.ts`: a 10-case table covering no
  override, override without the live flag, non-loopback host, loopback-lookalike host
  (`127.0.0.1.attacker.test`), embedded credentials, non-http scheme, unparseable value, and
  `RHYTHM_LIVE_E2E=0` — all resolve to `https://api.planningcenteronline.com`; only live+loopback
  redirects. Plus an explicit assertion that writes never redirect under a live loopback override.

### Mutation testing (proof the new assertions are load-bearing)

Each mutation was applied to the product, the suite run, and the file restored:

| Mutation | Result |
|---|---|
| Drop the closed key-count guard | 8 failed |
| Relax the identifier regex to match anything | 7 failed |
| Remove the `pco_not_connected` mapping | 1 failed |
| Drop the artifact from the rate-limit key | 1 failed |
| Remove the declared-capability check | 3 failed |
| Add a token field to the audit record | 1 failed |

### Repair checks

- Focused: `npx vitest run src/__tests__/live_artifact_capabilities.test.ts src/__tests__/live_artifacts.test.ts src/__tests__/pco_broker.test.ts` — PASS, 85 tests (the two previously racing files run together).
- Static/build: `node_modules/.bin/tsc --noEmit && npm run build` — PASS.
- Full clean shell (`env -i` with only `PATH`/`HOME`/`SHELL`/`TERM`), run 4×:
  `node node_modules/vitest/vitest.mjs run` — **4123 passed / 132 skipped / 575 files** on runs 1–3.
  Baseline before repair: 4075/132; +48 new tests. No stray `live-artifacts` directory and no leftover
  tmp storage roots afterwards.
  - Run 4 failed one unrelated test: `agent_designs.test.ts > accepts built-in finished tif output`
    (`POST /agent-designs` → `404`, expected `201`). **Not caused by AV-05** — see below.
- Pre-existing flake, ruled out as a regression: `agent_designs.test.ts` passes 5/5 in isolation, and the
  AV-05 changes were stashed (`git stash -u`) and the full suite run 4× on the clean baseline — that
  baseline failed **2 of 4** runs, in two *different* unrelated files
  (`agent_configs_routes.test.ts`, `issue_1048_engine_session_delete.test.ts`). The baseline flakes more
  than the changed branch, so this is a load-dependent cross-file defect in the api_server real-server
  harness that predates this work. Changes restored from stash and verified byte-identical against a
  pre-stash tarball; typecheck and focused suite re-run green afterwards. Filed as
  `docs/ai/generated-issues/2026-08-09-api-server-full-suite-cross-file-flake.md`.
- Live sandbox: `RHYTHM_LIVE_E2E=1 RHYTHM_PCO_LIVE_BASE_URL=http://127.0.0.1:4199 tools/dev/sandbox.sh up`
  → ready on API `:4098`, engine `:4097`; `tools/dev/sandbox.sh status` confirmed both listeners.
- Live fixture (re-run with the new undeclared-403 assertion): same command as above — PASS, 3 tests.
- Teardown: `tools/dev/sandbox.sh down` — PASS, `status` reports the sandbox removed.
- Scope: `git diff --check` clean; changeset limited to `apps/api_server/src` + `docs/ai`.
 - Sandbox: `RHYTHM_LIVE_E2E=1 RHYTHM_PCO_LIVE_BASE_URL=http://127.0.0.1:4199 tools/dev/sandbox.sh up && tools/dev/sandbox.sh status`
   - PASS — API `:4098`, fork engine `:4097`, isolated live-artifact root.
 - Live fixture: `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_SANDBOX_DB=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db RHYTHM_LIVE_DB_PATH=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox/rhythm.db RHYTHM_SANDBOX_DIR=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-dev-sandbox npx vitest run src/__tests__/live_artifacts_live_e2e.test.ts --no-file-parallelism`
   - PASS — 3 tests. Controlled `node:http` fixture on `127.0.0.1:4199` received only the sandbox-seeded viewer bearer token; hostile upstream fields, fixture token, and URLs were absent from API response and API log. Fixture and sandbox-only account rows were removed.
 - Teardown: `tools/dev/sandbox.sh down` — PASS.
 - Scope/diff: `git diff --check && git diff --stat && git status --short`; GitNexus `detect_changes(scope=all)` — PASS, low risk/no affected process.

## Notes

- WAIVED: evidence-only test/docs repair; verification is focused AV05 tests, TypeScript/build, mutation checks, and a clean-shell suite. No product behavior was changed.
- **Verification repair (attempt 2):** the >1 MiB request now injects bearer/token, raw-body,
  `/state/`, `/bundles/`, worktree-path, stack/newline-at, and artifact-internal sentinels, then
  asserts their absence from the public response and captured logs with zero PCO calls. Audit
  evidence now proves the exact five keys and values for success, 403, accessible 410, and 429;
  removing either early-return audit call fails the specific test. The limiter has deterministic
  injected-clock boundaries (60 then 1). `http://[::1]` remains an explicitly documented,
  deliberate fail-closed override seam; no product change was made.
- Repair checks: focused `live_artifact_capabilities`, `live_artifacts`, `pco_broker`, and
  `pco_broker_routes` — **94 passed**; `tsc --noEmit && npm run build` — PASS; clean-shell full
  suite — **4124 passed, 132 skipped, 575 files**. Sandbox/live was not rerun because only tests
  and evidence changed; the existing live result above remains applicable.
- Mutation proof: removing the 410 audit call caused the exact-audit test to fail at the deleted
  artifact assertion; removing the 429 audit call caused it to fail at the rate-limited assertion.
  Both mutations were restored before the final focused/full runs.
- The endpoint-local fixed-window limiter is deliberately process-local for the single-process Synology deployment; migrate it to a shared store only for multi-instance hosting.
- Read-only PCO uses a live-test-only loopback base override. All non-live or non-loopback values retain `https://api.planningcenteronline.com`; PCO writes remain unchanged.
- `AV05-c9` is now `pass` with the scope-scan evidence recorded on the criterion in
  `docs/ai/contracts/live-artifacts-av05.json`; `not_tested` is empty.
- Deliberately **not** changed, and why:
  - An oversize (>1 MB) body returns `500`, not `413`, because the shared `errorHandler` only special-cases
    `entity.parse.failed`, not `entity.too.large`. That is app-wide behavior on every route, so the
    capability test asserts only that the request is rejected and never brokered upstream rather than
    pinning a status this change is not entitled to fix. Worth a follow-up on the shared handler.
  - `pcoReadBaseUrl`'s loopback allowlist contains `'::1'`, which can never match: `new URL()` reports the
    IPv6 hostname as `'[::1]'`. The entry is dead but only makes the allowlist *more* restrictive, so it is
    not a behavior defect and was left alone. Fixtures bind `127.0.0.1`.
  - `live_artifacts.test.ts` still uses the shared cwd-relative storage root. With the capability file
    moved off it there is no longer a cross-file race, so it was left as-is.
  - Audit denial reason codes were not added: the error response already carries the machine code and
    nothing consumes a reason vocabulary yet.
