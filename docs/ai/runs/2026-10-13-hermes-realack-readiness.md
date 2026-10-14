---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: READY_FORFINALINDEPENDENT_ACKgate
tags: [run, rhythm]
---

# Test-only actual completion readiness / full real ACK gate

## Scope / approvals / ownership

Explicit specialist handoff; acceptance-contract invoked first, coding-agent
second. Retained sole-writer worktree:
`/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`;
HEAD before/after `ee914fce476de2190efdead7c3bc2ce8f59c19ce`.
Read AGENTS, project-state/current-plan, lockrepair run, real ACK Python/browser/
preparation fixtures, native adapter, worker/qualifier/schema and artifact verifier.
No orchestrator or peer dispatch. Existing unrelated dirty work preserved.

Approval is TEST ONLY: add exact-event actual-status readiness before unchanged
original test line70, run frozen full real ACK and adjacent checks, record evidence.
No product/native predicate/worker, builder, native artifact, source pins, host
files/manifest/proof/guard or frozen assertions changed. No commits/push, SSH,
Docker, install, host restart, manual api_server, live4001/4096/approval4198,
credential/live DB/config access, provider network, tools/drive/email/billing/cards,
desktop approval, shared dependency installation, port/relay/Tailscale or destructive
cleanup. Planned ONE host restart remains HOLD until parent independent ACK and
exact host-manifest identity gates pass. Unchanged scope needs no renewed approval.

## Files

- `tools/dev/hermes_webui_receiver/test_real_rhythm_ack.py`: inserted readiness
  block only, after actual saved-reply wait and before unchanged completed assertion.
  Uses monotonic 10-second deadline and one conditional 50ms polling timer. Reads
  actual POST status for the original event; only HTTP200 AND exact five-field
  version/event/run/chat/completed receipt qualifies. HTTP200/started does not.
  No forced state, worker/drain call, second launch, receive replay, mock or blind
  completion sleep. Existing request timeout5s unchanged; an in-flight request is
  bounded by that timeout, and completion observed after deadline fails.
  Timeout reports sanitized fixture status history, journal identity/index fields,
  and read-only native inbox identity/turn/proof fields. Success prints the same
  evidence before executing every unchanged downstream assertion.
- This dedicated run note.
- New actual screenshot:
  `docs/ai/runs/artifacts/hermes-realack-readiness-20261013/real-rhythm-ack-native.png`.
  Existing frozen native drivers also refreshed their own auxiliary screenshot
  paths; those are NOT substituted for the real ACK screenshot.

## Phase 0 — current RED before implementation

Historical lockrepair [run](2026-10-13-hermes-lockrepair-realack.md) retained exactly:
both attempts FAIL (2.589s / 2.424s), original line70 `started != completed`;
downstream real DOM/ACK assertions then NOTRUN. Those failures are not rewritten.
Assigned triage `5a637` reports one qualified same-hash event/run/chat journal
completion and saved-message hash, followed by separate drain persistence0.937s
later without another launch; passing fixture-event has analogous0.923s gap.
These timings are dispatch evidence, not newly executed triage commands here.

Fresh acceptance RED, cwd `tools/dev`:
```sh
env RHYTHM_LIVE_E2E=1 RHYTHM_SANDBOX_API_PORT=4898 DB_PATH=/private/tmp/hermes-event-notify-20261012-sandbox/rhythm.db HOME=/private/tmp/hermes-event-notify-20261012-sandbox/home python3 -B -m unittest hermes_webui_receiver.test_real_rhythm_ack -v
```
Observed `Ran 1 test in 2.538s / FAILED (failures=1)`, actual original line70:
`AssertionError: 'started' != 'completed'`. Real API/SSE/native/reply-save reached;
this was not a missing-import/setup failure. Existing executable contract reused,
not mocked or weakened. Mandate: make all named frozen full-contract checks pass.
Parent/verifier independently reruns against read-only source with verifier-owned
temporary state and the approved canonical sandbox.

## Phase 1 — consolidated bounded impact / risk

Before editing, GitNexus upstream impact for
`test_actual_v2_sse_native_dom_ack_retry_reopen_one_provider`, file
`tools/dev/hermes_webui_receiver/test_real_rhythm_ack.py`, repo Rhythm,
includeTests=true returned `Target not found / UNKNOWN`. Caller/process blast
radius UNKNOWN, not zero. Reported before edit; no HIGH/CRITICAL rating returned.
The modified test method is the unittest entrypoint, not shared product wiring.

