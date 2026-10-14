---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: BOUNDED_FAIL_REAL_ACK_STARTED_NOT_COMPLETED
tags: [run, rhythm]
---

# Initialization lock repair / real ACK gate — bounded FAIL

## Scope / approvals / phase entry

Explicit specialist handoff; retained sole writer worktree
`/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`,
HEAD `ee914fce` confirmed before edits and after validation. Acceptance-contract
loaded first, coding-agent second. Read AGENTS, project-state/current-plan and
nearest two-gap run plus receiver/native/builder and native fixtures. No peer
dispatch or workflow-orchestrator. Approval covers Receiver initialization/migration,
necessary internal schema validation, additive regression checks, regenerated
seven-output native artifact and actual isolated Rhythm ACK gate. Existing dirty
subscriber/consumer/repair work preserved. No renewed scope approval requested.

No host files, host manifest/proof, source_guard, builder, native authority checks,
frontend or frozen acceptance assertions edited. No commits/push, SSH, install,
host restart, live4001/4096/4198, real chat/card/credentials/config, remote provider,
Docker, shared dependency installation, relay/Tailscale or destructive cleanup.
Planned one restart/install remains HOLD. Parent owns final host reconciliation.

## Files / smallest repair

- `tools/dev/hermes_webui_receiver/receiver.py`: shared exact schema validator used
  in a read transaction; complete current version2 validation returns without
  BEGIN IMMEDIATE, DDL, user_version write or journal-mode write. Empty/malformed
  version2 rejects. Initialization/legacy migration still serializes with
  BEGIN IMMEDIATE and rereads version AND schema after acquisition. Another
  initializer's current schema returns without republishing. Original atomic
  rowid-preserving rebuild, constraints, rollback and constructor close retained.
  `synchronous=FULL` remains connection-local. Authority checks remain inside
  drain/metadata/receipt protected transactions, unchanged.
- `test_initialization_lock_contract.py`: supplementary current read-only open
  under writer, invalid current columns/missing table/index/FK/schema negatives,
  actual copied native drain/metadata/receipt without schema publication. Original
  concurrent-startup and five migration tests retained unchanged.
- `native.patch`, `native_patch_manifest.json` and seven `source_snapshot` outputs
  regenerated through UNCHANGED builder; only `api/rhythm_inbox.py` output differs
  from preceding artifact. No eighth output; original107 pins unchanged.
- This note and auxiliary native-only screenshot below. No real-ACK screenshot.

## Phase 0 — actual RED / fixed contract

Cwd `tools/dev`, command:
```sh
python3 -B -m unittest hermes_webui_receiver.test_receiver_reentrant_open_contract -v
```
1 ERROR / 10.721s. Actual stack: frozen test17 -> Receiver.__init__53 ->
Receiver._migrate75 -> `BEGIN IMMEDIATE` ->
`sqlite3.OperationalError: database is locked`. Two actual SQLite connections,
current user_version2, caller holds write lock. This RED preceded implementation.
Mandate: unchanged reentrant + five migration + real ACK checks must pass; new
supplementary regressions were added after root implementation, not claimed RED.
Independent parent/verifier can rerun against read-only artifact with verifier-owned
temporary state. Real gate requires the approved sandbox and isolated copied native
fixture. No old PASS reused for this identity.

## Phase 1 — consolidated impact / risk

GitNexus upstream impact for `_migrate` and Receiver in receiver.py, repo Rhythm:
Target not found / risk UNKNOWN. Not proof of zero callers/processes. Full receiver
and native read: constructor callers include Capability handle/worker, startup,
Native.current_binding, metadata/receipt and tests. Drain260/262 holds a write
transaction while native.current_binding54 opens Receiver; metadata186 -> observe
and receipt214/224 have equivalent nested authority reads. Reviewed original schema
and concurrent/interrupt tests plus actual native fixture and unchanged builder.
Risk: version alone cannot authorize malformed schema; stale startup snapshot
cannot authorize a rebuild; byte/rowid/leases/nonces/tombstones must survive; saved
reply is not visible. One consistent read snapshot, serialized reread, frozen
rollback/concurrency checks and actual native HTTP checks address these risks.
Reported UNKNOWN graph coverage to parent before edits; no HIGH/CRITICAL result.

