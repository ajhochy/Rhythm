---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES, HERMES-APPROVALS]
status: FAIL_FULL_SCOPE_NATIVE_CREATION_SLICE_PASS
tags: [run, rhythm]
---

## Scope / approvals retained

Explicit parent specialist handoff; acceptance-contract loaded FIRST, coding-agent
SECOND. Read worktree AGENTS, project-state/current-plan and source/rollout notes.
Exclusive tools/test/note writer, preserving all pre-existing dirty source/release
files at c74f4392. No apps/api_server/src or apps/mcp_server/src edits, no shared
source fixes, no release/stage/verify edits, no sandbox flag relaxation. Recipe
default-off409 assertion remains unchanged. No peer dispatch/orchestrator.

Canonical lifecycle only: approved root
`/private/tmp/hermes-event-notify-20261012-fixture`, sources rhythm.db and
notifier-opencode.json, sandbox
`/private/tmp/hermes-shipping-rollout-20261014-sandbox`, API4898/engine4897/gateway4899,
SQLite/shadow/offline flags via existing hermes_shipping_checks.sh -> sandbox.sh.
No hand-started Rhythm API. Native HTTP uses a separate ephemeral loopback port,
disposable HOME and STATE_DIR, with outbound/provider/subprocess fences installed
before imports. No live4001/4096, application/Applications, Pi/SSH/relay/Tailscale,
real providers/cards/tools, credentials export, dependency installs, commits,
pushes, signing/notarization/tag/release/deploy or live DB/schema actions. Parent
retains independent verification, one integration/commit/CI qualification boundary
and NEW restart request. Existing signed artifact remains STALE. No activation.

## Files (only these authored here)

- NEW tools/dev/hermes_fixture_provision.py
- NEW tools/dev/test_provision_contract.py
- NEW tools/dev/test_provision_native_http.py
- NEW this note

Generated only disposable native copies/state/token reference/receiver files inside
tests and canonical sandbox build/runtime outputs. No native source patch builder
run, no original native copy modifications, no reset of any existing record.

## Phase 0 / contract evidence

`python3 -B tools/dev/test_provision_contract.py`: exit1,16 failures,0.002s.
All failed the explicit required-CLI-artifact assertion before import:
`required supported provisioning CLI has not been implemented`. This is an
artifact-availability RED, **not 16 independently exercised behavioral REDs**.
Frozen tests subsequently exercise token mode/size/empty/injection/symlinks (all
ancestors), endpoint credential/query/private/live-port boundaries, reference-only
dry run, actual Receiver.link idempotency, immutable conflict and inactive partial
registry refusal. No test edits after RED. Make these checks pass unchanged;
parent is independent verifier and can run the tests without source write access.

Before implementing native creation, added/ran the real copied-server contract:
`env RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_http.py`.
Actual behavioral RED exit1,1 failure,1.439s: CLI rejects the required
`--create-native-owned-fixture --native-endpoint` operation (return2 vs expected0).
Actual pinned copied native server was ready; no import/schema/readiness failure.
The contract requires real supported HTTP creation and subsequent reuse of the
same immutable local creation receipt, no second native chat, no token in output.
No SUT mocks, no new production test-provider flag; no provider is needed for this
creation-only milestone. Assertions frozen unchanged through the repair.

## Phase 1 / bounded review

GitNexus upstream impact calls for new CLI and new contract return Target not
found / **UNKNOWN**, not LOW/zero-risk. Existing shared symbols were not edited.
Reviewed whole intended tool/helper surface and actual receiver link/schema/native
registry/NativeAdapter, source manifest, native session new/get routes, authenticated
notification router and trusted bridge preengine provenance. Manual review:
Receiver.link is the only supported DB link writer; Native.current_binding needs
matching active registry AND DB tuple/digest plus durable native profile/session.
Existing listRun rechecks Recipe current stage/attempt or bridge owner/generation;
do NOT claim a missing stage-attestation endpoint merely because event JSON omits
internal stage IDs. No new backend endpoint was invented. Native new_session is
called only through `/api/session/new`, never Session.save or SQL chat fabrication.

