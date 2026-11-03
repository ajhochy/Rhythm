---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES]
status: FAIL_NATIVE_DURABLE_BIRTH_AUTHORITY
tags: [run, rhythm]
---

## Scope / retained authorization

Explicit parent specialist handoff; acceptance-contract first, coding-agent second.
Read worktree AGENTS.md, project-state/current-plan and prior provisioning run.
Sole tools writer in retained shipping worktree. This continuation writes only:

- tools/dev/hermes_fixture_provision.py
- tools/dev/sandbox.sh
- tools/dev/sandbox_bridge_fixture_digest.py
- tools/dev/test_provision_bridge_contract.py
- tools/dev/test_provision_execute_cli.py
- tools/dev/test_provision_transport_boundaries.py
- tools/dev/hermes_cli_fixture_test.py
- this dedicated run note

Existing tests preserved, including the original 16 helper checks and real native
HTTP creation check. No apps source, peer tests/notes, release scripts, packaging,
shared dependency install/symlink, commits/push, production/Pi/live app/4001/4096,
provider credentials/billing, MCP-engine E2E, relay/Tailscale, or restart/install
activation. No SQL inserts into Rhythm: synthetic profiles and grants use official
HTTP handlers. Test-only SQL is read-only guard-count inspection. Receiver.link is
the only native link writer; native chats are minted via supported HTTP, never SQL
or Session.save surrogates. Approved scope/exclusions unchanged; no renewed scope
approval required. Parent retains independent verification and final source freeze.

Canonical fixture root remains /private/tmp/hermes-event-notify-20261012-fixture,
rhythm.db/notifier-opencode.json read-only; sandbox remains
/private/tmp/hermes-shipping-rollout-20261014-sandbox with API4898/engine4897/
gateway4899, sqlite/shadow and wrapper offline flags. Only sandbox.sh manages the
Rhythm API. Tests use copied pinned native source, disposable HOME/state, separate
loopback port, outbound/process audit fences, no provider. Fixture copies and
synthetic references retained for inspection; native processes terminated and the
owned canonical sandbox downed. No production or installed client activation.

## Phase 0 — exact RED evidence and independent verification

Before implementation:
`python3 -B tools/dev/test_provision_bridge_contract.py`
failed 1 test in 0.529s: `Bridge forbids browser Origin`; real owned loopback HTTP
listener observed Origin on the actual CLI client's Bridge request. No SUT mock.
This was the **transport behavioral RED**, not a complete dispatch/native-authority
RED. The full CLI test was authored before implementation but first exercised
after wiring; do not retroactively claim a preimplementation full-flow RED.

Frozen check: BridgeTransport.test_bridge_requests_are_nonbrowser. Frozen full
check: ExecuteCLI.test_supported_dispatch_publishes_actual_native_link. Mandate is
make these checks pass without editing assertions. Parent independently runs the
commands below against read-only source; it does not need source write access.
The full CLI test alone is insufficient: the added actual Native.current_binding
check in the fixture harness is the decisive gate and currently FAILS.

## Phase 1 — bounded impact / consolidated risks

GitNexus upstream impact for hermes_fixture_provision.py, request_json and main
returned Target not found / UNKNOWN (not LOW). sandbox.sh returned LOW: 0 direct
indexed dependents/processes/modules. Manually reviewed every known CLI caller,
creation/receipt/link helpers, bridge common/registrar/runtime/catalog/projections/
delegation handlers and schemas, coordinator preengine hook, notification bridge
authority, actual copied Receiver and Native.current_binding/browser_owned,
native auth/profile/session routes. No shared API symbols edited.

Security-sensitive authorization is proportionately tested despite graph ratings:
owner bearer is NOT a runtime grant; no grant, wrong scope, nonmanager and missing
roster all deny with unchanged jobs/sessions/origins. Exact owner/catalog scope,
current manager revision, frozen projection and native birth receipt are checked.
Recipe default-off remains unchanged. Registrar fixture opt-in changes setup only,
not auth middleware. **Compatibility note:** sandbox.sh no longer imports a caller's
RHYTHM_SANDBOX_BRIDGE_REGISTRAR_SHA256 into runtime_env. This continuation uses the
explicit protected-file synthetic opt-in instead; older digest-only callers are
not qualified here and must migrate or be reviewed by parent, not bypass auth.

## Implementation — actual wiring, not an unimplemented stub

--execute-owned-fixture now calls /auth/me, runtime catalog, POST projections,
POST projection/:id/check, POST delegations, and bounded owner-authenticated V2
/hermes-notify/runs/<actual-job>/events. Request body is the existing exact Bridge
shape. runId comes from job.jobId (the public view of the actual job), sessionId
from the authenticated event whose service rechecks the broker child, and native
session key comes from the supported creation receipt. No Recipe feature bypass,
arbitrary run/chat adoption, unauthorized registrar minting, or raw manager grant.