## Phase 2 — actual commands/results

Cwd `tools/dev` unless stated:
```sh
python3 -B -m unittest hermes_webui_receiver.test_receiver_reentrant_open_contract hermes_webui_receiver.test_inbox_migration_contract hermes_webui_receiver.test_inbox_migration_interrupt -v && python3 -B -m hermes_webui_receiver.build_native_patch && python3 -B -m hermes_webui_receiver.verify_native_artifact
```
6 tests / OK / 0.033s: frozen reentrant and all5 migration checks GREEN on first
source repair. Builder generated seven outputs. Verifier PASS all107 original
pins recovered exactly and Python/JS syntax. No timeout increase or authority move.

```sh
python3 -B -m unittest hermes_webui_receiver.test_initialization_lock_contract hermes_webui_receiver.test_receiver_reentrant_open_contract hermes_webui_receiver.test_inbox_migration_contract hermes_webui_receiver.test_inbox_migration_interrupt test_hermes_notify_subscriber test_hermes_notify_repair test_hermes_webui_receiver -v
```
42 tests / OK / 10.539s. Includes original36, reentrant1, added3, and2 accidentally
rediscovered imported VisibleReceipts tests. Existing/imported unit cases are not
42 independent end-to-end scenarios. ResourceWarnings for unclosed SQLite contexts
occur; not silently treated as clean output. Actual native completed -> metadata ->
receipt -> visible passes; schema_version, user_version and sqlite_master unchanged.

```sh
python3 -B -m unittest hermes_webui_receiver.test_native_http hermes_webui_receiver.test_native_wakeup hermes_webui_receiver.test_native_browser hermes_webui_receiver.test_visible_auth hermes_webui_receiver.test_visible_receipts hermes_webui_receiver.test_visible_reopen hermes_webui_receiver.test_repair_round1 hermes_webui_receiver.test_native_visible_contract -v
```
17 tests / 16 pass / 1 FAIL / 68.314s. This is NOT a native30/all-green claim.
**Process deviation:** selecting whole test_repair_round1 inadvertently included
its disposable fake-restart host installer test, outside the requested host-test
exclusion. It failed before installation: test110 -> host_job.run274 ->
validate_manifest147 -> ValueError `unknown or incomplete deployment fields`,
then test112 AssertionError `Exact native patch rejected before installation`.
No host runtime operation or host file edit performed; no attempted repair or
manifest force. Parent must separately reconcile the stale five-file fixture.
Native real HTTP, wakeup, browser/auth/CSRF, receipt forgery/replay, closed/foreign/
obscured/reopen and exact unobscured renderer visible tests passed.

### Real ACK — both bounded attempts FAIL, no third attempt

With exact exports below, same command twice:
```sh
python3 -B -m unittest hermes_webui_receiver.test_real_rhythm_ack -v
```
Attempt1: 1 FAIL / 2.589s. Attempt2: 1 FAIL / 2.424s. Exact final stack:
```text
test_real_rhythm_ack.py:70
 self.assertEqual(server.post(event, path='status')[1]['state'], 'completed')
AssertionError: 'started' != 'completed'
- started
+ completed
```
Actual Rhythm fixture creation -> real eventsV2/SSE -> subscriber -> NativeAdapter
-> copied native HTTP -> actual worker/reply save reached. Status now returns
promptly, not nested lock timeout. Reply-save detection does NOT establish the
next drain observation has persisted completed. Frozen test70 samples status
immediately after wait_reply69. No test timing/assertion change, extra callback,
fake ACK, timeout increase or unrelated source fix made. Cause beyond observed
save/observation timing is not declared independently proven. Stopped after2
real-gate attempts. Real DOM/visible/API ACK/retry/tombstone/foreign-store final
assertions after70 are NOTRUN. EventHash/store-ID equality and no-extra-journal
qualification remain NOTRUN, not inferred from auxiliary tests.