Reviewed entire intended surface: actual fixture preparation -> Rhythm HTTP V2/
SSE -> Subscriber/Inbox -> NativeAdapter -> copied native HTTP -> native saved
reply/journal -> periodic drain persistence -> actual browser renderer/receipt ->
native visible -> real Rhythm wrong-run ACK/reopen/retry. Native.observe requires
one submitted and one completed same-turn journal plus saved assistant bytes;
Receiver worker persists that observation on its separate one-second drain.
wait_reply only detects saved reply. Synchronizing on actual exact completed
status addresses the fixture contract; changing that qualifier/worker would be
an unapproved product change. Risks tested: no premature visibility, no wrong
identity completion, no second launch, no forged/foreign receipt, no lost local
receipt on ACK404, no foreign DB mutation, unchanged schema guards and migration.

## Phase 2 — current full GREEN, one implementation/check attempt

Cwd `tools/dev`:
```sh
env RHYTHM_LIVE_E2E=1 RHYTHM_SANDBOX_API_PORT=4898 DB_PATH=/private/tmp/hermes-event-notify-20261012-sandbox/rhythm.db HOME=/private/tmp/hermes-event-notify-20261012-sandbox/home RHYTHM_NATIVE_EVIDENCE_DIR=/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012/docs/ai/runs/artifacts/hermes-realack-readiness-20261013 python3 -B -m unittest hermes_webui_receiver.test_real_rhythm_ack -v
```
Observed `Ran 1 test in 8.263s / OK`. Actual completion history17 exact-identity
HTTP200/started responses, then HTTP200/completed; readiness elapsed1.065794583s.
This confirms the asynchronous boundary without a product edit. No failed new
assertion, second setup repair or broad repair was needed.

Current identity/evidence printed from actual test:
- eventId: `60f5a9bc-fef9-4575-ba35-7cda89d3bfb3`
- runId: `6330a658-5362-4523-97bf-15139b2c21fd`
- immutable Rhythm anchor: `0bf12086-5665-4c9f-b6a2-c0c6f982f734`
- native chat: `fixture-chat`
- inbox/journal event identityHash:
  `fcb97c18ecc2408f958652bc01f81093bbca432cdbe96f397d5d131d849afcc7`
- turnIdentity: `rhythm_fcb97c18ecc2408f958652bc01f81093bbca432cdbe96f397d5d131d849afcc7`
- saved assistant messageId/hash:
  `160830f24a4dc888f06dd7d30ce3632a02fa87ec9ac6fdcca60d79eefb77c60d`
- inbox: exactly one row, state completed before browser; proof messageIndex1.
  Journal exactly submitted, worker_started, assistant_started(index1), completed
  (index1), all same turn; submitted event/hash/run match inbox proof. No extra
  notification journal launch or completion observed.
- realDOM width732, height24.5, unobscured=true; qualifiedReceipts1;
  foreign and obscured PASS. Screenshot opened/reviewed: actual native reply is
  visible, no modal covering it, existing renderer/composer/sidebar present.
- exact native visible receipt:
  `{"version":2,"eventId":"60f5a9bc-fef9-4575-ba35-7cda89d3bfb3","runId":"6330a658-5362-4523-97bf-15139b2c21fd","hermesSessionId":"fixture-chat","state":"visible"}`
- All unchanged assertions passed: actual V2 events/SSE equality; foreign run/chat
  rejection; completed before DOM; provider1; foreign transcript empty; collision409;
  consumer reopen before DOM with no extra provider; real foreign/obscured/unobscured
  DOM receipt; actual wrong-run Rhythm ACK404 preserves local visible1; consumer
  reopen/retry commits actual correct Rhythm ACK; local tombstone2; remote event
  disappears; actual Rhythm DB state visible; both foreign workflows byte-identical;
  final provider1/foreign-empty. No fake ACK or DOM; only existing external provider
  boundary is deterministic fixture setup. This is isolated API/copied native
  qualification, NOT installed host or real-provider qualification.

### Frozen migration/reentrant/current-readonly/malformed checks

```sh
python3 -B -m unittest hermes_webui_receiver.test_inbox_migration_contract hermes_webui_receiver.test_inbox_migration_interrupt hermes_webui_receiver.test_receiver_reentrant_open_contract hermes_webui_receiver.test_initialization_lock_contract -v
```
Observed `Ran 11 tests in 10.602s / OK`: original migration5, frozen reentrant1,
supplementary schema/native initialization3, plus imported VisibleReceipts2.
Do not count those imported2 as new independent tests. Actual current read-only
open under writer and copied native drain/metadata/receipt preserve schema/version;
malformed current tables/columns/dependencies reject without writes. Existing
SQLite ResourceWarnings remain (unclosed connections in unchanged tests); not a
clean-warning claim, no unrelated repair made.

### Exact relevant native-visible30, explicitly excluding host tests

