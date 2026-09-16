---
date: 2026-09-10
repo: Rhythm
branch: feature/electron-flutter-retirement
pr: null
issues: [electron-e02-harness]
status: FIXED
tags: [run, Rhythm]
---

## 2026-09-11 — focused engine bootstrap diagnosis (current: FIXED)

### Files / diagnosis

- Worktree `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement`, branch `feature/electron-flutter-retirement`, HEAD/base `0bc46a5ece1a937c484c0054493c75b0299eafef`. Preserved other lanes' uncommitted files. This continuation edited only `tools/dev/sandbox.sh`, `tools/dev/sandbox_bootstrap_test.py`, this contract/run and testing-guide.
- Loaded failure-triage; compared `git show HEAD:tools/dev/sandbox.sh` with current diff and successful `2026-07-14-dev-sandbox-isolation.md`. GitNexus shell impact returned target-not-found / UNKNOWN (no indexed caller/process counts); shell lifecycle source reviewed directly. No product symbols edited.
- **Confirmed root cause: launcher PATH regression.** Node's directory also contains `/Users/ajhochhalter/.local/bin/opencode`. SDK `vendor/opencode-ai-sdk/server.js:14` launches bare `opencode`; `augmentPathForOpencode` only prepends missing directories, so the already-present fork directory stayed behind the stock CLI. The fork-override log does not prove executable selection. Diagnostic shell `command -v opencode` returned the stock path. Actual engine output: `Configuration is invalid .../opencode.json` / `Unrecognized key: reference`; `/opencode/health` returned `status: unavailable`, not readiness. The freshly built fork source supports `reference`.
- Minimal correction: PATH order is shim → built fork → caller Node → fallbacks. Absolute Node invocation and ABI check remain. Added regression for both executable resolutions. Also fixed the lost-evidence path before launching: nonzero startup EXIT rescue plus pre-down rescue, sanitized logs/health to sibling evidence directories; readiness now parses `status == ready` before existing exact engine-executable ownership check. MCP `RHYTHM_AGENT_URL` pinned to sandbox. Established `--skip-embed-web-ui` used for headless builds; MCP build added so all three artifacts came from current unchanged source, not an assumed stale dist.
- No plugin/package provisioning was needed. Missing dependencies, wait window and fixture roles were hypotheses, not the cause of the captured failure. No product API/fork/web/Electron, dependency/lock, fixture-generator, guard-test, baseline/plan/current-plan changes. No peers, commits, pushes, PRs or issues.

### Commands / observed evidence

All commands used the worktree root. `/Users/ajhochhalter/.local/bin/node22` does not exist; actual caller `command -v node` is `/Users/ajhochhalter/.local/bin/node`, reporting `v22.23.0`, ABI `127`. `git diff --quiet HEAD -- apps/api_server apps/mcp_server apps/opencode_fork` passed. Both `up` calls built fork/API/MCP in the launcher; no separate typecheck/full suite ran. Fork build/version smoke passed, including corrected version `0.0.0-feature/electron-flutter-retirement-202609111544`.

Source validation: retained `/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a`; read-only SQLite `PRAGMA integrity_check` → `ok`; two synthetic users with example.invalid emails/no password hashes, one workspace, two memberships, public synthetic session, zero enabled schedules/automations. Config contains only local worktree MCP command and sandbox4098 URL. Launcher read-only/containment preflight passed.

```bash
export RHYTHM_SANDBOX_NODE_BIN=/Users/ajhochhalter/.local/bin/node
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-e02-fixture-20260911-phase0-57ba71255a
export RHYTHM_LIVE_DB_PATH=$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=$RHYTHM_APPROVED_FIXTURE_ROOT/opencode.json
export RHYTHM_SANDBOX_API_PORT=4098 RHYTHM_SANDBOX_ENGINE_PORT=4097 RHYTHM_SANDBOX_GATEWAY_PORT=4099
# Diagnostic (one launch):
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-e02-diagnosis-20260911 tools/dev/sandbox.sh up
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-e02-diagnosis-20260911 tools/dev/sandbox.sh status
RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-e02-diagnosis-20260911 tools/dev/sandbox.sh down
# Corrected (one launch; down was an EXIT trap in the same command):
export RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-e02-corrected-20260911
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status
curl --max-time 10 -fsS http://127.0.0.1:4098/opencode/health
curl --max-time 10 -fsS http://127.0.0.1:4097/global/health
curl --max-time 30 -fsS http://127.0.0.1:4097/mcp
python3 tools/dev/sandbox_bootstrap_test.py && python3 tools/dev/sandbox_e02_guard_test.py
tools/dev/sandbox.sh down
```

