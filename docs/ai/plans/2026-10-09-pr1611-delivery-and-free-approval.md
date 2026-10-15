---
date: 2026-10-09
status: plan-only (nothing built, installed, activated, committed or deleted)
tags: [plan, rhythm]
---

# PR #1611 delivery prerequisites + Free Mode approval handoff

## Current evidence boundary

Sandbox evidence only: worktree HEAD 03aad82d (local, unpushed; PR head 73230a31) + 97 dirty paths;
API dist 28b59464 (production modules), engine c4912cdb built `--skip-embed-web-ui`, sandbox node via
grid-node wrapper, synthetic DB/fixtures, fake loopback providers behind the test transport guard.
NOT proven: packaged app (embedded web UI, signed engine, bundled Resources/node), installed launch,
live 4001/4096 behavior, phone pairing against the new build. Live host = signed 73230a31.

## Update 2026-10-09 r11

Current sandbox-qualified build: API dist 1664 modules 8a9d22c9 (Free F1/F2-partial/F3-gate, disabled by default),
engine c4912cdb, tree HEAD 03aad82d + 105 dirty paths. Reruns on this build: grid 13/13, scheduled+Memory 7/1 skip
(incl. A4), shadow R2/R3/R5. Dayflow live cases last passed on the r6 build: rerun before freeze. Free must ship
disabled; F2 automatic drain and F3 verifiers are not implemented (see free-mode-drain-verifier-design.md).

## Exact final-source inputs (to freeze before any build)

- 42 modified + 30 new under apps/api_server/src; 2 modified apps/api_server/opencode_plugins;
  apps/opencode_fork/packages/opencode/src/plugin/codex-accounts.ts (+ new test); tools/dev/sandbox.sh
  (+ new test script); docs/ai (2 modified, 18 new). apps/electron, apps/mobile, apps/web unchanged.
- Additive migrations only: table `agent_router_grid_attempts` + nullable `agent_sessions.router_variant`
  (SQLite migrations.ts and postgres_bootstrap.ts). Rollback leaves them unused; no data loss.
- Mobile: MOBILE_GATEWAY_COMPATIBILITY fingerprint dbe19d8f unchanged in source; must be re-verified on the
  artifact (health) and with the mobile/pairing/relay/gateway server suites (39 files at 73230a31).
- Free F1-F3 is HOLD: either deliver with Free config-only/disabled (no runtime caller exists) or wait.
- Before freeze, add ONE exact artifact-qualification root to grid_transport_guard.cjs ROOTS and the
  Dayflow live test SANDBOX list (test-only; e.g. /private/tmp/sdmr-grid-sandbox-artifact) so qualification
  needs no post-freeze edit.

## Build recipe (copy of the 73230a31 pipeline; needs AJ approval)

Fresh output dir only, e.g. ~/Documents/Codex/2026-10-09/signed-desktop-build-1611-<sha8>/ (never reuse or
delete the 73230a31 or 237f54db trees). Clean clone at the frozen commit -> npm ci (electron, web,
api_server, mcp_server) -> bun install (fork) -> clean-status check -> `node scripts/package-mac.mjs`
(cached models-api.json input, public OAuth client id from the existing app build-config, node headers
22.23.0, isolated npm/XDG caches, no private env) -> `scripts/sign-and-notarize-mac.mjs` with
RHYTHM_SIGN_ONLY=1 -> ditto to signed-apps/<sha8> -> codesign --verify --deep --strict, engine --version,
Developer ID authority. Protected operation: Developer ID 56Q69NYP9H signing uses the login Keychain
private key (may prompt); not notarized (same as 237f54db/73230a31).

## Artifact qualification (isolated, before any activation)

1. Hash: packaged Resources/api_server/dist and mcp_server/dist module digests == snapshot dist digests.
2. Stage a copy of the packaged signed Resources/opencode_bin/opencode at
   <fresh>/dist/opencode-darwin-arm64/bin/opencode; run `<snapshot>/tools/dev/sandbox.sh up` with
   RHYTHM_SANDBOX_ENGINE_DIR=<fresh>, RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1, the new exact root, explicit ports
   4398/4397/4399, approved fixture copies, the retargeted runtime OS profile, the live Electron env pair
   (RHYTHM_WORKSTREAMS_ENABLED=true, RHYTHM_MANAGED_CONTEXT_EXPORTS=1) and the grid preload.
3. Run on that runtime: grid 13, Dayflow live cases, scheduled+Memory (7 + S3 skip), shadow R2/R3/R5,
   mobile/pairing suites; same preserving runners; record attestation and hashes.

