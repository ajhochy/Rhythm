---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES]
status: READY_OPERATOR_CLI_CODE
tags: [run, rhythm]
---

## Files / scope / approvals retained

Explicit parent specialist handoff; acceptance-contract loaded FIRST, coding-agent
SECOND. Read shipping AGENTS, project-state/current-plan, regression registry,
nativebirth/currentwire ACK records, complete provision helper and callers.
Only authored:
- tools/dev/hermes_fixture_provision.py
- tools/dev/test_provision_operator_mode.py (new)
- this dedicated run

Approved scope: explicit operator-owned SINGLE new fixture CLI mode, exact opted
source API http://127.0.0.1:4001, protected immutable approval/file references,
supported native new+rename birth, existing source/receiver authority and own-link
idempotent stop. Existing canonical API4898 mode remains default. Root may be an
existing trusted native STATE_DIR parent; no existing chat adoption, file-ownership,
mode, symlink or SQL/schema guards relaxed. Stop is offline and receipt-scoped.

Exclusions unchanged: no API/MCP/native product/validator/source-profile edits,
existing-test edits, credentials/new logins/new grants/registrar calls in operator
mode, profile takeover, provider/model mutations, handmade session/SQL chat writes,
live4001/4096/App/Pi/SSH/network relay, live secrets/config, external provider/tools,
cards/desktop approvals/email/drive/billing, dependencies, packaging/sign/release,
server update/restart/live activation, destructive cleanup, commit or push.
Parent owns git, final independent gate, numeric qualification version, notarization
and asking AJ BEFORE actual app/server update/restart. Scope approval is not host
permission. No peers dispatched or orchestrator invoked.

## Phase 0 — named acceptance RED before implementation

Command: `python3 -B tools/dev/test_provision_operator_mode.py`
Initial five frozen methods: exact_operator_dryrun,
reject_endpoints_before_secret_read, mode_conflict_and_manifest_guards,
canonical_default_unchanged, missing_runtime_reference_stops_locally.
Observed 5 tests / 13 failures (includes endpoint subtests), 1.529s:
`unrecognized arguments: --allow-private-relay`. Positive operator dryrun returned
2 rather than0; expected exact-relay/fileReference diagnostics absent. Canonical
default and fail-closed guard checks already passed: retained regression checks,
not claimed as new RED behavior. No waiver; helper implementation followed RED.

Supplemental requested stop criterion frozen BEFORE stop implementation:
`python3 -B tools/dev/test_provision_operator_mode.py OperatorMode.test_stop_only_owned_link_idempotent_preserves_foreign`
1 FAIL,0.098s: `unrecognized arguments: --stop-owned-fixture`.
Existing assertions were not edited to turn RED green. Two additional audit/override
qualification methods were appended (not retroactively claimed as RED).
Mandate: make these named checks pass without editing their assertions. Parent
independent verifier runs them against read-only source with disposable writable
fixtures; no independent verification claimed by this implementer.

## Phase 1 — bounded impact review

GitNexus upstream impact in indexed Rhythm for execute_fixture, plan, main,
create_native_fixture, api_call, _create_native_locked (file hint provision helper):
ALL target-not-found, risk UNKNOWN, NOT LOW or zero-dependency proof.
Whole own code surface/caller search reviewed. Direct callers:
- main -> plan / create_native_fixture / execute_fixture
- create_native_fixture -> _create_native_locked
- execute_fixture -> api_call (owner/catalog/projection/check/dispatch/events)
- test_provision_contract.py -> plan
- test_provision_native_http.py -> main via subprocess creation
- test_provision_native_birth.py -> create_native_fixture (create/repeat/partial)
- hermes_cli_fixture_test.py -> create_native_fixture then frozen execute CLI
- test_provision_execute_cli.py -> main via subprocess execution/repeat
- new operator contract -> main via subprocess and actual pinned receiver setup
Transport/bridge tests cover file/redirect/proxy/header/offline-module boundaries.

Consequential reviewed risks: source credentials sent to wrong origin; native4001
confusion; arbitrary private HTTP fallback; existing-chat adoption; public module
ownership; operator state outside disposable tmp; native JSON user vs source numeric
owner identity; partial receipts/link revocation. Mitigation: exact source literal
before secret reads, independent pinned native IPv4 loopback endpoint (never4001),
no redirects/environment proxy, strict manifest mode/ref/root/uid/mode/no-symlink
checks, birth approvalDigest and exact durable rename receipt, existing current
owner/catalog/projection/V2/native current-binding validators, qualified STOP for
unsupported profile/native auth, pinned two-module offline load unchanged, exact
own-link offline revoke with proof/foreign preservation and dedicated tests.
No HIGH/CRITICAL graph rating or renewed scope approval required; UNKNOWN reviewed
manually, not used to justify editing frozen source.