- Diagnostic up exited 1 after readiness wait; preserved `/private/tmp/rhythm-e02-diagnosis-20260911.evidence.NoGGoM/api_server.log` lines 61–71 and `opencode-health.log` contain the actual rejection. Down also preserved sibling `...evidence.WFygt6`. Status at subsequent command found no listeners; no attempt was made to hand-start or signal an engine.
- Corrected up exited 0: API/gateway PID69028; engine PID69049. `record_engine_identity` passed its exact `process_executable == ENGINE_BIN` assertion. API health: `{"status":"ready","message":"Opencode SDK ready","bridgeLive":true,"websearchConfigured":false}`. Engine: `{"healthy":true,"version":"0.0.0-feature/electron-flutter-retirement-202609111544","pid":69049,"bootId":"a05b1591-5c2a-4516-a344-26a1a682ec9d"}`. MCP: `{"rhythm":{"status":"connected"}}`.
- Corrected preserved logs: `/private/tmp/rhythm-e02-corrected-20260911.evidence.AYpujA/`; API lines 61–64 show spawn 1004ms, SDK initialized, total initialization 1087ms; lines 68–69 confirm absolute worktree MCP override and persisted config. Health body survives teardown in `opencode-health.log`. No credentials/config/DB dumps in evidence.
- Focused checks executed while corrected sandbox was ready: bootstrap **4/4 PASS** (0.476s), guards **4/4 PASS** (0.812s). Evidence regression drives nonzero `fail`, checks redaction and verifies the saved log survives runtime removal. Guard tests are shell/bootstrap checks, not HTTP product tests or provider qualification.
- Before/while/after `lsof -nP -iTCP:4001 -iTCP:4002 -iTCP:4096 -iTCP:4097 -iTCP:4098 -iTCP:4099 -sTCP:LISTEN`: live4001/4002 stayed PID13141, live4096 stayed PID13155. Before/after `lsof -a -p 13141,13155 -d txt -Fn`: main executables unchanged at `/Applications/Rhythm.app/Contents/Resources/node/bin/node` and `/Applications/Rhythm.app/Contents/Resources/opencode_bin/opencode`. No live signals. Both down calls removed owned runtimes; explicit absence checks passed and sandbox ports were free after corrected down. Evidence and source fixture retained, no extra cleanup.
- `git diff --check` passed; status still lists only pre-existing scoped lane files. Runtime npm offline/inert registry/cache settings and Keychain denial shim retained. No general network reopening or public provisioning; no claim of packet-capture coverage, real Keychain qualification, or provider/plugin functionality. **FIXED — focused diagnosis complete; no additional startup or full verification gate requested.**

## 2026-09-11 — focused Node ABI source repair (historical)

### Files

- Only `tools/dev/sandbox.sh`, `tools/dev/sandbox_bootstrap_test.py`, and this E02 contract/run edited in `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement`; requested branch `feature/electron-flutter-retirement` supplied by dispatch and prior evidence, not rechecked with commands.
- Launcher captures explicit `RHYTHM_SANDBOX_NODE_BIN` or caller `command -v node` before environment sanitation. Requires an absolute executable regular file; loads installed `better-sqlite3/build/Release/better_sqlite3.node` with that Node under runtime env, without creating/opening a DB. Preflight precedes `up` writes/builds and `restart` stop. All three API launches invoke the pinned executable; its dirname follows `$SB/bin` and precedes every other runtime PATH entry. No operator-specific Node path hardcoded.
- New focused test uses the real shell and installed native addon, not a mocked system under test. Checks fallback/explicit Node, bare-node resolution, shim-first PATH order, invalid executable paths and startup/restart wiring/order.

### Checks / phases

- Phase 0 complete using existing observed RED, not a waiver: prior session `9df5e3b5`, exact authorized `tools/dev/sandbox.sh up` invocation and failure excerpt retained below. `ERR_DLOPEN_FAILED`: installed ABI127, runtime ABI147. Prior status had no sandbox listeners; down removed runtime; live PIDs/ports unchanged. Did not rerun RED. New test assertion written before implementation.
- Manager-confirmed root cause (not re-executed here): caller `/Users/ajhochhalter/.local/bin/node` v22.23.0 ABI127, sanitized PATH `/opt/homebrew/bin/node` v26.5.0 ABI147.
- Phase 1: read AGENTS, project-state/current-plan, launcher, focused test and E02 contract/run. Required read-only GitNexus upstream impact for `tools/dev/sandbox.sh`, repo Rhythm: target not found, risk UNKNOWN; no indexed caller/process counts available, not a LOW-risk claim. Shell unindexed as in prior evidence. Source review covered full launcher including both `up` branches, `restart` and engine runtime-env consumers. No HIGH/CRITICAL result or product symbol edit.
- Phase 2 source repair complete; verification pending. **No commands, tests, builds, starts, installs, network requests, Keychain operations, commits, pushes, PRs, issues or peers executed in this continuation.** Only skill load, file inspection/patches and required read-only impact metadata lookup. No post-edit execution or new PASS claimed; zero execution repair attempts.
- Historical 2/2 bootstrap and 4/4 guard PASS below apply to the previous source only, not the added ABI assertion. Existing `sandbox_startup.status=FAIL` intentionally preserves observed RED until the verifier records a new result.