Protected --bridge-capability-file is mandatory for execute, separate from existing
--token-file. Missing capability emits the precise existing-reference requirement.
Protected --approved-fixture-manifest binds all references, owner/default profile,
manager/target, prompt and exact inbox/schema hashes. Explicit operator-owned
fixtureRoot containment replaces the execute path's hardcoded temp-only heuristic;
this remains fixture-only, NOT a production mode. Native creation remains the
separate disposable fixture operation. Production STATE_DIR mode is PROPOSE ONLY.

Local dispatch receipt preserves the frozen projection and UUID idempotency key;
projecting/changed partial receipts fail closed rather than retry projection.
Repeated successful CLI invocation reuses native birth receipt and actual job.
Pinned class loader verifies copied bytes and allows only declared stdlib/schema
imports, installs temporary isolated module entries, then restores sys.modules;
it never imports native config/server/wakeup. Actual generated api.rhythm_inbox.py
and api.rhythm_schema.py are exercised by offline-copy tests.

Owner/Bridge HTTP no longer sends Origin or Cookie. Only native browser requests
send Origin; proxies/redirects are disabled. Native cookie mutations require an
existing protected CSRF file; no token synthesis. Auth-enabled execution requires
actual /api/auth/status logged-in user + bound_profile to match owner/default;
ordinary auth modes without that mapping fail closed and are NOT qualified here.
No secret values are printed, only references/IDs/status or local safe diagnostics.

Sandbox opt-in RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 requires explicit protected
RHYTHM_SANDBOX_BRIDGE_REGISTRAR_FILE under the approved root, owned non-writable
root/sandbox/HOME, exact known synthetic DB users and public session forms,
owner0600 nonsymlink generated-token reference, and derives the digest internally.
Canonical RHYTHM_AGENT_BRIDGE_REGISTRAR_SHA256 only is appended. Default is blank
and HTTP503 was exercised. Test runtime grants/reports/projections are registered
through official handlers. No inherited production registrar token is used.

## Commands / observed results / bounded repairs

1. Transport RED above; after implementation 1 PASS (0.532s), final 1 PASS (0.522s).
2. `python3 -B tools/dev/test_provision_contract.py`: original 16 PASS (0.107s),
   final 16 PASS (0.102s), unchanged assertions.
3. `env RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_http.py`:
   original native creation 1 PASS (1.515s), final 1 PASS (1.373s).
   Output nativeCorePins=107/nativeOutputs=7/supportedNativeCreation=PASS/
   providerEffects=0; patch manifest SHA256
   997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0.
4. Default lifecycle:
   `bash tools/dev/hermes_shipping_checks.sh up && bash tools/dev/hermes_shipping_checks.sh status`
   strict API build PASS; MCP normal --noCheck build PASS (NOT strict MCP proof).
   API99114/engine99246; one initial readiness curl refusal recovered normally.
   Node fetch of /agent-bridge/v1/catalog asserted HTTP503 PASS.
   `bash tools/dev/hermes_shipping_checks.sh acceptance`: 2 HTTP401 guards PASS,
   102.93ms. down PASS; diagnostics suffix .evidence.HUHgWH.
5. `python3 -B tools/dev/hermes_cli_fixture_test.py prepare`: fresh synthetic
   protected registrar reference prepared, no secret output.
   `env RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 RHYTHM_SANDBOX_BRIDGE_REGISTRAR_FILE=/private/tmp/hermes-event-notify-20261012-fixture/hermes-cli-synthetic-registrar.txt bash tools/dev/hermes_shipping_checks.sh up`
   API3801/engine3938 built/ready. Official bootstrap owner1 and all 4 denial
   cases PASS/0-effects. Full CLI failed generic boundary in 0.074s.
   Isolated pin-loader command identified stdlib imports in actual rhythm_schema
   outside the initial allowlist. **Repair 1:** include only those actual stdlib
   imports. No acceptance assertions changed.
6. A separate tool-call retry saw connection refused: prior API had SIGTERM/clean
   shutdown, no listeners. This is an infrastructure lifetime failure, not PASS.
   Down/up + test + down then kept verification in one lifecycle command.
   Full CLI failed in 0.220s; real broker created an engine child and emitted V2
   authority. Native DB was 0644 and protected link publication correctly refused.
   **Repair 2:** launch disposable native fixture with umask077. Never chmod an
   existing live DB or weaken CLI permissions. Repair budget exhausted.
7. Same canonical up + `env RHYTHM_LIVE_E2E=1 python3 -B tools/dev/hermes_cli_fixture_test.py`
   + down: frozen full CLI check 1 PASS in 0.402s, including repeat same-job link
   idempotency. Manifest /private/tmp/hermes-cli-owned-s_7crzc1/approved-fixture.json.
   This alone was not declared READY. Diagnostics .evidence.FPDXFR.
8. `python3 -B tools/dev/test_provision_transport_boundaries.py`: 3 PASS,0.556s:
   real redirect refusal/proxy suppression, cookie nonbrowser denial/missing CSRF
   pre-request refusal, actual copied pinned Receiver offline load/link and changed
   pin rejection. Final helper/creation commands above all PASS.
   `bash -n tools/dev/sandbox.sh && git diff --check`: PASS.