## CLI mode / immutable manifest / operator prerequisites

Select mode with BOTH `--allow-private-relay --api http://127.0.0.1:4001`.
Flag with4898 is a mode conflict. Without flag only exact canonical4898 accepted.
No DNS alias, IPv6, private subnet, alternate scheme/port, userinfo, path, query,
fragment or leading-zero port exception. Native endpoint must be exact approved
`http://127.0.0.1:<existing-native-port>` with no aliases/IPv6/path; ports4001,
4096,4897,4898,4899 remain forbidden. It is not the Rhythm relay.

Operator approval is an owned regular non-symlink600 JSON file:
```json
{
  "version": 2,
  "fixtureOnly": true,
  "executionMode": "operator-fixture",
  "fixtureRoot": "/ABS/APPROVED_NATIVE_STATE_PARENT",
  "stateDir": "/ABS/APPROVED_NATIVE_STATE_PARENT/EXISTING_STATE",
  "tokenFile": "/ABS/EXISTING_OWNER_BEARER_FILE",
  "bridgeCapabilityFile": "/ABS/EXISTING_RUNTIME_CAPABILITY_FILE",
  "nativeSource": "/ABS/NEW_OWNED_TWO_MODULE_STAGE",
  "nativeEndpoint": "http://127.0.0.1:<APPROVED_NATIVE_PORT>",
  "apiEndpoint": "http://127.0.0.1:4001",
  "owner": "<ACTUAL_AUTHENTICATED_SOURCE_OWNER_ID>",
  "profile": "default",
  "nativeCookieFile": null,
  "nativeCsrfFile": null,
  "nativeHashes": {
    "api/rhythm_schema.py": "<APPROVED_SHA256>",
    "api/rhythm_inbox.py": "<APPROVED_SHA256>"
  },
  "managerAgentId": "<OPERATOR_SELECTED_EXISTING_MANAGER>",
  "targetAgentId": "<OPERATOR_SELECTED_EXISTING_ROSTER_TARGET>",
  "prompt": "<APPROVED_SINGLE_FIXTURE_PROMPT>",
  "context": null
}
```
Placeholders are documentation, not a runnable approval. No credential values in
manifest or argv; only existing file references. Unknown fields (including
rootOwnerClaim) rejected. Mode, fixtureOnly, version, root, state and refs must
match; operator birth binds SHA256 of the exact manifest bytes. Editing manifest
after birth requires STOP/reconciliation, never silent adoption. Existing canonical
manifests without executionMode remain accepted; explicit sandbox-fixture allowed.

Root/state must be owned by current uid, non-group/world-writable, no symlink in
any path; state must be strictly below root. Global installed native STATE_DIR is
supported when it meets those SAME checks. The CLI does not change permissions or
ownership to force it through. Existing receipts/registry entries are immutable;
preexisting partial/conflicting receipt never overwritten or used as chat adoption.

Existing runtime capability MUST already be available in owned600 file. Missing
file stops BEFORE HTTP with `STOP fileReference --bridge-capability-file: existing
owned regular file600 required`; missing flag stops requiring that reference and
catalog.read/projection.issue/delegation.dispatch scopes. No generation/registrar
bootstrap path exists in this helper. RegistrarBootstrap remains unchanged and
ONLY part of sandbox test setup. Existing owner token and optional native cookie /
CSRF files have the SAME checks. Dryrun reads approval metadata only, stats credential
references, and reads NO credential values; no HTTP or data writes.

Profile is intentionally limited to operator-selected EXISTING current native
default profile. Other manifest profile -> specific STOP; nondefault active native
metadata -> STOP; no profile/default takeover or model/provider changes. Source
manager/target are operator-selected existing catalog agents; all role/roster /
current revision checks preserved. No synthetic provider added to operator mode.

**Native cookie-enabled mapping is NOT qualified.** Actual JSON user identity and
source owner ID are distinct namespaces; no inferred user=owner1. Operator mode
queries current auth policy and STOPs if auth_enabled=true (even with protected
existing cookie/CSRF references), asking for qualified native JSON-user/source-owner
mapping. No new login/password/passkey, no policy weakening or silent auth-disabled
assumption. Unknown status shape also STOPs. Stock password-unset loopback is the
only runtime native auth policy qualified by the existing fixture suite here.

### Public native module ownership — copy instructions ONLY, not performed remotely

If installed source is public/root-owned or under another uid: do NOT chown/chmod
it. Operator creates a NEW owned non-symlink protected stage and an api subdirectory
(umask077), and copies EXACT approved bytes of ONLY api/rhythm_schema.py and
api/rhythm_inbox.py from the public artifact, checking SHA256 against nativeHashes
before publication. Create destination files with exclusive create and mode600;
refuse existing destinations/symlinks, never rewrite source or other files. Set
--native-source and immutable manifest nativeSource to that NEW stage. Pinning,
ownership, AST stdlib allowlist and two-module load remain unchanged; no native
config/server/api.__init__ imports. Existing boundary test copies actual public
module bytes into a new current-uid fixture and exercises actual Receiver. No remote
stage was created in this run and no installed/live config was read.