### Handoff

- **READY_FOR_VERIFICATION — source repair pending verifier**, not verified complete. Verifier owns one proportional post-fix run using the retained synthetic fixture and existing launcher; no extra RED or broad qualification. Focused maintained command: `python3 tools/dev/sandbox_bootstrap_test.py && python3 tools/dev/sandbox_e02_guard_test.py` (not run here). Preserve sandbox status/down and live-PID evidence when executing the single authorized launch.
- No product API/engine/web/Electron, package/lock/generated, fixture generator, testing-guide, plans/current-plan, coverage or baseline document edits. No runtime created, so no teardown required in this continuation.

## 2026-09-11 — minimum bootstrap continuation (prior outcome)

- Scope: launcher, one generator, one focused bootstrap test, testing-guide and this E02 contract/run only. Existing four-guard file unchanged. No dependency changes, architecture work or product edits.
- Phase 0: invoked acceptance-contract first; read AGENTS and memory files. `python3 tools/dev/sandbox_bootstrap_test.py` → exit 1, 2 tests / 2 assertion failures: missing absolute MCP override and missing generator. No waiver.
- Phase 1: shell is unindexed (prior impact target-not-found evidence below); only new unindexed generator/test and launcher edited. Canonical `initDb`/migrations imported, not modified; no indexed edit requiring impact.
- Phase 2: absolute MCP env plus up/restart preflight; npm offline=true, registry=http://127.0.0.1:9, cache=$SB/npm-cache. Canonical fresh synthetic SQLite generation, fake identities/session, disabled schedules/automations, DELETE journal and 0400 source DB/config. `python3 tools/dev/sandbox_bootstrap_test.py` → exit 0, 2/2, 1.302s; canonical migration output `tasks updated=0, project_steps updated=0`. Scratch fixture automatically removed. No repair attempts.
- Prelaunch: `ls -ld /private/tmp && lsof -nP -iTCP:4001 -iTCP:4002 -iTCP:4096 -iTCP:4097 -iTCP:4098 -iTCP:4099 -iTCP:4175 -sTCP:LISTEN` → parent exists; live 4001/4002 PID 13141, live 4096 PID 13155. All four sandbox ports free.
- Fixture command: `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-e02-fixture-20260911-bootstrap` → exit 0, fresh canonical DB and read-only sources. This synthetic source fixture is retained; runtime copy removed.
- Exactly one launch command (worktree root): `RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-e02-fixture-20260911-bootstrap RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-e02-fixture-20260911-bootstrap/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-e02-fixture-20260911-bootstrap/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-e02-runtime-20260911-bootstrap tools/dev/sandbox.sh up`.
- Observed: existing fork build ran with checked-in models JSON and --skip-install (including its own embedded UI asset build and version smoke); engine version smoke passed `0.0.0-feature/electron-flutter-retirement-202609111508`. Existing API tsc/postbuild completed. No separate web/Electron build, typecheck or suite invoked. Generated build outputs were produced only by mandated startup, not manually edited.
- **BLOCKED exact:** API startup `initDb` failed `ERR_DLOPEN_FAILED`: better-sqlite3 compiled with `NODE_MODULE_VERSION 127`, launch Node requires `147`. up exhausted its existing health wait; no API readiness, engine startup or required MCP ensure reached. No retry, dependency rebuild/install, or product repair attempted. Runtime PATH prepends system Node locations whereas fixture generation used the invoking Node; compatible launch Node/dependency ABI is the resume prerequisite, not an authorization to reinstall.
- Failure log preserved by launcher: `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/rhythm-sandbox-failure-20260911T081012.log`. Full up tool output: `tool_091039c17001hssBiuLwmx1jRf`.
- `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-e02-runtime-20260911-bootstrap tools/dev/sandbox.sh status` → runtime paths printed; API4098/engine4097/gateway4099 listeners empty. `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-e02-runtime-20260911-bootstrap tools/dev/sandbox.sh down` → `Sandbox removed: /private/tmp/rhythm-e02-runtime-20260911-bootstrap`. `test ! -e /private/tmp/rhythm-e02-runtime-20260911-bootstrap` succeeded.
- Repeated the prelaunch lsof command after down: only live 4001/4002 PID13141 and 4096 PID13155, unchanged; 4097/4098/4099/4175 free. No live listener killed or started by this run.
- Original E02 four-guard command intentionally NOT rerun: prerequisite running sandbox never became healthy. Historical 4/4 outside-sandbox retained, no new inside-sandbox result. New focused bootstrap is 2/2 PASS only. No runtime network denial or plugin capability PASS claimed from an API that never reached engine startup.
- Handoff: **BLOCKED_NODE_ABI_MISMATCH**, not READY_FOR_VERIFICATION. User's stop-at-new-blocker instruction honored; no broad verification, dependency changes, commit/push/PR/issues/peers. This run's process/checks/handoff are recorded here rather than only in chat.
- Final `git status --short --branch` confirms requested branch and no new product/package/lock/generated tracked changes; prior plan/current-plan/baseline changes remain untouched. `git diff --check` → exit 0. Cumulative owned numstat (includes prior E02 changes): sandbox.sh +69/-13; testing-guide +42/-0; new bootstrap test +56/-0; fixture generator +46/-0; E02 contract +72/-0; E02 run +145/-0 including this line. Untracked counts obtained with `git diff --no-index --numstat /dev/null <path>` (exit 1 means differences). Original +94/-0 four-guard file is unchanged by this continuation.

