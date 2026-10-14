---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES]
status: FAIL_CURRENT_SOURCE_V2_SCHEMA
tags: [run, rhythm]
---

## Scope / entry / exclusions

Explicit parent CLI-owner specialist continuation. Loaded acceptance-contract first,
then coding-agent; read shipping AGENTS, project-state/current-plan, regression
registry and nearest CLI continuation. HEAD c74f4392a6df61979fbe33e620a0077ebb6e0b4b;
pre-existing dirty shared worktree preserved. No orchestrator/peer dispatch.

Approved scope retained: disposable supported native HTTP creation/persistence,
protected CLI receipts/link readiness, tools-only real current-source notification
verification. No apps source edits, existing-chat adoption/rename, direct Session.save
or chat SQL writes, native patch changes, runtime guards bypassed, new login,
credential adoption, live4001/4096/Pi/installed app, provider internet, billing,
MCP-engine action E2E, source configuration, desktop approvals/cards, dependency
install/symlink, commits/push/release/restart activation or destructive cleanup.
Peer owns API service changes; no permission inferred to edit them here.

Canonical wrapper retains all four fixture variables, approved root
`/private/tmp/hermes-event-notify-20261012-fixture`, read-only rhythm.db and
notifier-opencode.json, sandbox `/private/tmp/hermes-shipping-rollout-20261014-sandbox`,
API4898/engine4897/gateway4899, sqlite/shadow and offline switches. Only
sandbox.sh (through hermes_shipping_checks.sh) starts/stops Rhythm servers.
Explicit fixture registrar reference remains protected synthetic file600; no
inherited/live registrar credential. Native instances use copied pinned bytes,
disposable HOME/state, separate loopback port, umask077 and audit fences.
All new evidence copies retained; owned native processes terminated and canonical
sandbox down after each attempt. Prior red receipts/notes preserved.

## Files changed in this continuation

- tools/dev/hermes_fixture_provision.py
- tools/dev/hermes_cli_fixture_test.py
- tools/dev/test_provision_native_birth.py (new frozen criterion)
- tools/dev/hermes_current_ack.py (new current-shipping integration check)
- tools/dev/hermes_current_ack_dom.mjs (new actual UI check)
- this dedicated run

No existing test assertions, native pins, peer source/tests/notes, or sandbox script
were edited. Existing 16 helper + 4 transport/boundary + native HTTP + CLI checks
remain intact. Parent independently verifies the retained artifact; read access to
source suffices, with writable disposable fixture state for executing tests.

## Phase 0 — frozen RED, and honest contract defect

Command before implementation:
`env RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_birth.py`

Frozen test `DurableNativeBirth.test_new_chat_is_saved_empty_once_and_receipt_is_immutable`
failed in 1.402s at line73:
`supported native creation must have durable birth metadata before SSE`.
The actual supported new-session route had minted SID but no saved session file.
Mandate: make this named check pass without editing assertions; no waiver.

After implementation the saved-record/profile/title/zero-message/receipt and
repeat-byte-equality assertions PASSED, but the same test FAILED in 1.331s at
line86: `2 != 1`. **Authoring error in my frozen check:** glob('*.json') counts
the native `_index.json` alongside the single chat JSON. Verified retained files:
`/private/tmp/hermes-native-birth-do9rneab/state/sessions/{_index.json,db7beb30beaa.json}`.
Index contains the single correct SID, message_count0, default profile/fixed title.
Do not delete the native index or disguise this as a runtime bug. The frozen
assertions remain unchanged and the contract is NOT GREEN. Partial-receipt
assertion below that line was NOT reached. Parent must independently adjudicate
the incorrect chat-count assertion before declaring full contract success.

The current-ACK harness separately inspects actual session objects (excluding
the documented list index) before creating any foreign control chat: one newly
minted SID, exact durable profile/title, messages[], native provider effects0.
This is supplemental evidence, not a retroactive frozen-test PASS.

## Phase 1 — impact / consolidated risk review

GitNexus upstream impact for `_create_native_locked`, `execute_fixture`,
`test_provision_native_birth.py`, `hermes_cli_fixture_test.py`, and
`hermes_current_ack.py`: Target not found, risk UNKNOWN (not LOW).
Reviewed complete CLI and known callers: protected creation receipt, original
native HTTP/CLI/16 helper/transport tests, Bridge bootstrap and grant/projection
denials. Inspected actual pinned rename route, Native.current_binding,
browser render-metadata/receipt handling, Receiver/NativeAdapter/subscriber
strict schema, existing real ACK/provider callback/DOM proof fixtures, and
current shipping notification list/SSE/ACK surface. No shared API edit.