## Phase 2 / implemented slice

CLI default: file-reference-only DRY_RUN, no HTTP or native writes. Existing token
reference must be owner0600, regular, nonsymlink at every ancestor, <=8192 bytes,
ASCII/nonempty/no header injection. Local plan never outputs token or digest.
HTTP client disables proxies and redirects, bounds responses, sends secrets only
as headers, and suppresses credential/URL-bearing exception serialization.
Fixture API fixed4898; native fixture endpoint must be separate literal loopback
HTTP. Optional existing native cookie is a protected FILE reference; no new login
or private-key copy. Cookie-enabled/CSRF native deployment is NOT qualified here.

Explicit native creation creates one default-profile chat through supported HTTP,
stores an atomic0600 receipt in the disposable STATE_DIR, and on retry verifies
the same session/profile through metadata-only GET (`session_id`, messages0,
resolve_model0). Exclusive creation lock + persisted intent BEFORE HTTP ensures
an ambiguous/crashed creation refuses retry instead of minting another chat.
Partial receipts remain quarantined for operator reconciliation, not adoption.

Native link helper uses the actual supplied Receiver class's link/revoke methods,
validates dedicated existing schema v2 and exact three tables, serializes provisioners,
refuses immutable/partial/inactive conflicts, preserves all existing registry runs,
publishes DB first and atomic JSON last. Native authority requires both, so a
DB-only partial link cannot run. Failed publication revokes only the newly linked
run; no rows/transcripts are deleted or rewritten. Unit checks use real qualified
Receiver code, not an adapter/mock. **This helper is not yet wired to a completed
authenticated creation/dispatch/native provisioning CLI operation.**

`--execute-owned-fixture` remains FAIL-CLOSED after protected-manifest/auth-me/
authorized-run-event preflight: supported Rhythm workflow/job creation and pinned
native-class/profile verification are not implemented in this worker. This is
unfinished implementation, not a host denial or evidence a new API is required.
No arbitrary existing native conversation/run is adopted to mask that gap.

## Commands / actual outputs / repair loop

1. `python3 -B tools/dev/test_provision_contract.py`: after CLI slice,16 PASS,
   0.103s. Final repeat16 PASS,0.080s. No test/expectation repair.
2. Native behavioral command above: after first implementation, exit1,1 failure,
   1.505s. FIRST creation succeeded; second CLI invocation failed. Inspected actual
   native GET route: query is session_id, not id. Repair1 corrected query and
   requested metadata-only/no model resolution. Repeat PASS,1.405s. Added durable
   before-HTTP intent/creation locking; final same frozen test PASS,1.569s. No
   provider/mock changes. One native criterion repair used, not an unbounded loop.
3. Native final output:
   `nativeCorePins=107,nativeOutputs=7,supportedNativeCreation=PASS,providerEffects=0`.
   Full seven-output manifest SHA256:
   `997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0`.
   Test verifies every107 core pin with7 output overrides before copying only the
   declared110 files. Reuses existing oldnotify pinned source, not live app/config,
   .env, .git, chat, or provider secrets. No copied source modified. This is a
   native-creation proof ONLY; old ACK receipts were NOT reused as current proof.
4. `bash tools/dev/hermes_shipping_checks.sh up && bash tools/dev/hermes_shipping_checks.sh status`:
   exit0; current worktree API strict tsc/postbuild PASS; MCP normal build uses
   its existing --noCheck, so strict MCP validation is separately recorded below.
   API29022 on4898/gateway4899, engine29153 on4897. Initial bounded curl refusal
   resolved at readiness, not reported as a failure/pass criterion.
5. `bash tools/dev/hermes_shipping_checks.sh acceptance`:2 HTTP contracts PASS,
   154.56ms; actual API/engine health200; notify/relay unauthorized401.