## 2026-09-11 — launch-only prerequisite triage (prior outcome)

- User course correction preserved: this is infrastructure needed to run the proportional guard inside a sandbox, not application qualification. Prior guard **4/4 PASS outside sandbox** remains valid; startup is **NOT_TESTED**, not PASS. No full-suite verification is requested or authorized.
- Loaded failure-triage. `git status --short --branch` confirmed `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement`, branch `feature/electron-flutter-retirement`; existing parallel changes were left alone. No failed runtime command was supplied: the prior blocker was source-proven and deliberately not executed. The single launch attempt was not spent on a known unsafe bootstrap.
- Confirmed the proposed read-only config mechanism: `packages/core/src/npm.ts:137–142` returns before Arborist when directory write access fails. A dedicated XDG config root would also need separation from API-managed `HOME/.config/opencode`, since `ensureRequiredPlugins` writes community plugin names there. This is source evidence only, not a tested fix.
- **Exact additional prerequisite blocker:** filesystem Read returned `File not found` for this worktree's `apps/api_server/dist`, `apps/opencode_fork/packages/opencode/dist`, and `apps/mcp_server/dist`. `tools/dev/sandbox.sh:362–363` unconditionally builds engine/API; `apps/api_server/package.json:11` defines the API build as `tsc -p tsconfig.json`. `resolveRhythmMcpCommand` (`opencode_client_service.ts:318–354`) uses a local payload if present, otherwise falls back to `npx -y @ajhochy/rhythm-mcp-server@<version>`. `ensure_rhythm_mcp` invokes that registration after readiness. A read-only config directory does not supply the missing MCP executable or eliminate this separate fallback.
- Classification: environment/bootstrap prerequisite, not a product defect. Building the missing artifacts would cross this dispatch's explicit no-typecheck/generated-files and fixture/guards-only provisioning boundary. No artifact override was supplied. Minimum unblock: provide approved, credential-free offline API/engine/MCP launch artifacts and permit launcher reuse, or explicitly authorize artifact-only offline provisioning. This is not a request for full-suite/app qualification.
- Changes in this continuation: existing E02 contract/run and the testing-guide only. No implementation symbols edited; no pre-edit symbol impact needed. No fixture generator or unverified config workaround added while launch artifact provisioning is unresolved.
- Not run: fixture generation, `up/status/down`, guard rerun, health probes, builds, installs, typecheck, web/Electron/API suites or packages. No runtime was started, so teardown is not applicable. No outbound-install denial evidence is claimed. No live files/credentials/Keychain/external network accessed; no commits/push/PR/issues/peers.
- Handoff: **BLOCKED — missing approved offline launch artifacts under the current provisioning restrictions.** Guard PASS is historical/outside-sandbox only; all product/web/package evidence remains deferred.

## 2026-09-11 — bounded Phase0 focused repair (prior outcome)