Rename POST is exactly the existing supported route: permission checks,
canonical re-resolve under session lock, full-session materialization before
apply title/save/list-change publication. Only the new protected receipt SID
is used, never an arbitrary or existing chat. HTTP ambiguity remains an inert
partial receipt requiring operator reconciliation, never a second creation.
Strict schema mismatch is security-sensitive: do not strip fields or weaken
validation to make the demonstration green.

## Implementation / what now works

Native creation writes creating intent before /api/session/new, then immutable
SID/profile/endpoint with status persisting **before** supported persistence POST:

`/api/session/rename {session_id:<new receipt SID>,title:"Rhythm notification disposable fixture"}`

Only after exact same-SID/default-profile/fixed-title compact confirmation is
receipt marked created with durableRoute=/api/session/rename. Existing successful
receipt is reused; partial/old/changed receipt refuses adoption/recreation. New
creation is one intended disposable-chat metadata mutation, zero transcript
changes/provider calls. No save surrogate, SQL creation, title generation, or
provider wakeup. Existing cookie/CSRF file-reference behavior is preserved.

Execute also requires protected saved SID/profile metadata. After API-authorized
broker V2 origin and supported Receiver.link/protected registry publication,
the real native render-metadata handler must succeed; that handler runs actual
Native.current_binding against current native metadata + registry + Receiver DB.
Only then does CLI return PROVISIONED/nativeCurrentBinding=PASS. This is native
birth/link readiness, NOT total SSE/visible/ACK readiness. Independent copied
in-process actual Native.current_binding was also run successfully below.

Optional HERMES_CURRENT_ACK=1 supplies only the existing deterministic fixture
Agent/provider boundary callback. Actual native routes, worker, journal, save,
receiver and UI remain untouched. Source events come from the real supported
Bridge dispatch, not SQL/manual event insertion; actual source model remains
synthetic-no-provider and its error is NOT successful LLM execution.

New end-to-end check includes real owner/SSE/subscriber/NativeAdapter, supported
foreign control birth, wrong-owner/run/chat denial, native nonce rejection,
consumer reopen/dedup, actual unobscured DOM + screenshot/receipt, wrong-run ACK
retry/tombstone and read-only source state/foreign-row checks. Later stages are
authored but **NOT RUN** because the real source event fails the pinned schema
before native delivery. No ACK/browser screenshot is claimed.

## Checks / commands / observed results

1. Original helper `python3 -B tools/dev/test_provision_contract.py`:16 PASS,
   first0.124s/final0.121s.
2. `python3 -B tools/dev/test_provision_bridge_contract.py`:1 PASS,
   first0.528s/final0.534s.
3. `python3 -B tools/dev/test_provision_transport_boundaries.py`:3 PASS,
   first0.564s/final0.565s.
4. `env RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_http.py`:
   1 PASS, first1.785s/final1.531s.107 core pins/7 patch outputs;
   manifest SHA256997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0;
   supported native creation PASS/providerEffects0.
5. Canonical source lifecycle, using exact command below without HERMES_CURRENT_ACK:
   strict API build PASS, MCP normal --noCheck build PASS (not strict MCP proof),
   listeners API94846/engine94983,4 official auth/grant/role/roster denials PASS
   with0 effects; CLI frozen test1 PASS0.466s; actual Native.current_binding PASS.
   Fixture `/private/tmp/hermes-cli-owned-zksqesc9`, SID14c82b37e1cf,
   run58ca9ea1-2291-42a3-8545-bae142167cdc. Down PASS/.evidence.AN8OVQ.
6. Integration attempt1: command below, API13510/engine13722; same4 denials PASS,
   CLI1 PASS0.466s, actual native current binding PASS. SSE delivers actual V2
   event; Subscriber.receive -> validate throws unsupported notification schema.
   Fixture `/private/tmp/hermes-cli-owned-xy06_ne4`, down PASS/.evidence.5W3sAU.
7. Integration attempt2 (added source receipt/hash diagnostics only, no validation
   edits):API26167/engine26313,4 denials PASS,CLI1 PASS0.434s,actual Native binding
   PASS. **Same schema FAIL**, whole harness exit1. Fixture
   `/private/tmp/hermes-cli-owned-htg2tzr2`, down PASS/.evidence.9mTjJa.
   No further integration repairs/reruns; no approved tools-only fix for pinned
   native/source schema disagreement, and no permission to modify peer API.
8. `bash -n tools/dev/sandbox.sh && node --check tools/dev/hermes_current_ack_dom.mjs && git diff --check`:PASS.

Exact integration lifecycle (parent verifier; do not claim success from CLI alone):