### Planned operator commands — NOT RUN (await deployment + separate activation approval)

Use placeholders replaced by operator-approved paths, never credential values:
```sh
COMMON=(--allow-private-relay --api http://127.0.0.1:4001
  --approved-fixture-manifest "$APPROVAL" --token-file "$EXISTING_OWNER_FILE"
  --bridge-capability-file "$EXISTING_CAPABILITY_FILE" --state-dir "$NATIVE_STATE"
  --native-source "$OWNED_STAGE" --native-endpoint "$APPROVED_NATIVE_ENDPOINT")
python3 -B tools/dev/hermes_fixture_provision.py "${COMMON[@]}" # DRY_RUN only
python3 -B tools/dev/hermes_fixture_provision.py "${COMMON[@]}" --create-native-owned-fixture
python3 -B tools/dev/hermes_fixture_provision.py "${COMMON[@]}" --execute-owned-fixture
python3 -B tools/dev/hermes_fixture_provision.py "${COMMON[@]}" --stop-owned-fixture
```
Optional existing --native-cookie-file / --native-csrf-file refs must match manifest;
enabled auth currently STOPs as above. Creation and execute/stop mutually exclusive.
Creation is POST /api/session/new(profile default,worktree false) then supported
POST /api/session/rename ONLY for NEW returned receipt SID; no transcript changes.
Creating/persisting partial intent is not retried; successful repeat validates same
SID/profile receipt and does not rename/recreate. No handwritten sessions/index.

Execute retains exact owner/projection/catalog/dispatch/event checks and real native
current-binding handler. Owner bearer goes only to exact source relay owner calls;
bridge capability goes only to source bridge calls, never as owner replacement.
Native calls receive neither source header; cookie/CSRF only native; redirects and
environment proxies remain denied. Source HTTP body syntax is unchanged.

Intended writes ONLY: new birth/dispatch receipts and provisioning locks; supported
native birth/rename metadata and native-managed index for that NEW SID; exact matching
feature registry entry plus supported Receiver.link row. Real delivery subsequently
uses existing subscriber inbox/actor authority/native worker and current validators.
No source SQL or unrelated native chat/transcript edits. --stop-owned-fixture derives
one own run from approvalDigest birth SID, verifies exact owner/profile/token digest /
native endpoint and registry+DB binding, then supported Receiver.revoke and ONLY that
registry active=false. It is offline/idempotent, preserves other entries and all
inbox/render/tombstone proofs; never deletes source rows, chats or existing data.

## Phase 2 — actual checks / two-attempt repair ceiling

First implementation validation all green: operator5, helper16, bridge1, transport3,
nativeHTTP1 and birth2. Supplemental stop RED then implementation GREEN; later
audit/owner-override/native-alias tests GREEN. No failing implementation repair loop
needed; no test assertion weakening, source repairs or runtime bypasses.

Final exact command:
```sh
python3 -B tools/dev/test_provision_operator_mode.py && python3 -B tools/dev/test_provision_contract.py && python3 -B tools/dev/test_provision_bridge_contract.py && python3 -B tools/dev/test_provision_transport_boundaries.py && env RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_http.py && env RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_birth.py && git diff --check
```
All exit0: operator8 PASS2.318s, helper16 PASS0.125s, bridge1 PASS0.528s,
transport3 PASS0.565s, nativeHTTP1 PASS1.529s, birth2 PASS1.340s. NoSecretValues
assertions retained. Supplemental audit hooks exercise REAL CLI dryrun/invalid
target with network and credential-open denied (not replaced SUT functions).
Native107 core pins +7 outputs verified; patch manifest unchanged
997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0.

### Full existing canonical4898 CLI + current Native ACK rerun

Initial status query against absent sandbox returned missing directory/security shim
failure; did NOT start anything. Correct fixture stat/root700, DB/config0400 confirmed.
One complete lifecycle then PASS (no overlapping sandbox, no manual API launch):
```sh
env RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 RHYTHM_SANDBOX_BRIDGE_REGISTRAR_FILE=/private/tmp/hermes-event-notify-20261012-fixture/hermes-cli-synthetic-registrar.txt bash tools/dev/hermes_shipping_checks.sh up && bash tools/dev/hermes_shipping_checks.sh status && env RHYTHM_LIVE_E2E=1 HERMES_CURRENT_ACK=1 python3 -B tools/dev/hermes_cli_fixture_test.py; result=$?; bash tools/dev/hermes_shipping_checks.sh down; exit "$result"
```
Stock wrapper sets all4 approved fixture variables, root
/private/tmp/hermes-event-notify-20261012-fixture, rhythm.db / notifier-opencode.json,
SB /private/tmp/hermes-shipping-rollout-20261014-sandbox, API4898/engine4897/gateway4899,
sqlite/shadow, private prebuilt engine reuse and offline flags. API strict build PASS;
MCP noCheck normal build PASS (NOT strict MCP/action proof). Ready API60054 /
engine60189; startup first readiness curl refused before ready, not final failure.
Four official auth/grant/manager/roster denials PASS0effects. Unedited full CLI
test1 PASS0.421s plus actual Native.current_binding PASS. New supported birth
SID5e1d8621679f, run751723ca-534d-4779-9eb7-41fa11de70c0,
source child085dd77e-57c5-4f7f-8275-d087771ce872.

