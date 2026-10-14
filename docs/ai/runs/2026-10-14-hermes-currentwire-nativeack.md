---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES]
status: READY_CURRENT_NATIVE_ACK
tags: [run, rhythm]
---

## Files / approved scope

Explicit parent specialist handoff; acceptance-contract loaded first, coding-agent
second. Only hermes_coordinator_notify_live.test.ts, hermes_cli_fixture_test.py
(bootstrap imports only) and this run authored; existing
CLI/native ACK tools exercised; test bootstrap import repair within existing test
scope only (no CLI core). Parent explicitly authorizes correction
of the obsolete HTTP internal-label expectation, with stronger public/internal
separation. No source routes/notifier/delegation/MCP/native/client/schema/CLI core,
release edits, peer5198, live4001/4096/App/Pi, external providers/services, shared
dependency installs, packaging/signing/deploy/install/restart, commit/push or
destructive cleanup. Restart ASK remains unapproved. Existing dirty files retained.
Read AGENTS, project-state/current-plan, regression registry, v2-wire,
nativebirth-count and nativebirth-current-ack runs. HEAD c74f4392a6df61979fbe33e620a0077ebb6e0b4b.

## Phase 0 — acceptance / RED before edit

Named existing live check: owned live API withholds coding completion and returns
exact child card after real engine idle. Fixed mandate: public progress has exact
canonical text, exact11 pinned V2 keys, no internal label/engineRequestID; actual
pinned consumer validates HTTP events; SAME eventId retains internal progress,
pending state and manual-verification label in fixture DB. No-completion and later
child/error/card/raw-prose/stable-ID assertions remain intact. Existing current-ACK
check must execute real Bridge -> SSE -> NativeAdapter -> native worker/journal/save
-> unobscured Chromium receipt -> HTTP ACK, with denial/reopen/foreign controls.
Parent independently verifies using read-only source and disposable writable fixtures.

4998 canonical sandbox up/status: strict API build PASS; MCP normal noCheck build
PASS (not strict MCP or engine-action proof). API/gateway10514, engine10629.
Before ANY test edit, existing two live tests: **1 FAIL / 1 PASS**,949ms. Notify
line75 expected false to be true for internal verification-pending label; line74
no-completion passed; later assertions not reached. Revocation all5 canonical
UNKNOWN/list/SSE/ACK404/journal-unchanged PASS. This retains earlier owner's RED.
Sandbox left owned/running for corrected test, no overlapping4898 phase.

## Phase 1 — bounded impact

GitNexus impact(test file, upstream, repo Rhythm, includeTests true): target not
found, risk UNKNOWN. No HIGH/LOW or graph-coverage claim. Entire test, actual
route/service, pinned validator, existing CLI/current-ACK pipeline inspected.
Only Vitest invokes the changed test callback. Risk: accepting generic progress
without semantic qualification could hide success inflation; mitigate SAME eventId
read-only outbox check and unchanged no-completion/source regression assertions.
Exact key checks and original pinned validator prevent schema relaxation. No source
authority expansion. Source SHA2563f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7;
route129a4f31283b06e18ea2b5ff8197fa0f050fcf6eac069e6f84cc3e79ec3dfaf9;
delegation871070c91dd646063e46600286ee3b33deb4b55d522ab9875f384b5214a047b7.

## Commands / checks

All commands from shipping worktree. Canonical4998 environment:
```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-coordinator-notify-20261014-fixture
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/coordinator-opencode.json"
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox
export RHYTHM_SANDBOX_API_PORT=4998 RHYTHM_SANDBOX_ENGINE_PORT=4997 RHYTHM_SANDBOX_GATEWAY_PORT=4999
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export RHYTHM_SANDBOX_NODE_BIN="$PWD/tools/dev/.hermes-shipping-runtime/node/bin/node"
export RHYTHM_SANDBOX_ENGINE_DIR="$PWD/tools/dev/.hermes-shipping-runtime" RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1
export OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
bash tools/dev/sandbox.sh up && bash tools/dev/sandbox.sh status
env -i PATH="$PWD/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME="$RHYTHM_SANDBOX_DIR/home" TMPDIR="$RHYTHM_SANDBOX_DIR/tmp" DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_LIVE_E2E=1 RHYTHM_SANDBOX_DIR="$RHYTHM_SANDBOX_DIR" RHYTHM_APPROVED_FIXTURE_ROOT="$RHYTHM_APPROVED_FIXTURE_ROOT" RHYTHM_LIVE_DB_PATH="$RHYTHM_LIVE_DB_PATH" RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_SANDBOX_OPENCODE_CONFIG" "$RHYTHM_SANDBOX_NODE_BIN" apps/api_server/node_modules/vitest/vitest.mjs run --root apps/api_server src/__tests__/hermes_coordinator_notify_live.test.ts src/__tests__/hermes_coordinator_revocation_live.test.ts --no-file-parallelism
```
Both phase fixtures DB/config stat400 before run. No fixture credential contents
read/output. Private prebuilt engine reused as assigned; source engine unedited.

## Phase 2 / handoff

### Repairs / actual 4998 GREEN