## Activation window (external owner only)

- AJ runs a swap script modeled on ~/Documents/Codex/2026-10-08/swap-to-1611-desktop.sh with NEW set to
  the new candidate. It quits the running app (osascript), so every in-flight session ends, including any
  Rhythm-hosted agent; it must never be run from inside Rhythm. Choose a quiet window with no scheduled
  task due; leave routing off.
- Rollback: the existing swap-to-1611-desktop.sh re-points to signed 73230a31 (retain that app).
- Before: preserve a copy of the live DB and decision-router.json. After: health only on 4001/4002/4096,
  loaded engine/app path == candidate, phone fingerprint dbe19d8f, env pair present on the API process
  (otherwise Dayflow-consented turns hold), routing still off, no scheduled task replay.

## Free Mode approval handoff (HOLD; quoting plans/2026-10-08-model-router-grid.md, no execution)

Source: router_free_policy.ts, router_free_state.ts, router_free_config.ts exist (units only, no caller).
Affected symbols if approved: routeGridTurn (router_grid_turn.ts) result contract (new queued outcome);
RouteTurnForSessionResult (turn_routing.ts); callers ws_gateway.ts handleInputFrame (~L633 via
routeTurnForSession), agent_runner.ts (~L1240 routeGridTurn), mobile_prompt_routing.ts (L74);
agentSchedulerService run status; RouterFreeStateStore persistence (fsync+renameSync); usage-refresh /
exhaustion-expiry trigger for drain.
Stages: F1 hold/queue only (no free model call, privacy preflight first, durable body-free descriptor,
all three callers do not dispatch, budget0); F2 drain T1-first on fresh positive capacity with owner/consent/
cancel recheck, never replay partial turns; F3 verifier interface, free execution stays disabled.
Risk: HIGH (manual; GitNexus does not index routeGridTurn): a wrong active decision would hold every
prompt on desktop, scheduled and mobile. Mitigations: disabled by default, F1 never calls a free model,
unit no-dispatch contracts per caller, synthetic loopback proof (recipe in the grid plan), owner review.
Approval needed once: AJ authorizes F1 (and separately F2/F3) source changes on those three dispatch paths.

## Delivery handoff r16 (read-only; nothing built, signed, installed, pushed or activated)

**Shipping client - two different answers, both must be stated.** Repo-declared shipping desktop client is Flutter
(`apps/desktop_flutter`; AGENTS.md, architecture.md, electron_release.yml header: Electron is the parity/prototype
channel). The client actually running on AJ's host is the Electron-packaged signed `Rhythm.app` 73230a31 (parent of live
API PID 26531, launched by `~/Desktop/Open Rhythm (patched engine).command`). Which client the 10-15 church-staff users run
is not determinable from the repo. Qualifying an Electron artifact does NOT qualify a Flutter release; each needs its own
build and checks.

**Frozen source closure (to create only after approval).** Worktree `model-router-grid-20261008`, branch
`fix/scheduled-dayflow-memory-router-20261008`: HEAD 03aad82d (local, unpushed; 1 commit on top of PR head 73230a31,
which it descends from) + 119 uncommitted paths. PR #1611 (draft, base `mega/2026-09-29-consolidation`) still points at
73230a31. Freeze = commit the reviewed tree, push to the PR branch, update the PR; no main merge. Production identity to
freeze: API dist ed653651 (1674 modules), engine c4912cdb (0.0.0-rhythm-pinfix-d77042e8110e; rebuild from the frozen
fork source in the packaging pipeline, do not reuse the sandbox binary). Additive migrations only:
agent_router_grid_attempts, agent_sessions.router_variant, agent_held_turns, agent_free_opt_ins (SQLite + Postgres
bootstrap). Free ships disabled: no `router-grid.json` override, no `router-free-extraction.json` operator file.