```sh
python3 -B -m unittest hermes_webui_receiver.test_native_visible_contract hermes_webui_receiver.test_visible_receipts hermes_webui_receiver.test_visible_reopen hermes_webui_receiver.test_visible_auth hermes_webui_receiver.test_repair_round1.RepairRound1.test_queued_profile_mutation_cannot_be_erased_to_authorize_launch hermes_webui_receiver.test_repair_round1.RepairRound1.test_saved_completion_is_not_forever_started hermes_webui_receiver.test_native_http hermes_webui_receiver.test_native_wakeup hermes_webui_receiver.test_native_browser test_hermes_webui_receiver test_hermes_notify_subscriber -v
```
Observed `Ran 30 tests in 66.890s / OK`. Same frozen selection as native-visible
run: 15 receiver/subscriber units + 10 existing native/profile/completion + 5 visible
checks. Includes actual auth/CSRF, replay/forgery/revocation, closed/foreign/obscured/
reopen and unobscured real renderer. No whole test_repair_round1/host fixture run.
Existing serviceWorker sandbox and git-info400 browser diagnostics remain;
14 external requests blocked. No clean-console or live host qualification claim.

## Native/product fingerprint and frozen assertion verification

Ran `python3 -B -m hermes_webui_receiver.verify_native_artifact` before and after:
`PASS: 7 patched outputs; all 107 original pins recovered exactly; Python/JS syntax verified`.
Additional actual set check:110 snapshot files =107 original pins + exactly
`api/rhythm_inbox.py`, `api/rhythm_notify.py`, `api/rhythm_schema.py`. Not a fabricated
107 total count. No builder invocation/regeneration.

Removed only the inserted readiness block in memory and hashed reconstructed
original full test: matches original frozen SHA256
`3c8f9d72fd3fe197d4e42bfee887fc79f06bb9895dfe58c43d18e9d3de4aa634`.
All original bytes/assertions/order unchanged. Final `git diff --check` passed.

SHA256 (product/artifact values confirmed identical before/after):
- receiver.py: `4d49279b04b5adf294103f9275c440cda6e8ec4fae01b5dd88da0d4846922d44`
- native.py: `52a90a9e785c3bde30cd11f766a3c861eedbaed738dcedc695478e75548df780`
- native.patch: `1f99fbf5a68258aebcf9d760fbce129afe561734521aa9fc4bf20c6a7ec06a3c`
- native_patch_manifest.json: `997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0`
- unchanged builder: `e16291f05ad4d1bc3f6b7530e4601bb2ccb4c7ab715f9f5234ba897349319224`
- unchanged real ACK DOM driver: `ff4d6627c728902220561908dd5bbe7ed2e7e03627fde039cc51e0444cb6a3ba`
- repaired real ACK Python test: `158281619ca6257eb566af2c94121d065201724037e47517d9462aa772ca766c`
- actual real ACK screenshot: `4068461fc5f27c3e4dd3562583edb24433a4a1a7e0c8dfaea78b9871f055aaa5`

## Canonical sandbox / exact exports / teardown

Fixture source DB/config verified0400 before up and after down; all3 ports free
before up. Launcher used unchanged own-worktree retained fork binary and built
API/MCP successfully. No manual launch/fork rebuild/product edit.
Exact same exports before both launcher invocations, cwd retained worktree root:
```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-event-notify-20261012-fixture
export RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-event-notify-20261012-fixture/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-event-notify-20261012-fixture/notifier-opencode.json
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-event-notify-20261012-sandbox
export RHYTHM_SANDBOX_API_PORT=4898 RHYTHM_SANDBOX_ENGINE_PORT=4897 RHYTHM_SANDBOX_GATEWAY_PORT=4899
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
export OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_DISABLE_EXTERNAL_SKILLS=1
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status
# After all tests, repeat identical exports above, normal launcher HOME:
tools/dev/sandbox.sh status && tools/dev/sandbox.sh down
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN
```
Up/status: API44587/engine44677/gateway44587; initial curl startup retry followed
by ready. Down/status same identities; sanitized diagnostics preserved at
`/private/tmp/hermes-event-notify-20261012-sandbox.evidence.XHishg`;
`Sandbox removed`. Explicit lsof no listeners on4898/4897/4899. Existing finally
contexts terminated/waited copied native and browser children; disposable HOME
state disposed. No cleanup of retained worktree or unrelated state.

## Independent handoff / remaining gate

READY_FORFINALINDEPENDENT_ACKgate only: full frozen actual real ACK now passes,
native30 and schema checks pass; implementer results are not independent approval.
Parent/verifier must independently run the same declared checks against these
unchanged native bytes and repaired test. Remaining host exact-manifest/native
identity proof must reconcile authoritative seven outputs and current manifest
`997524d5…`; old five-file/old inbox receipts cannot qualify. No host proof changed
or host checks run here. Planned ONE host restart/install stays HOLD until that
independent gate; no merge/deploy/runtime authorization inferred from this PASS.