Two bounded repair changes total; no production repair. First attempt at corrected
live tests in a separate tool shell returned ECONNREFUSED4998/4997 (both processes
no longer listening); pinned test behind && was NOT run. Stock status confirmed no
listeners, stock down preserved `.evidence.WvTplh`. Full lifecycle then caught
TS1343: import.meta invalid under existing CommonJS build; corrected test helper
path to existing __dirname/resolve, no compiler/config changes. Failed-build stock
down preserved `.evidence.dNl7Bi` and `.evidence.RGj7oA`.

Canonical up/status with unchanged environment above, then same live command:
strict API build PASS, normal MCP noCheck build PASS. API/gateway35100,engine35223.
**2 live PASS**,1.46s: pending public progress canonical label plus exact11 keys,
actual pinned validation, SAME eventId internal progress/pending/unverified label;
later child failure, exact card ID, no RAW prose, stable event IDs all reached/PASS.
All5 original live revocations retained/PASS. Then before down:
`RHYTHM_LIVE_E2E=1 "$RHYTHM_SANDBOX_NODE_BIN" --test tools/dev/hermes_v2_wire_acceptance.mjs`
**1 PASS**,320ms; all5 kinds, exact V1/V2 GET=SSE, unchanged source rows,
question/card references, owner/list/ACK controls. Receipt SHA256
3cc871f5310bb86483c857cb16dd9323ec92ad4606a3d050527ae8fc422456dd.
`bash tools/dev/sandbox.sh down` exit0, `.evidence.ofqJ1d`. Only after down did4898
start; peer5198 untouched. No false live PASS from skipped suite.

### Actual 4898 current-native ACK

Exact lifecycle (ran twice; down executed regardless of test result):
```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-event-notify-20261012-fixture
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/notifier-opencode.json"
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-shipping-rollout-20261014-sandbox
export RHYTHM_SANDBOX_API_PORT=4898 RHYTHM_SANDBOX_ENGINE_PORT=4897 RHYTHM_SANDBOX_GATEWAY_PORT=4899
export RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 RHYTHM_SANDBOX_BRIDGE_REGISTRAR_FILE="$RHYTHM_APPROVED_FIXTURE_ROOT/hermes-cli-synthetic-registrar.txt"
export RHYTHM_SANDBOX_NODE_BIN="$PWD/tools/dev/.hermes-shipping-runtime/node/bin/node"
export RHYTHM_SANDBOX_ENGINE_DIR="$PWD/tools/dev/.hermes-shipping-runtime" RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
bash tools/dev/hermes_shipping_checks.sh up && bash tools/dev/hermes_shipping_checks.sh status && env RHYTHM_LIVE_E2E=1 HERMES_CURRENT_ACK=1 python3 -B tools/dev/hermes_cli_fixture_test.py
result=$?; bash tools/dev/hermes_shipping_checks.sh down; exit "$result"
```

Attempt1: API/gateway39150,engine39273; official registrar/auth/grant/role/roster
four negative controls PASS0effects; CLI1 PASS0.403s; native current-binding PASS.
Actual V2 exact11 fields now accepted; actual source page progress/progress/error.
Real SSE receive launched native worker, but render metadata timed out. Retained
`/private/tmp/hermes-cli-owned-11td3nc5/native.log`56–63 proves fixture Agent
NameError `os` in run_conversation. Imported PROVIDER string depends on caller
globals os/json; neither was in subprocess bootstrap. Not a native/source defect.
GitNexus impact(run,file=tools/dev/hermes_cli_fixture_test.py,upstream,tests):
not found/risk UNKNOWN. Entire file/provider string and call site reviewed. Second
bounded repair adds json/os imports ONLY to existing test subprocess bootstrap.
No provider/receiver/worker/schema/CLI core edits, no fault injection or assertions
removed. Down exit0, `.evidence.TApQab`. First failed fixture retained.

Attempt2: API/gateway47288,engine47412. Build PASS; four denials again PASS0effects;
CLI1 PASS0.370s; actual Native.current_binding PASS default/owner1. New supported
HTTP birth+rename SID0ab8e6d7a131 with durable messages[] before SSE, no provider
effects. Source run380c744c-6a3a-4e30-9647-64575c8858da, local engine child
6fae7ae1-4f79-4cd5-9b6a-7d6cf922450b. Selected actual first progress event
1f5d5f22-8352-48b7-96ef-ab664ed655fe (`Rhythm session linked.`).

**currentShippingACK PASS / exit0**. Real SSE -> original strict Subscriber /
NativeAdapter -> actual receive/worker/journal/save -> actual Chromium native boot
and session load -> unobscured render receipt200 -> actual scoped source HTTP ACK.
Native reply DOM732x24.5/unobscuredtrue; qualified browser receipts1; wrong chat
and obscuration emit0; actual receiver nonce64; wrong nonce404. Browser sends no
Authorization; normal native browser gate/onboarding path unchanged, no added
token/API configuration or cookie-auth bypass. Fixture startup is default
password-unset loopback mode, NOT a qualification of password-enabled login.
Wrong owner401, adapter wrong run/chat denied; wrong-run source ACK404 leaves local
visible1; consumer close/reopen correct ACK -> tombstone2. Source read-only SQL
asserts exact selected event state visible; same-owner/run/event receipt identity
unchanged; replay/reopen no second provider; foreign source rows/native bytes
unchanged. Actual native provider calls1, preSSE0. No fake DB ACK callbacks.