9. Final same-lifecycle up/status/test/down: API33498/engine33621, all 4 official
   guard cases PASS; frozen full CLI 1 PASS,0.368s. Supplementary actual copied
   `Native.current_binding()` check FAILED with Denied('origin unavailable').
   Manifest /private/tmp/hermes-cli-owned-znrkm3bg/approved-fixture.json; protected
   creation receipt native SID 5ae1a5c72514. state/sessions is EMPTY.
   Entire harness exit1; canonical down PASS; diagnostics .evidence.3ZVnrb.
   Chained workstreams acceptance was NOT RUN because the harness failed first.

## Decisive FAIL / precise dependency / parent handoff

Actual pinned native models.py new_session lines6594–6669 explicitly creates a
memory-only session and does NOT persist until first message (worktree sessions
excepted). POST /api/session/new + metadata GET can therefore pass while no durable
birth metadata exists. Native.current_binding requires that durable session file
(rhythm_notify.py lines43–53), so the linked record is inert and cannot authorize
delivery. **Known defect:** CLI currently prints PROVISIONED after successful
Receiver.link/registry publication even though this durable native authority gate
fails. Do not use that summary as executable readiness; whole harness is FAIL.

This is not a missing Bridge API, host permission denial, peer source failure, or
reason to bypass Native authority. Supported dispatch and real preengine child/V2
events DID run. Engine returned ProviderModelNotFoundError for the explicitly
synthetic-no-provider model; no external provider was installed/launched/billed.
This qualifies broker birth/link plumbing only, NOT successful model execution.

Next bounded continuation must make native birth durable using an inspected
supported native HTTP operation for this newly minted SID, never Session.save/SQL
or arbitrary existing-chat adoption, and independently prove Native.current_binding
before reporting executable readiness. Source routes mention /api/session/rename
as a supported persistence path; it was discovered but NOT exercised/implemented
because the two-repair limit was reached. Do not count a hypothetical rename as
proof. Keep fixture, CSRF/auth, projection/grant and protected-file safeguards.
Cookie-enabled native identity policy, visible SSE/ACK, provider success, packaging,
MCP full E2E and actual activation all remain unqualified/excluded.

Parent verifier command (same-shell lifecycle to retain sandbox):
`env RHYTHM_SANDBOX_BRIDGE_FIXTURE=1 RHYTHM_SANDBOX_BRIDGE_REGISTRAR_FILE=/private/tmp/hermes-event-notify-20261012-fixture/hermes-cli-synthetic-registrar.txt bash tools/dev/hermes_shipping_checks.sh up && env RHYTHM_LIVE_E2E=1 python3 -B tools/dev/hermes_cli_fixture_test.py; result=$?; bash tools/dev/hermes_shipping_checks.sh down; exit "$result"`

Production operator execution remains NOT AUTHORIZED/NOT RUN. An eventual operator
must name actual installed STATE_DIR/copied pinned source, existing owner/runtime
capability references, and existing native cookie/CSRF references where required.
No new login/private-key copy or manager grant adoption. Parent still owns explicit
live mode/provider selection and restart approval. Existing app remains unchanged.

## Final artifact hashes (SHA256)

```
9a5fa54108b50fea3789bf45da1be28c144f723d622e8aa4d6cb8ab524c62058 tools/dev/hermes_fixture_provision.py
d4c0dfef0d91b9d51d7ee14fe80665ef279c15e5d415369c0a232bb7da33e1c8 tools/dev/sandbox.sh
b35f9ceec3e3bd5261ed93f4fc2948a6c09998738370dcc0c91251b2eda567f6 tools/dev/sandbox_bridge_fixture_digest.py
d3fe068b3718ee498a356517933a27a03b9a8286e6c918347bd954f33fe01d4f tools/dev/test_provision_bridge_contract.py
3eac65a3e2d95afb102ec8d9d0069477e6c62c392783d659152f938f3f971a9b tools/dev/test_provision_execute_cli.py
3a075e7542ec8f4de59ed092f56fe9924b6c8622351ba1a2993efba289016d99 tools/dev/test_provision_transport_boundaries.py
9c93a16233d54053de0799898d6b5bd767d4f314d85cbe8db92bc9471b9a0225 tools/dev/hermes_cli_fixture_test.py
3f8be42e4ff81aa4f18274d01e5c7b28661fcc322bae21ffb7d225f111671ef7 apps/api_server/src/services/hermes_notify_service.ts
871070c91dd646063e46600286ee3b33deb4b55d522ab9875f384b5214a047b7 apps/api_server/src/shared_agents/delegation_coordinator.ts
fe6763b0e5e91447912ddbe44ce0f85a33c32886b20c4d95e1801bc63d825689 apps/api_server/dist/services/hermes_notify_service.js
8d60587a2ab20c94eae8c207a1fc9cd2e8896b6f22070d78cccc269994253e3b apps/api_server/dist/shared_agents/delegation_coordinator.js
```

Peer API source hashes are observed, not authored. Builds share the peer's compiled
output; parent must freeze final source/payload after both workers. No blanket
current-source full release, successful-provider, native visible ACK or READY claim.