**Electron build (matches the running client).** Option A (local, same as 73230a31): clean clone at the frozen sha into
a NEW dir `~/Documents/Codex/2026-10-09/signed-desktop-build-1611-<sha8>/`; `npm ci` in apps/electron, apps/web,
apps/api_server, apps/mcp_server; `bun install` in apps/opencode_fork; clean-status check; `node scripts/package-mac.mjs`
(isolated npm/XDG caches, cached models-api.json, public OAuth client id from the existing app build-config, node headers
22.23.0, no private env); `RHYTHM_SIGN_ONLY=1 node scripts/sign-and-notarize-mac.mjs`; ditto to signed-apps/<sha8>;
`codesign --verify --deep --strict`, engine `--version`, Developer ID authority. Prerequisites: network to the npm registry
and bun registry; login Keychain access to Developer ID 56Q69NYP9H private key (may prompt; AJ present); not notarized.
Option B (CI): `electron_release.yml` workflow_dispatch (repo secrets APPLE_*, GOOGLE_DESKTOP_CLIENT_ID; signed +
notarized GitHub release) - needs AJ to trigger and choose prerelease. Deletion prerequisites: none; never delete the
73230a31 or 237f54db apps (rollback targets).
**Flutter build (repo-declared shipping client).** `desktop_release.yml` workflow_dispatch (Apple + Google + PCO
secrets). Before freeze: `dart format . --set-exit-if-changed` and `flutter analyze --no-fatal-infos` (no Flutter files
changed on this branch), and a Flutter-bundled-server qualification; none of the sandbox evidence covers the Flutter
package.

**Artifact qualification before activation (isolated).** Packaged Resources/api_server/dist and mcp_server/dist module
digests == frozen dist; stage a copy of the packaged engine under a fresh dir and run `tools/dev/sandbox.sh up` with
RHYTHM_SANDBOX_ENGINE_DIR + SKIP_ENGINE_BUILD, a new exact sandbox root (add to grid_transport_guard ROOTS and the Dayflow
test list BEFORE freeze), approved fixture copy, retargeted runtime OS profile, live Electron env pair; rerun grid 13,
combined scheduled+Memory (7 + S3 skip), Dayflow cases, shadow R2/R3/R5, Free drain/F1F2/F3-API, mobile/pairing server
suites (39 files at 73230a31); attest descendants.

**Activation (external owner, quiet window).** AJ only, never from inside Rhythm (the swap quits the app and ends all
in-flight sessions, including Rhythm-hosted agents). Before: copy live DB and decision-router.json; confirm no scheduled
task due; routing off. Run a swap script modeled on `~/Documents/Codex/2026-10-08/swap-to-1611-desktop.sh` with NEW = the
new signed app. Rollback: the existing swap script back to 73230a31. After (read-only checks): 4001/4002/4096 health;
engine binary path == candidate; phone contract fingerprint dbe19d8f; API process has RHYTHM_WORKSTREAMS_ENABLED=true and
RHYTHM_MANAGED_CONTEXT_EXPORTS=1 (else Dayflow-consented turns hold); routing off; free_mode disabled; no scheduled replay;
new tables present and empty. Hosted Synology API deploy (api_deploy_synology.yml) is a separate gate and not part of
this desktop delivery.

## Update r18 (2026-10-10)

Current production build identity: API dist 1677 modules 131f873c, engine c4912cdb, HEAD 03aad82d + 122 dirty
paths. Original Free addendum 13 cases mapped PASS (positive coding/knowledge/image through authenticated API + local fake
provider; deterministic cases unit/live); units 352/352. Native engine transport is NOT a gate. Before freeze, rerun only
source-affected final regressions as required by policy (grid13 and combined scheduled+Memory last passed on ed653651;
r18 changes are isolated to agent-free API/executors/config parser and fake provider, not shared dispatch). Packaging,
signing, Flutter/ Electron artifact qualification and external activation steps remain unchanged below.

## Flutter package qualification action-time review (r20; HOLD - no package built)

Closure candidate: branch `fix/scheduled-dayflow-memory-router-20261008`, HEAD 03aad82d (local) vs origin/PR head
73230a31, base mega edb7158c; draft PR #1611 is OPEN/MERGEABLE, owned by AJ, checks green only for 73230a31. Authenticated
gh account `ajhochy` has repo/workflow scopes, but this run has NO authority to stage/commit/push/update PR yet.
122 dirty paths inventoried; 0 Flutter/Electron/mobile/web paths. All map to original Router/Free (incl. shared API
integration/migrations/routes), Memory be4164f1, Dayflow, native account pin, sandbox safety, or canonical evidence.
No unrelated product change identified. Final per-path SHA/status/provenance manifest is external (reported in r20 ledger).

Read-only stock release inspection found unavoidable operations incompatible with the current absolute no-deletion boundary:
- desktop_release.yml: `flutter pub get` (network/cache + creates `.dart_tool`), `flutter clean` (deletes build), xcodebuild
  rewrites DerivedData; `npm install`, `npm prune`, nested installs mutate/remove node_modules; better-sqlite prebuild
  `find ... -delete`; bun install/build replaces dist; smoke `rm -rf` temp HOME/DB and sends TERM/KILL; package_macos.sh
  deletes existing dist zip/dmg and hdiutil `-ov` replaces DMG.