Auxiliary command (not a third real ACK attempt):
```sh
RHYTHM_NATIVE_EVIDENCE_DIR=/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012/docs/ai/runs/artifacts/hermes-lockrepair-realack-20261013 python3 -B -m unittest hermes_webui_receiver.test_native_visible_contract -v && python3 -B -m hermes_webui_receiver.verify_native_artifact
```
1 test / OK / 2.461s; actual native renderer width732/height24.5, hit actual reply,
unobscured=true, exact fixture-event/fixture-run/fixture-chat receipt visible.
Screenshot `artifacts/hermes-lockrepair-realack-20261013/red-live.png` (frozen
driver filename, despite this auxiliary PASS), SHA256
`e497d897ed8d7d947b6e2449badc7449481782d59f35307be05afba595c6f368`.
This is native-only evidence, NOT real Rhythm ACK. serviceWorker sandbox and
git-info400 diagnostics remain. Final verifier PASS7/107; git diff --check passed.

## Exact sandbox env / build / teardown

Same exports explicitly set before launcher commands (repo root):
```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-event-notify-20261012-fixture
export RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-event-notify-20261012-fixture/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-event-notify-20261012-fixture/notifier-opencode.json
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-event-notify-20261012-sandbox
export RHYTHM_SANDBOX_API_PORT=4898 RHYTHM_SANDBOX_ENGINE_PORT=4897 RHYTHM_SANDBOX_GATEWAY_PORT=4899
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
export OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_DISABLE_EXTERNAL_SKILLS=1
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status
# Both real ACK commands additionally:
export RHYTHM_LIVE_E2E=1 DB_PATH=/private/tmp/hermes-event-notify-20261012-sandbox/rhythm.db
export HOME=/private/tmp/hermes-event-notify-20261012-sandbox/home
export RHYTHM_NATIVE_EVIDENCE_DIR=/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012/docs/ai/runs/artifacts/hermes-lockrepair-realack-20261013
# Teardown shell does NOT use test HOME; repeats sandbox exports above:
tools/dev/sandbox.sh status && tools/dev/sandbox.sh down
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN
```
stat verified both approved source fixtures0400. Stock sandbox.sh unchanged;
canonical up built API and MCP successfully and reused retained own-worktree fork
dist/opencode-darwin-arm64 (no fork modifications/rebuild or manual launch).
API73198/engine73293/gateway73198. Down preserved sanitized diagnostics at
`/private/tmp/hermes-event-notify-20261012-sandbox.evidence.WCK8KM`, removed sandbox,
lsof no listeners on all3 owned ports. Native fixture children terminated/waited
by finally contexts. Original fixtures unchanged; copied native/temp HOME disposed.

## Fingerprints / remaining STOP / independent handoff

SHA256:
- receiver.py: `4d49279b04b5adf294103f9275c440cda6e8ec4fae01b5dd88da0d4846922d44`
- native.patch: `1f99fbf5a68258aebcf9d760fbce129afe561734521aa9fc4bf20c6a7ec06a3c`
- native_patch_manifest.json: `997524d5bf0b3b7ef2adbac73bad7ea62533eafb154b6ac1a774698b124844d0`
- api/rhythm_inbox.py: `e89406af68a793e86eefd75d9bf4ada8371d438e7e5a19d80e189ac7688e6812`
- unchanged builder: `e16291f05ad4d1bc3f6b7530e4601bb2ccb4c7ab715f9f5234ba897349319224`
- unchanged real ACK test: `3c8f9d72fd3fe197d4e42bfee887fc79f06bb9895dfe58c43d18e9d3de4aa634`
- unchanged frozen reentrant: `ed6c7ad962de283082d16090b64c2ca6e4813264c79356f9665a8401c3b6a3ad`
- new regression: `07bd4bf67deb2123742342535f10eb80ca5526920f7821439ca05d54157d2282`

Seven manifest after-hashes authoritative; six other native outputs unchanged.
Parent host exact-native proof must be refreshed against NEW inbox hash; do not
reuse old manifest receipts or forge hashes. Independent verifier owns rerunning
checks; this agent's results are not independent qualification. Current real ACK
RED prevents READY_FOR_FINAL_INTEGRATION_INDEPENDENT_GATE. Stop inputs: bounded
new handoff needed for save/drain-completed synchronization defect/test boundary,
then entire actual DOM/ACK/retry/hash/journal matrix, native30 scope reconciliation,
parent seven-output host integration and fresh independent gate. No further repair
or docs-only attempt in this run. **BOUNDED_FAIL; install/restart HOLD unchanged.**