- User course-correction supersedes the broader BLOCKED handoffs below: E02 Phase0 covers Keychain shim safety, offline build input wiring, malformed/unusable MCP rejection and ambient promotion disabled only. Historical launch blockers remain deferred evidence, not a Phase0 runtime-install task or a runtime PASS.
- Reproduced `python3 tools/dev/sandbox_e02_guard_test.py` → exit 1, 4 tests in 1.332s, 3 pass / 1 fail: `AssertionError: 0 == 0 : unusable MCP was accepted`.
- Classification/root cause: harness validator defect; checking only `.mcp` length accepted a local entry without a command. Replaced the count check with one jq structural predicate requiring a nonempty object of local entries and nonempty string command arrays. Operator sanitation still owns executable safety. Existing missing-command regression retained unchanged; no exhaustive schema coverage claimed.
- Shell is unindexed (prior impact UNKNOWN / target not found); no indexed symbols edited. Shared `validate_sanitized_config` is reached through `validate_copied_data_inputs` before `up` launches anything. Approved Keychain shim and offline build wiring preserved unchanged.
- Proportional rerun: `python3 tools/dev/sandbox_e02_guard_test.py` → exit 0, `Ran 4 tests in 0.940s`, `OK` (4/4 PASS). These are bootstrap guards, not a live behavioral test. Offline build input wiring is source-reviewed only; no build PASS.
- `git diff --check` → exit 0, no whitespace errors. Confirmed branch `feature/electron-flutter-retirement`. Cumulative tracked E02 numstat: launcher +65/-13; testing-guide +26/-0 (includes prior owner changes, not just this repair).
- This repair changes only `tools/dev/sandbox.sh`, `docs/ai/testing-guide.md`, and the existing E02 contract/run. `tools/dev/sandbox_e02_guard_test.py` remains unchanged by this repair. Parallel/product/plan/baseline/package/lock/generated files untouched.
- Deferred to first backend integration checkpoint before launch: synthetic fixture/full launch, runtime `Npm.install`/Arborist and plugin dependency resolution, recursive config containment, post-start environment/shim, different-UID ownership, occupied-port/owned teardown evidence. Deferred to first relevant UI/integration checkpoint: web/Electron harness expansion. Deferred to first relevant Keychain integration/release checkpoint: dedicated-account real Keychain, normal packaged lifecycle and architecture qualification. All remain NOT_TESTED, no waiver or false PASS.
- No sandbox/app/server/browser/build/install/start, external network, real Keychain, live data, port probes, commits/push/PR/issues/peers. Guard scratch directories are automatically removed. Runtime teardown is not applicable.
- Handoff: **FIXED — re-run proportional verification gate**, limited to the guard command and diff whitespace check; no full suite/typecheck or runtime launch authorized.

## Historical evidence (superseded scope; retained for traceability)

## 2026-09-11 — approved Keychain isolation continuation

- Invoked acceptance-contract first; read AGENTS, project-state/current-plan, existing contract/run and launcher/guard sources. Verified branch `feature/electron-flutter-retirement`; parallel E00/E01 documents left untouched.
- Bootstrap red command: `python3 tools/dev/sandbox_e02_guard_test.py` → exit 1, 4 tests / 8 assertion failures (missing Keychain guard including five tamper cases; malformed MCP accepted; ambient promotion retained). No real security executable was invoked: missing guard exits 42 before command resolution. No server/build ran.
- Pre-edit `gitnexus_impact(target=tools/dev/sandbox.sh, direction=upstream, repo=Rhythm)` → target not found, UNKNOWN; shell unindexed. New guard tests are unindexed. Product credential bridge will not be changed. Phase 0 has red evidence for the isolation refinement; remaining E02 coverage is not yet complete.

## Files

- `docs/ai/contracts/electron-e02-harness.json`: incomplete acceptance contract, all five dispatched criteria UNVERIFIED; no waiver or PASS.
- `docs/ai/runs/2026-09-10-electron-e02-harness.md`: blocker and handoff evidence.
- No implementation, test harness, product, original-checkout, or org-reviewer files changed.

## Checks

- Invoked `acceptance-contract` first. Read isolated-worktree `AGENTS.md`, `docs/ai/project-state.md`, `docs/ai/current-plan.md`, and existing sandbox/guard sources.
- Working directory for git commands: `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement`.
- `git status --short --branch && git rev-parse HEAD` → clean `feature/electron-flutter-retirement`, HEAD `0bc46a5ece1a937c484c0054493c75b0299eafef`.
- Filesystem Read checks returned `File not found` for `node_modules`, `apps/api_server/node_modules`, `apps/web/node_modules`, `apps/electron/node_modules`, `apps/opencode_fork/node_modules`, and `apps/opencode_fork/packages/opencode/node_modules` in this worktree. Root package manifest declares the API workspace; neither its root nor local install exists.
- Acceptance command: none yet. No tests/builds/apps/servers run, including guard tests. No failing acceptance result claimed; Phase 0 remains incomplete.
- No installs, network access, real data/config/credential access, Keychain access, live probes, commits, pushes, PRs, or peer dispatch.
- Final checks: `git diff --check` exited 0 (tracked diff empty); `git status --short` lists only the two owned untracked documents. `git diff --no-index --numstat /dev/null <path>` reports contract +51/-0 and run note +35/-0 after this evidence line (exit 1 denotes differences). GitNexus `detect_changes(scope=all, repo=Rhythm, worktree=/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement)` returned zero changed symbols/processes, risk `none`; untracked documentation is not evidence of indexed implementation validation.

## Notes

Historical blocker (repaired by manager before continuation): package installs were missing. The manager reports root/API/web/Electron npm ci and official Bun 1.3.13 fork dependency provisioning completed without package/lock changes.

Sandbox lifecycle: NOT STARTED. No synthetic fixture or sandbox directory was created, no ports were probed, and no processes were launched; teardown is not applicable (nothing owned to remove). Do not interpret this as a lifecycle PASS.