```bash
env RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 RHYTHM_SANDBOX_BRIDGE_REGISTRAR_FILE=/private/tmp/hermes-event-notify-20261012-fixture/hermes-cli-synthetic-registrar.txt bash tools/dev/hermes_shipping_checks.sh up && bash tools/dev/hermes_shipping_checks.sh status && env RHYTHM_LIVE_E2E=1 HERMES_CURRENT_ACK=1 python3 -B tools/dev/hermes_cli_fixture_test.py; result=$?; bash tools/dev/hermes_shipping_checks.sh down; exit "$result"
```

Protected reference-only dry run (ran, PASS, modeDRY_RUN, no secret/network/write):

```bash
python3 -B tools/dev/hermes_fixture_provision.py --token-file /private/tmp/hermes-cli-owned-htg2tzr2/owner.txt --state-dir /private/tmp/hermes-cli-owned-htg2tzr2/state --api http://127.0.0.1:4898 --approved-fixture-manifest /private/tmp/hermes-cli-owned-htg2tzr2/approved-fixture.json --bridge-capability-file /private/tmp/hermes-cli-owned-htg2tzr2/capability.txt
```

## Decisive current-source failure / exact effects / handoff

Retained protected `current-ack-source-receipt.json` captures actual progress event
4676cceb-63e5-454e-bca0-7e0b86deac33, run2c630a9e-2454-46f8-8740-591f413dcc42,
source child6befbcb6-c5e9-4716-bf23-9f24dd4c89f2, native SIDc1b76172c6ae.
Source page contained **progress, progress, error**; selected first real progress
label `Rhythm session linked.`. Actual event has the11 pinned V2 fields PLUS
`engineRequestID:null`. Current source listRun SQL lines224–225 projects that
field for every event. Pinned subscriber validate line29 and native schema only
allow the exact V2 keys. No meaningful event reaches NativeAdapter.deliver.
This is a concrete contract mismatch, not missing owner auth or general MCP gap.

Post-failure actual copied in-process Native.current_binding independently PASS:
ran python3 -B -c importing api.rhythm_notify.Native in the retained copied source
with HOME/HERMES_HOME/HERMES_WEBUI_STATE_DIR/settings/agent/config paths all bound
to `/private/tmp/hermes-cli-owned-htg2tzr2`, and audit fence denying socket.connect,
subprocess.Popen,os.system. Asserted binding equals protected registry, saved
messages[], read-only native inbox count0, consumer inbox count0, and absent
provider-calls.jsonl. Observed: nativeProviderEffects0, visibleReceipts0, sourceACKs0.
No browser DOM, nonce qualification, ACK retry/tombstone or screenshot was reached.
Previous source provider error is real synthetic model failure, NOT source success.

Parent owns independent correction/adjudication of my frozen index-count assertion,
source schema compatibility with unchanged pinned native artifact, final peer source
freeze and rerun. Unchanged approved scope/exclusions do not require re-approval.
Any native schema/patch or API production scope expansion stays with parent, not
this tools owner. READY_CLI_NATIVEBIRTH_CURRENT_ACK is **NOT** justified.
Live activation remains unauthorized: later qualified signed artifact + explicit
AJ restart approval required. No general remaining MCP-engine tests requested.

## Artifact SHA256 / observed source identity (not final release freeze)

```
7102284df56b8a0b4a62d45b6d1018f94761da2f8958d93b2e006dc2c9e11ebf tools/dev/hermes_fixture_provision.py
9ff91d1bd5e4b4bcdc48336660361511e0e080795c44f082dd878d91967c380c tools/dev/hermes_cli_fixture_test.py
962b4b263ddc0db268cfc7033409a0a7efced83329d898de72b7ea6d406ab525 tools/dev/test_provision_native_birth.py
84258a1e68dbb5d43497ff529392e5cc79b54404a61d8467c6b04370502cd718 tools/dev/hermes_current_ack.py
d42ba80ea83be0a9731cd8b1005a70a7578c9c7c9f2c2a7eba4b1ff82582670f tools/dev/hermes_current_ack_dom.mjs
3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7 apps/api_server/src/services/hermes_notify_service.ts
0b4e898f9569cab6f58629be10c915daad48a7d38036b8ce52b612aae0ec05c4 apps/api_server/dist/services/hermes_notify_service.js
871070c91dd646063e46600286ee3b33deb4b55d522ab9875f384b5214a047b7 apps/api_server/src/shared_agents/delegation_coordinator.ts
8d60587a2ab20c94eae8c207a1fc9cd2e8896b6f22070d78cccc269994253e3b apps/api_server/dist/shared_agents/delegation_coordinator.js
```

Shared API dist build identity differs from the prior continuation's compiled
notification hash. These are observed files only, not authored source or a final
release/frozen-peer claim. Rebuild/rerun after parent freezes peer output.