CurrentShippingACK PASS: source exact11 V2 fields, actual source page kinds
progress/progress/error. Selected first eventc7649504-ffdf-4182-aeea-f3167165b3bc:
actual SSE -> strict Subscriber/NativeAdapter -> native worker/journal/save ->
actual unobscured Chromium DOM732x24.5 -> native receipt -> source HTTP ACK visible.
Qualified receipts1, delivered unique1, native provider callback1, preSSE0,
consumer reopen/tombstone2, foreign source/native unchanged. Wrong chat/run/nonce,
obscuration and wrong source ACK controls preserved. SourceLLMSuccess=false;
synthetic source model error is NOT a successful LLM call. Counts refer ONLY to
selected event, not draining all3. Synthetic provider only in upstream fixture,
never operator mode or native product. Frozen source/helper/native tests untouched.

Sandbox down exit0 preserved .evidence.QXyzPH; native child terminated in finally;
no retained owned listening process or live4001 activation. Retained fixture
/private/tmp/hermes-cli-owned-61bbcl1x; proof SHA256
eede187d6c17a1928ecd9c5325a5d79ebeb85c6d96f3d78f2f4913111d0da077.
Final fixture DB/config still0400/currentuid501. One hash command used obsolete
routes/hermes_notify.ts path and reported absent; corrected routes/hermes_notify_routes.ts
below. No missing file was created or route edited.

## Hashes / limits / handoff

```
294d64655351a6eddba246817b1b6a16cd29327dba086452b4079941a0ef5c88 tools/dev/hermes_fixture_provision.py
d739603b9759020edbd50b61573a34035271bc421770ac1dc0ecef927e8b5b99 tools/dev/test_provision_operator_mode.py
3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7 apps/api_server/src/services/hermes_notify_service.ts
129a4f31283b06e18ea2b5ff8197fa0f050fcf6eac069e6f84cc3e79ec3dfaf9 apps/api_server/src/routes/hermes_notify_routes.ts
871070c91dd646063e46600286ee3b33deb4b55d522ab9875f384b5214a047b7 apps/api_server/src/shared_agents/delegation_coordinator.ts
eede5b4c8d02b02e9fda7af0f4f8dd1ed03b211286bc55097247933977cc618c apps/mcp_server/src/index.ts
84258a1e68dbb5d43497ff529392e5cc79b54404a61d8467c6b04370502cd718 tools/dev/hermes_current_ack.py
d42ba80ea83be0a9731cd8b1005a70a7578c9c7c9f2c2a7eba4b1ff82582670f tools/dev/hermes_current_ack_dom.mjs
9de9d14574be5843a4c27fe39c6b1a4ee6a1a8bebb2326c175538f7c676ba0af tools/dev/test_provision_native_birth.py
3a075e7542ec8f4de59ed092f56fe9924b6c8622351ba1a2993efba289016d99 tools/dev/test_provision_transport_boundaries.py
f0b6745d78434e2102884d4dad6094eea5b7b072b1a939ca36cffae4d65d176e tools/dev/hermes_cli_fixture_test.py
```
API service/route/coordinator/MCP source hashes unchanged before/after lifecycle;
current-ACK and frozen fixture source hashes match prior parent evidence. No product
source authored here. Shared untracked/dirty parent work remains preserved.

**READY_OPERATOR_CLI_CODE / READY_FOR_VERIFICATION** for this bounded prerequisite.
Used explicitly offered qualification alternative: exact-mode/approval validation
contract plus unchanged actual canonical4898 full CLI/current ACK. NO transport
remap or fabricated API/native response. **Live4001 operator creation/execution and
cookie-enabled identity mapping NOT RUN / NOT QUALIFIED**; operator required current
protected references and current supported profile are still prerequisites, with
specific fail-closed STOP paths. This is not release or runtime readiness approval.
Parent independently reruns tests, freezes/commits all source and final CI/numeric
qualification artifacts, then asks before app/server restart/update. Existing
approved scope/exclusions/resolutions above must not be re-requested unchanged.