Remaining not_tested: all `electron-e02-c1`–`electron-e02-c5`, including executable acceptance red/green evidence, synthetic provisioning/sanitation, guard isolation and ownership checks, intercepted traffic regressions, complete suite discovery, ordinary Electron environment isolation, both architecture tiers, sandbox up/status/down, and focused build/typecheck/tests. These are resume targets, not manual waivers.

Change flags: docs only; config/security/test-harness/backend-harness implementation not started. No symbols edited, so no pre-edit symbol impact required. Manager owns later E00/E01 integration and independent verification; this handoff is not READY_FOR_VERIFICATION.

## Continuation — offline bootstrap prerequisite

- Resumed the same owned slice and the same two documents; no duplicate contract/run created. Invoked `acceptance-contract` first, then read worktree AGENTS and both memory snapshots. Loaded `coding-agent`. No Phase 0 waiver: this is behavioral work and Phase 0 remains incomplete.
- `git status --short && git branch --show-current` → only these two documents untracked; branch `feature/electron-flutter-retirement`.
- `command -v bun && command -v node && command -v python3 && command -v sqlite3 && command -v jq && command -v lsof` → exit 0; all fixture/guard provisioning tools resolve. No dependency install was attempted.
- Read-only bootstrap inspection: `tools/dev/sandbox.sh:314` unconditionally runs `bun run build --single` before API startup. `apps/opencode_fork/packages/opencode/script/build.ts:15` imports `generate.ts`; `generate.ts:10–14` fetches `https://models.dev/api.json` unless `MODELS_DEV_API_JSON` names a supplied local file. `build.ts:177–180` runs two `bun install` commands unless `--skip-install` is passed (the launcher does not pass it). These are source observations, not observed network attempts or build failures.
- Glob checks for `apps/opencode_fork/packages/opencode/dist/**/bin/opencode` and `apps/opencode_fork/packages/opencode/src/provider/models-snapshot*` → no files found. Installed dependencies alone do not provision the engine artifact or model snapshot.
- BLOCKED: the required launcher path currently performs external-network operations, contrary to the dispatch's explicit prohibition. Manager must provision an offline build input/artifact and approve its launcher wiring (local model JSON + skip-install/offline build path, or a verified prebuilt engine with a reuse path). Do not simply rerun current `up`; do not remove the network restriction implicitly or edit the vendored build scripts. No engine functionality was removed to manufacture an offline PASS.
- Files changed in this continuation: contract reason fields and this run note only. Change flags: docs=true; tests/config/security/backend/runtime/package/lock/subtree=false. No implementation symbols edited.
- Checks not run: contract tests (command still null), guard tests, fixture generation, web discovery/tests/typechecks/builds, Electron tests, Keychain, Apple Silicon/Intel lifecycle, sandbox up/status/down. All five criterion IDs remain not_tested and UNVERIFIED, not manual waivers.
- Sandbox evidence: NOT STARTED. No `/private/tmp` fixture or sandbox was created; no API/engine/Electron process started and no port probed. Teardown is not applicable, not a teardown PASS. No commit/push/PR/issue/peer dispatch.
- Continuation final gate: GitNexus `detect_changes(scope=all, base_ref=0bc46a5ece1a937c484c0054493c75b0299eafef, repo=Rhythm, worktree=/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement)` → 0 symbols/processes, risk none (untracked docs not indexed). `git diff --check` → exit 0, tracked diff empty. `git diff --no-index --numstat /dev/null <owned path>` → contract +51/-0, run +47/-0 before this final line (+48/-0 afterward); exit 1 means differences. Final status also showed concurrently added untracked `docs/ai/contracts/electron-phase0-baseline.json`; it was not read, edited, or owned by this continuation.

## Final continuation — authorized offline build input