- signing: creates/deletes a Keychain + temp certs, changes the user's keychain search list, force-codesigns app/binaries,
  overwrites DMG, uses timestamp/notary network, deletes temp material. Needs Apple secrets/Keychain authority.
- shipped Flutter app always uses :4001 and its API startup can manage :4001; api_server default engine is 4096. Therefore
  NEVER launch the packaged app for qualification while this host/session lives. Package payload must be attached to
  `tools/dev/sandbox.sh` using a staged copy of bundled server/engine and explicit 4398/4397/4399; no app launch.

Safe preserving recipe AFTER action-time approval of generated-output deletion/replacement:
1. Freeze reviewed commit/push to PR (no main merge); fresh checkout/copy, fresh output root retained forever.
2. Exact CI versions: Flutter 3.44.9, Node 24.18.1, current lockfiles. Approve network/cache writes and disposable cleanup
   ONLY inside the fresh checkout/output and isolated package-smoke roots; never existing worktree/builds/caches/evidence.
3. Run `flutter pub get`; then read-only checks `dart format --output=none --set-exit-if-changed .`,
   `flutter analyze --no-fatal-infos --no-pub`, `flutter test` (tests themselves delete generated temp dirs, must be covered).
4. Build unsigned universal app without `flutter clean`: fresh checkout means no build output; `flutter build ... --config-only`,
   xcodebuild DerivedData under the fresh output. Bundle API/MCP/Node/fork exactly as desktop_release.yml, but replace each
   destructive stock command with a preserving equivalent (copy platform-specific artifacts into a new tree, never prune
   or delete; package to new filenames, no `-ov`). Verify payload/OAuth/entitlements and SHA closure.
5. Do NOT run stock package smoke (starts bare API on 4002 with default engine 4096). Instead stage a copy of bundled
   Resources/api_server and opencode_bin and launch only through sandbox.sh with API 4398/engine 4397/gateway 4399,
   fixture DB/HOME/vault, guard preload and attestation. Run packaged grid13, combined scheduled+Memory, Dayflow,
   shadow, Free and mobile-server tests; preserve outputs.
6. Signing/notarization requires separate approval for Keychain/security modifications, Apple network and generated temp
   deletion. Activation remains external AJ quiet-window action, never from this agent session.

Attempted safe Flutter checks in current worktree under strict no-unlink guard:
- format (`dart format . --output=none --set-exit-if-changed`): exit 1, no source changes; `.dart_tool/package_config.json`
  absent so flutter_lints URI unresolved; output listed 418 would-change files (log dec669a9).
- analyze (`flutter analyze --no-fatal-infos --no-pub`): exit 1; packages unresolved for same missing package config
  (log a7d7eaf3). Running pub get is the required next step but needs the action-time network/generated-state approval.
Flutter tree remained exactly clean before/after.

## r22 lock repair + supported CI build route (2026-10-10)

Narrow source fix applied (no symbols): `apps/desktop_flutter/pubspec.lock` only, meta 1.17.0/old SHA -> 1.18.0/
174198..., test_api 0.7.10/old SHA -> 0.7.11/949a93...; exact 4 deletions/4 additions, diff-check clean.
Original lock fcbd5ca and exact patch ca47c90f retained under qualification root/lock-repair. Dependency impact:
Flutter/Dart analyzer/test tooling transitive APIs only; no direct app dependency or runtime source change.
Flutter 3.44.9 after fix: `dart pub get --enforce-lockfile` PASS; format 527/0 PASS; analyze PASS (319 infos);
flutter test **1356/1356 PASS**. Updated lock SHA a324151a.

Local unsigned package remains blocked before compilation by nested Xcode sandbox (all retries/receipts retained; no
identical retry after audit169). Existing `desktop_release.yml` is NOT a signing-disabled qualification route: job-level
Apple/Google/PCO secrets are injected automatically, signing runs when secrets exist, package_macos deletes/overwrites in
workspace, and workflow publishes a release. Do not dispatch it for qualification.