6. `env RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node --test tools/dev/hermes_shipping_workstreams_acceptance.mjs`:
   2 PASS,145.92ms; workstreams401 and unchanged Recipe409/error=disabled.
7. `env RHYTHM_LIVE_E2E=1 tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/hermes_shipping_mcp.mjs`:
   exit0; actual SDK stdio inventory112,baseline109,additive3; unauthorizedRead
   DENIED,decisions0,providerRequests0. NOT authenticated owner/card action proof.
8. In apps/mcp_server:
   `npm run typecheck && ./node_modules/.bin/tsc -p tsconfig.json && ./node_modules/.bin/vitest run src/__tests__/mcp_capabilities_and_tool_registration.test.ts src/security/__tests__/external_content_role_graph.test.ts`:
   strict typecheck+emit exit0;2 files/9 PASS,548ms; expected scanner refusals.
9. `git diff --check`:exit0. `bash tools/dev/hermes_shipping_checks.sh down && git status --short`:
   exit0; only owned sandbox stopped; sanitized diagnostics
   `/private/tmp/hermes-shipping-rollout-20261014-sandbox.evidence.xosusJ`.
   Pre-existing source/release changes preserved. Concurrent source-worker new
   coordinator test/note were not authored here; read its note after shutdown.

## FAIL / precise remaining criteria / parent handoff

Executed:16 CLI/helper unit checks +1 real native creation test +4 current HTTP
guards +9 existing MCP tests; actual112-tool inventory separately. No full API
unit suite or engine rebuild was run here; existing verified unchanged engine
copy used by canonical wrapper. Current shipping API was rebuilt, not old-source
qualification reuse. This is NOT READY_PROVISIONING_CURRENT_E2E.

Still unimplemented/unrun: authenticated supported one Recipe/Coordinator/Bridge
creation+dispatch via preengine binding; profile/grant provenance and complete
CLI link publication; actual SSE/subscriber/NativeAdapter -> unobscured Chromium
visible receipt -> current shipping API ACK; duplicate/busy retry effect/journal
identity and consumer reopen tombstone2; authenticated MCP owner list/get/approve/
reject -> real fork signed action gate/harmless SQLite task, replay/expired/changed
payload/owner/no-auth0-effects. Full receiver-publication failure-window tests and
real cookie-enabled native profile authorization remain unqualified.

Independent coordinator specialist note now reports four actual source REDs and
missing qualified goal receipt/canonical question relationships; see
2026-10-14-hermes-coordinator-source-integration.md. Those are peer evidence, not
tests run by this worker, and must not be described as all-pass completion here.
No shared-source fix or schema expansion attempted. Parent needs one integration
boundary for those producer relationships and continued CLI/E2E work, not repeated
approval for unchanged scope. My incomplete CLI wiring is NOT blamed on those
source gaps. No new live provider chosen or billed. Parent must still publish
actual protected live file refs/provider commands/intended writes before activation.

Reproduce the native milestone:
`env RHYTHM_LIVE_E2E=1 python3 -B tools/dev/test_provision_native_http.py`.
Protected CLI example (operator-provided disposable refs, NOT a live command):
`python3 -B tools/dev/hermes_fixture_provision.py --token-file /private/tmp/<fixture>/token --state-dir /private/tmp/<fixture>/state`.
Explicit supported native creation adds
`--create-native-owned-fixture --native-endpoint http://127.0.0.1:<owned-native-port>`
and optional `--native-cookie-file /private/tmp/<fixture>/native-cookie`.
Actual test uses equivalent generated refs in its private HOME and removes only
its owned temporary fixture. No real protected credentials or permanent chat were
used. Rollback/disable must only revoke this new link/mark this new registry run
inactive; no transcript edit, reset, database delete or destructive undo. No live
provisioning happened, so no live rollback is needed.