- Manager supplied the checked-in `test/tool/fixtures/models-api.json` build input and authorized `MODELS_DEV_API_JSON=<absolute snapshot> bun run build --single --skip-install` through the launcher. This is not provider credential or parity evidence.
- Phase 0 bootstrap red: `python3 tools/dev/sandbox_e02_guard_test.py` (worktree root) → exit 1, two assertion failures: unusable MCP accepted (exit 0); inherited `AUTO_PROMOTION_FEATURE_AVAILABLE=true` retained instead of false. No server/build or repo application test ran. Only guard-generated disposable files were used. Remaining criterion coverage is still incomplete.
- Exact NEW safety blocker (source trace, deliberately not exercised against Keychain): `apps/api_server/src/server.ts:745-747` calls `credentialsBridge.readClaudeCreds()` when the synthetic Anthropic account store is empty. `credentials_bridge_service.ts:87` unconditionally reaches `loadFromKeychain()`, whose lines 324–329 execute `security find-generic-password -s "Claude Code-credentials" -w`. There is no environment opt-out in that path. The startup path also starts the Keychain poll at server.ts:805. A synthetic HOME or clearing provider variables does not isolate the current OS account's Keychain. The offline model JSON does not resolve this separate boundary.
- Stopped before implementation/startup: changing that backend credential behavior is outside exclusive E02 ownership and the explicit no-product-behavior instruction. No PATH shadow command, credential mock, fake account, or unapproved OS sandbox was introduced to bypass it. Resumption requires an explicitly approved launch-level credential isolation mechanism or a separately scoped backend opt-out. This is NOT a claimed engine build failure; no build was attempted.
- Phase 1 inspection: `gitnexus_impact(tools/dev/sandbox.sh, upstream)` → target not found, UNKNOWN (shell unindexed). `gitnexus_context(readClaudeCreds)` confirmed the call to loadFromKeychain; upstream impact (depth 3, tests excluded) → LOW, 4 direct callers, 10 total impacted symbols, 0 indexed processes. No implementation symbols edited. Other bootstrap reads: sandbox/guard sources, API schema and startup/env/credential source, fork build/generate/script sources, package manifests. No source outside ownership changed.
- Final maintained acceptance command: `python3 tools/dev/sandbox_e02_guard_test.py` → exit 1, 2 tests / 2 assertion failures, 0.099s. Test names corrected to accurately describe their limited scope: unusable MCP rejection and ambient promotion override. They source the actual launcher; no system-under-test mocks. They do NOT claim recursive validation, real launch environment isolation, fixture validity, or complete c2 coverage.
- `gitnexus_detect_changes(scope=all, base_ref=0bc46a5ece1a937c484c0054493c75b0299eafef, worktree=/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement, repo=Rhythm)` → LOW, 2 changed documentation symbols, 0 processes. Results name current-plan documentation owned by the parallel coder; not edited by this session. Untracked E02 tests/docs are not indexed evidence.
- Owned files: existing contract/run plus new `tools/dev/sandbox_e02_guard_test.py`. Flags: docs=true, tests=true, implementation/config/package/lock/generated-fork/product=false. Offline sandbox invocation, fixture generator, existing guard implementation, web/Electron harnesses and testing-guide remain unchanged.
- Sandbox evidence: NOT STARTED; no synthetic application fixture or `/private/tmp` sandbox was generated, no ports probed, no processes launched. Bootstrap guard scratch directories were automatically removed by TemporaryDirectory. `up/status/down` not run: no owned sandbox exists to tear down. No Keychain access, external fetch/install, normal Electron, production config/DB access, commits, push, PR, issues, or peers.
- Handoff: BLOCKED, not READY_FOR_VERIFICATION. All c1–c5 remain not_tested for complete acceptance; c2 has partial red evidence only. Remaining checks include fixture sanitation/read-only containment/safe usable MCP, launch allowlist and teardown ownership, all web discovery/traffic/typecheck/build gates, Electron ordinary integration-flag isolation, dedicated-account Keychain, normal packaged lifecycle, and Apple Silicon/Intel qualification. Phase 0 incomplete; Phase 2 not started. No waiver or product-parity PASS.
- Final diff checks: `git diff --check` and `git diff --no-index --check /dev/null <each owned file>` produced no whitespace errors (exit 0). Owned untracked numstats: guard +52/-0, contract +51/-0, run +61/-0 before this line (+62/-0 afterward); no-index numstat exits 1 for differences. Concurrent current-plan +2/-0, baseline contract and replacement plan are not E02 changes and were left untouched.

## 2026-09-11 handoff — BLOCKED on runtime dependency installation

### Files / change flags

- `tools/dev/sandbox.sh`: Keychain shim creation and fail-closed verification at runtime launch/restart/status; explicit env allowlist, synthetic HOME/XDG/temp paths, promotion disabled, local production-base override, managed Chrome disabled, project-config/model-fetch/update flags, renderer-port preflight; approved local models JSON and `bun run build --single --skip-install` wiring. These launch/build changes are **not runtime validated**.
- `tools/dev/sandbox_e02_guard_test.py`: real-shell shim resolution/nonzero diagnostic and five tamper cases; ambient Python optimization regression; existing promotion/MCP contracts retained.
- `docs/ai/testing-guide.md`: two-layer Keychain boundary and explicit runtime-install blocker warning; existing broader examples not yet revised.
- Existing E02 contract/run updated; no other documents owned. Flags: docs/test-harness/sandbox-security/sandbox-runtime/build-wiring=true; API-product/credential-bridge/web/Electron/package/lock/generated-fork=false. No commit/push/PR/issues/peers.

### Checks and repair loop