Smallest supported GitHub ephemeral-runner route (proposal only; requires separate PR publication review): add
`.github/workflows/desktop_qualification.yml`, `workflow_dispatch`, checkout selected ref, Flutter 3.44.9 + Node 24.18.1,
NO repository secret environment, synthetic OAuth client id, no .env production secrets, format/analyze/test, API/MCP/fork
build, unsigned xcodebuild + bundle, package to unique names, verify payload, upload Actions artifact only. Omit sign/notary,
GitHub release, tags, deploy and activation. Ephemeral workspace may use stock clean/prune/delete; it cannot touch host
worktrees/evidence. After artifact download, qualify extracted bundled servers via the retained sandbox attachment recipe
4398/4397/4399; never launch Rhythm.app on this host. Publication/dispatch are not authorized in this run.

## r23 ELECTRON EXCLUSIVE target (AJ 2026-10-10 02:35-02:36Z; supersedes ALL Flutter delivery sections)

AJ abandoned Flutter and uses Electron exclusively. Stop every Flutter build/CI/validation/package gate. The already-applied
Flutter lock-only change (meta 1.18.0/test_api 0.7.11, exact diff ca47c90f) remains retained in the worktree/evidence but is
EXCLUDED from any PR publication closure; no further Flutter commit/push/validation. Retain the 2.6G failed qualification
root and all logs; do not delete.

**Verified actual target.** Running PID 26527 is
`.../signed-desktop-build-1611/signed-apps/73230a31/Rhythm.app/Contents/MacOS/Rhythm`; child API PID 26531 uses bundled
Resources/node + Resources/api_server/dist/server.js on 4001/4002; engine PID 26567 uses bundled
Resources/opencode_bin/opencode on 4096. Bundle: Electron Framework + Electron helpers, no Flutter framework; id
com.rhythm.desktop, version/build 0.1.0; Developer ID Aaron Hochhalter/56Q69NYP9H, timestamp 2026-10-08 19:53:50,
`codesign --verify --deep --strict` PASS. This installed 73230a31 artifact is context/rollback only, not proof of the dirty
closure.

**Retained Electron qualification root:** `/private/tmp/rhythm-electron-qual-r23-9b4a197c` (1.1G), exact r22 closure
copy (123 paths, including quarantined Flutter lock), Node 22.23.0, Electron 40.10.2, isolated npm/electron caches,
output/testtemp/logs; guard denies original worktree, prior sandboxes/evidence, Codex writes and live app data. No app
launch/host restart. Results: electron npm ci PASS; typecheck PASS; first full tests 537/560 (17 fail: missing web dist +
nested Chromium sandbox); web npm ci/build PASS (1781 modules, 2.8M); rerun **549 pass / 5 fail / 6 skip**. Remaining 5
are the actual-Electron-launch tests only and fail `sandbox initialization failed: Operation not permitted`; do not disable
Chromium sandbox. All contract/VM/main/preload/Hermes tests pass.

**External immutable package inputs validated read-only from installed bundle against current source:** Hermes commit
13ade178 / Electron40 PASS; Colony commit 2bb12c46 / Electron40 / Node22.23.0 PASS; signed upstream Dayflow 2.6.0 build133
arm64 PASS. Copies + 647-file hash receipt retained under Electron root/input-artifacts (200M, receipt 44c04b1a). Current
bundle also has native-dayflow, but stock stageNativeDayflow requires the original signing-layout manifest/metadata; not
reconstructed or claimed.

**Why final Electron package is not built yet.** Stock `package-mac.mjs` first requires a clean
`apps/opencode_fork` and embeds `git rev-parse HEAD` into engine version; current closure has uncommitted pin repair. A
local index trick or patched check would falsely label source as 03aad82d. It also intentionally removes/rebuilds fresh
`dist` + fork dist, installs production deps, strips non-target prebuilds, hardens Electron fuses and ad-hoc signs helper/
app. Generated operations are safe only after an exact reviewed closure commit in the retained source. PR publication
remains separate authority; no blanket 122-path stage/push.

**Preserving package recipe after semantic review/publication authority:** create exact local closure commit (excluding
Flutter lock) in retained Electron root; install api_server/mcp_server/fork dependencies in root-scoped caches; build web,
API, MCP and fork; set public Google client id without logging; use validated copied Hermes/Colony/Dayflow.app inputs;
omit native-dayflow unless its immutable signing-layout inputs are supplied; run stock package in fresh dist (deletion only
inside root); do NOT sign/notarize/install/launch. Verify package tests + module-tree hashes. Extract copies of bundled
api_server/opencode_bin and attach through `tools/dev/sandbox.sh` on 4398/4397/4399 with fixture HOME/DB/config and guard;
never run Rhythm.app (hardcoded live 4001/default 4096). Rerun grid13, combined scheduled+Memory, Dayflow, shadow, Free,
mobile-server gates. Signing/activation remain separate.