Count qualification: source page has THREE unique events (progress/progress/error),
but existing harness deliberately selects/delivers only FIRST progress via SSE.
deliveredUniqueEvents1/provider1/visible receipt1/ACK1 refer to THAT selected event,
not the entire page. Other two remain foreign untouched by this check. No claim
all3 drained, aggregate1, source model success, or MCP engine action success.
Source synthetic-no-provider error is meaningful delivery evidence, NOT successful
LLM execution; proof explicitly sourceLLMSuccessfalse. No unknown opaque-ID authority.

Down exit0; `.evidence.qxyrNf`; owned native process terminated in finally. Retained
sanitized fixture `/private/tmp/hermes-cli-owned-ktggygiv`, current-ack-proof.json
SHA2560d821802645ea6715471306dc21c9a256184164cf8dadaac8b20b22e331b31f3;
current-shipping-native-ack.png SHA256410e6d1550003156b6a3cfd3e558d8f6ef97d12ef5dd5a2b972c221e83b5d35c.
Screenshot inspected: only disposable fixture title, linked label and fixture reply,
default profile, no live data or credentials. Evidence not destructively cleaned.

### Regression commands / actual results

From apps/api_server:
```sh
env -i PATH="$PWD/../../tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp TMPDIR=/private/tmp DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow ./node_modules/.bin/vitest run src/__tests__/hermes_wire_projection.test.ts src/__tests__/hermes_coordinator_notify_contract.test.ts src/__tests__/hermes_coordinator_notify_boundaries.test.ts src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_approvals.test.ts src/__tests__/coordinator_conversation_repository.test.ts src/__tests__/coordinator_workflow_runs.test.ts src/__tests__/hermes_coordinator_notify_revocation.test.ts --no-file-parallelism
```
**48 PASS**,8 files,11.88s = original43 untouched + wire5; internal unverified-label
and engineRequestID assertions unchanged. No source auth/reference-value weakening.
Independent300 source-owner gate is retained prior evidence, not newly claimed here.

From shipping root:
```sh
RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_http.py && RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_birth.py && python3 -B tools/dev/test_provision_contract.py && python3 -B tools/dev/test_provision_bridge_contract.py && python3 -B tools/dev/test_provision_transport_boundaries.py && git diff --check
```
All exit0: nativeHTTP1 PASS1.532s, birth2 PASS1.535s, helper16 PASS0.145s,
bridge1 PASS0.523s, boundary3 PASS0.154s. **107 core pins +7 outputs verified**;
union copy count110 is overlapping paths, NOT a weakening of107+7. Manifest
997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0 unchanged.
Both canonical DB/config pairs still0400 after runs. Whitespace PASS.

### Identity / final bounded handoff

SHA256 before/after source service3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7,
route129a4f31283b06e18ea2b5ff8197fa0f050fcf6eac069e6f84cc3e79ec3dfaf9,
delegation871070c91dd646063e46600286ee3b33deb4b55d522ab9875f384b5214a047b7 unchanged.
CLI core7102284df56b8a0b4a62d45b6d1018f94761da2f8958d93b2e006dc2c9e11ebf unchanged.
Existing ACK Python84258a1e68dbb5d43497ff529392e5cc79b54404a61d8467c6b04370502cd718 /
DOMd42ba80ea83be0a9731cd8b1005a70a7578c9c7c9f2c2a7eba4b1ff82582670f unchanged.
Authored test final699f0c8e26947685f6f82aa3ff66b5768d35cb2836b0217e0f4d69c7378a9ea7;
CLI fixture after bootstrap imports f0b6745d78434e2102884d4dad6094eea5b7b072b1a939ca36cffae4d65d176e
(before9ff91d1bd5e4b4bcdc48336660361511e0e080795c44f082dd878d91967c380c).
Compiled routera8e78a3d2d1ad8ab6af88578fddfdf465341e9e821cdb3853e2197ab25330543,
service0b4e898f9569cab6f58629be10c915daad48a7d38036b8ce52b612aae0ec05c4,
delegation8d60587a2ab20c94eae8c207a1fc9cd2e8896b6f22070d78cccc269994253e3b match prior wire run.
Private prebuilt engined60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072
reused, not rebuilt/edited. MCP source never authored here; peer active, no false
MCP hash-freeze claim. Only stock canonical builds generated shared build outputs.

**READY_CURRENT_NATIVE_ACK / READY_FOR_VERIFICATION for assigned selected-event
pipeline and stronger wire live test.** Parent independent verifier can rerun exact
commands above against read-only source with disposable fixtures; no independent
verification claimed here. Approved scope/exclusions/resolutions durable above;
do not re-request unchanged scope. Final peer/MCP action gate and post-freeze CI
remain parent-owned. Release artifacts **STALE**; no packaging/sign/install/deploy,
live restart or production activation authorized/performed. No commit/push.