- All shell/test commands below ran from `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement`.
- Initial focused run (three named tests below): exit 1, one failure because content-tamper setup tried writing a correctly read-only shim. Repair 1: grant owner write only during tamper setup, restore mode 0500, then validate. Rerun → 3/3 pass, 1.138s.
- Added ambient `PYTHONOPTIMIZE=1` to the tamper matrix. `python3 tools/dev/sandbox_e02_guard_test.py SandboxGuards.test_keychain_shim_tampering_fails_closed` → exit 1, four assertions proved Python optimization bypassed `assert` validation. No `security` invocation in this tamper test. Repair 2: use explicit conditional errors and `python3 -I`, not security-critical Python asserts.
- Final focused command: `python3 tools/dev/sandbox_e02_guard_test.py SandboxGuards.test_keychain_shim_is_required_and_blocks_security SandboxGuards.test_keychain_shim_tampering_fails_closed SandboxGuards.test_runtime_environment_disables_ambient_promotion` → exit 0, 3/3 tests, 1.247s. Real shell `command -v security` returned the generated sandbox shim; invoking it returned 1 with `sandbox: Keychain blocked`. Exact shim bytes contain only shell printf/exit, no real binary invocation. Missing file, altered bytes, file permissions, symlink to real binary, and writable bin directory rejected even with ambient optimization. Actual different-UID ownership test and post-API-start PATH remain not_tested.
- Final maintained contract command: `python3 tools/dev/sandbox_e02_guard_test.py` → exit 1, 4 tests / 1 failure, 1.646s: `unusable MCP was accepted` (exit 0). This existing unfinished criterion was not relabeled PASS. Phase 0 is partial for full E02; Phase 2 is partial, not complete.

### Exact NEW prerequisite failure (source-proven, not executed)

- `apps/opencode_fork/packages/opencode/src/config/paths.ts:23-40` always includes `Global.Path.config` in config directories, even with project config disabled.
- `apps/opencode_fork/packages/opencode/src/config/config.ts:606-629` unconditionally schedules `npmSvc.install(dir, {add: [{name: '@opencode-ai/plugin', ...}]})` for those directories.
- `apps/opencode_fork/packages/core/src/npm.ts:137-150` skips only non-writable directories; a fresh writable synthetic config with no `node_modules` reaches `reify`. Lines 78-106 call `@npmcli/arborist`'s `reify`, and `npm-config.ts:15-29` loads ordinary npm configuration. The newly allowlisted runtime does not supply an offline dependency fixture or offline npm configuration.
- Separately, `apps/api_server/src/server.ts:560` calls `ensureRequiredPlugins`; `opencode_plugin_config.ts:26-29,127-138` registers npm `opencode-openai-codex-auth` and `opencode-gemini-auth`. Engine `plugin/index.ts:163-170` loads configured plugins; `plugin/loader.ts:77-82` resolves/install-targets. Glob of `apps/opencode_fork/node_modules/**/opencode-openai-codex-auth/package.json` returned no files. No personal npm/plugin cache was inspected or copied.
- The approved `--skip-install` build switch does not control these runtime paths. Starting now would violate the no-install/no-external-network boundary. Did not add production opt-outs, mock dependency loaders, enable pure mode to remove plugins, or attempt network and call its failure a PASS. Resume prerequisite: provide/approve a credential-free offline runtime dependency fixture (including required plugin resolution), or explicitly approve a launch-only resolution that preserves the requested engine behavior.

### Sandbox evidence / remaining verification

- No application fixture or unique `/private/tmp` runtime root generated; only bootstrap `TemporaryDirectory` guard scratch, automatically removed. No `up/status/down`, build, API/engine/Electron process, external request/install, real Keychain command, live DB/config read, or port probe executed. Teardown is not applicable: no owned runtime exists. This is not a lifecycle PASS.
- not_tested: synthetic admin/member/workspace/session generator; recursive/symlink/read-only config and usable MCP; actual env allowlist and Keychain resolution after API startup; non-owner UID guard; occupied-port/owned teardown regressions; web manifest/discovery/phase8/HTTP/WS/SW/redirect/popup/frame/typecheck/build/tests; Electron integration flag isolation; dedicated-account real Keychain; normal packaged lifecycle; Apple Silicon/Intel qualification. c1–c6 remain incomplete, no manual waiver.
- GitNexus `detect_changes(scope=all, base_ref=0bc46a5ece1a937c484c0054493c75b0299eafef, worktree=/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement, repo=Rhythm)` → LOW, 5 documentation symbols, 0 affected processes. Includes parallel current-plan docs not edited here. Shell/untracked-test absence from graph is not a runtime validation claim.
- `git diff --check` → exit 0. Tracked owned numstat at review: launcher +61/-10; testing-guide +14/-0. Parallel current-plan +2/-0 excluded from ownership. Final exact untracked counts collected after this handoff text below.
- Final `git diff --no-index --numstat /dev/null <owned path>`: guard +94/-0, contract +59/-0, run +100/-0 before this line (+101/-0 including it); exit 1 means differences. Final detect_changes repeated the same LOW / five doc symbols / zero processes result. Handoff: **BLOCKED**, not READY_FOR_VERIFICATION.
