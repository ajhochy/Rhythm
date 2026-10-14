---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: FAIL_REAL_ACK_NESTED_MIGRATION_LOCK
tags: [run, rhythm]
---

# Final two integration gaps — FAIL, not READY_FOR_INTEGRATIONGATE

## Scope / carried approvals

Explicit specialist handoff, sole native/subscriber/test writer, retained dirty
worktree `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`,
HEAD `ee914fce`. Loaded acceptance-contract first, coding-agent second. Read AGENTS,
project-state/current-plan, native-visible implementation and actual native source.
Parent-reported native gate8a0 PASS and hostgateb90 ACTIVE are prior-head evidence,
not evidence for this changed artifact. No peers/orchestrator invoked.

Approved scope: receiver scratch SQLite migration plus real Rhythm subscriber/native
ACK fixture and necessary shared internal functions. No new scope approval needed.
HOST implementation/tests/manifest integration were not edited or run. All old
tests, original107 source pins and their assertions retained. Existing unrelated
consumer/test_repair dirty edits preserved. No commits/push, Pi SSH/install/restart,
live4001/4096/approval4198, user chat DB migration, credentials rewrite, real provider,
MCP tool operations, internet/relay/Tailscale or shared dependency installation.
Canonical sandbox teardown is the only disposable runtime removal performed.

## Files

Implementation:
- `tools/dev/hermes_webui_receiver/receiver.py`: exact known legacy/current schemas,
  transactionally copied/rebuilt inbox CHECK with completed, user_version2, rowid
  preservation, rollback/close on error; unknown schema/version/dependencies fail
  closed. Ancillary tables untouched. Old launching/started unchanged, no inferred
  launch/replay/visibility; current native qualifier remains authoritative. Also
  skip a denied retired link rather than veto all valid native runs.
- `tools/dev/hermes_notify_subscriber.py`: shared Inbox.drain reconstructs mutable
  `state: accepted` envelope from stored state-independent immutable identity.
- Generated `native.patch`, `native_patch_manifest.json`, seven source_snapshot
  outputs through unchanged builder. Only `api/rhythm_inbox.py` changed output bytes.
  No eighth output, production test feature or original source pin change.

New tests/fixtures:
- `test_inbox_migration_contract.py`: frozen legacy CHECK/full bytes/reopen/state,
  concurrent open/empty/version idempotence/read-only/unknown schema.
- `test_inbox_migration_interrupt.py`: actual SQLite authorizer refusal after copy
  rolls back DDL/data/version; sparse rowids and unknown version retention.
- `prepare_real_ack.mjs`: actual Repository/RecipeWorkflowRunner/dispatcher create
  three independent workflows with repair/retry, immutable legacy anchor and new
  current membership; bind through actual Rhythm HTTP. Only recipe engine boundary
  uses synthetic fixture session/results, as in existing actual runner fixtures.
- `test_real_rhythm_ack.py`: actual eventsV2/SSE/Subscriber/NativeAdapter/native HTTP,
  intended DOM/ACK retry/reopen/tombstone/foreign records assertions. No receive/ACK
  mocks. Credentials come only from synthetic sandbox copy; never printed.
- `test_real_ack_dom.mjs`: actual existing renderer, foreign chat/real modal,
  automatic receipt, geometry/hit-test and intended screenshot. **NOT REACHED.**
- `test_receiver_reentrant_open_contract.py`: final frozen real-SQLite lock blocker.
- This run note. Screenshot directory created under
  `docs/ai/runs/artifacts/hermes-two-gaps-20261013/`, but **no screenshot generated**.

## Phase 0 — actual RED contracts

Commands below use `tools/dev` as cwd except sandbox commands (repo root) and
`npm run build` (`apps/api_server`). Skills loaded before any source edits.
Each feature's behavioral RED preceded its implementation; migration work began
before the separate integration RED was run (not a claim of one combined upfront RED).

```sh
python3 -B -m unittest hermes_webui_receiver.test_inbox_migration_contract -v
```

Observed 3 tests / 3 failures, 0.019s: version remained0 on old/reopened/concurrent
DBs, unknown extra-column schema accepted. Test also executes old completed UPDATE
and observes actual SQLite CHECK refusal before any Receiver open. Frozen checks
are the mandate; assertions were not weakened during repairs. Initial fixture SQL
placeholder typo corrected before this first valid behavioral RED/freeze.

```sh
# With sandbox exports below + LIVE_E2E/DB_PATH/HOME:
python3 -B -m unittest hermes_webui_receiver.test_real_rhythm_ack -v
```

Observed 1 test ERROR / 1.547s: actual SSE -> consumer.receive -> Inbox.drain ->
NativeAdapter.record -> validate: `ValueError: unsupported notification schema`.
Stored identity deliberately excludes state; old drain passed it as a full event.
This is a real wiring failure, not an import/missing fixture failure.

## Phase 1 — consolidated impact/risk review

GitNexus upstream impact for Receiver and drain in receiver/subscriber returned
`Target not found`, risk UNKNOWN. Not zero callers/zero risk. Reviewed entire
Receiver, Capability handle/start/drain, native current_binding/observe/browser
receipt/startup/callsites, NativeAdapter validation/delivery, Subscriber Inbox/
receive/ACK/run, builder/manifest, actual Rhythm notification routes/service and
existing actual WorkflowRepository/runner fixture. Exact caller lookups found
native current_binding/startup/browser handlers, Capability handlers/worker,
Subscriber receive/heartbeat/recovery and existing focused tests.

Risks: immutable byte/row ordering retention; unknown schema must not be rewritten;
lease expiry must not replay uncertain work; saved completion is not visible;
local receipt survives ACK failure; owner/current run membership must not be
inferred from immutable anchor; nested native authority rechecks open additional
DB connections. Last risk materialized below. No HIGH/CRITICAL graph result, host
permission denial or security bypass involved.

## Phase 2 — two attempts per criterion, stopped on final failure

Migration attempt1:
```sh
python3 -B -m unittest hermes_webui_receiver.test_inbox_migration_contract -v
```
3 tests / 2 errors / 0.042s: SQLite ALTER RENAME persisted quoted table name and
exact schema normalization denied reopen. Second repair accepts that known name
and copies explicit rowids. Final migration check:
```sh
python3 -B -m hermes_webui_receiver.build_native_patch &&
python3 -B -m unittest hermes_webui_receiver.test_inbox_migration_contract hermes_webui_receiver.test_inbox_migration_interrupt -v &&
python3 -B -m hermes_webui_receiver.verify_native_artifact
```
5 tests / OK / 0.037s. All four seeded old states unchanged byte-for-byte and
rowid-for-rowid on migration/reopen; completed is legal, unknown state rejected;
proof/nonce metadata, inactive immutable links and ancillary ACK/tombstone bytes
preserved. Actual denied-DROP interruption publishes no partial table/version.
This proves scratch schema behavior, **not runtime migration qualification**.

Integration attempt1 after envelope repair: 1 FAIL / 11.418s, native reply not
saved. Retained old fixture link absent from registry aborts entire native drain.
Second repair skips Denied at per-link authority selection without altering row
state/credentials or guessing effects. Final integration attempt: 1 ERROR /
12.310s. Reply save was reached (wait_reply returned), then actual native status
request timed out after5s. **No DOM, visible receipt or real visible ACK completed.**

Focused final failure trace (no third repair):
```sh
python3 -B -m unittest hermes_webui_receiver.test_receiver_reentrant_open_contract -v
```
1 ERROR / 10.329s: `sqlite3.OperationalError: database is locked` at
Receiver._migrate BEGIN IMMEDIATE. Reproduces actual
`Receiver.drain -> BEGIN IMMEDIATE -> native.current_binding -> Receiver(path)`
with two real SQLite connections, already at version2. Unconditional migration
write locking on every open self-blocks the authority recheck. **Do not install
this artifact.** Next bounded repair must validate already-current schema without
starting a migration write transaction; actual migration still needs serialized
transaction/recheck. Then independently rerun all frozen checks; proposed fix is
not implemented here because two integration repair attempts are exhausted.

Final adjacent validation:
```sh
python3 -B -m unittest hermes_webui_receiver.test_inbox_migration_contract hermes_webui_receiver.test_inbox_migration_interrupt test_hermes_notify_subscriber test_hermes_notify_repair test_hermes_webui_receiver -v &&
python3 -B -m hermes_webui_receiver.verify_native_artifact && git diff --check
```
36 tests / OK / 0.183s (includes imported duplicate unit cases; not36 independent
end-to-end scenarios). Existing mocked unit tests emit unclosed SQLite resource
warnings. Verifier PASS7 outputs/all107 original pins/Python+JS syntax. Diff check
passed. Prior native30+42 gate was not rerun as a new-head PASS. No qualified
completed-to-visible migration runtime test or complete adversarial real-ACK
matrix can be claimed; subsequent assertions in the real contract were NOTRUN.

## Exact sandbox environment / commands / teardown

Used unchanged canonical tools/dev/sandbox.sh only, same variables for up/status/
down. Retained own worktree fork binary reused; no fork/source/dependency change.
Existing approved fixture files verified0400. API `npm run build` passed; canonical
up rebuilt API/MCP and reused retained fork. No manual API/engine launch.

```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-event-notify-20261012-fixture
export RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-event-notify-20261012-fixture/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-event-notify-20261012-fixture/notifier-opencode.json
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-event-notify-20261012-sandbox
export RHYTHM_SANDBOX_API_PORT=4898 RHYTHM_SANDBOX_ENGINE_PORT=4897 RHYTHM_SANDBOX_GATEWAY_PORT=4899
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export OPENCODE_DISABLE_MODELS_FETCH=1 OPENCODE_DISABLE_AUTOUPDATE=1 OPENCODE_DISABLE_PROJECT_CONFIG=1 OPENCODE_DISABLE_EXTERNAL_SKILLS=1
export OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status
# For each of three real-contract invocations above, also exported:
export RHYTHM_LIVE_E2E=1 DB_PATH=/private/tmp/hermes-event-notify-20261012-sandbox/rhythm.db
export HOME=/private/tmp/hermes-event-notify-20261012-sandbox/home
export RHYTHM_NATIVE_EVIDENCE_DIR=/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012/docs/ai/runs/artifacts/hermes-two-gaps-20261013
# Teardown from a shell retaining sandbox variables, not the test HOME:
tools/dev/sandbox.sh status; tools/dev/sandbox.sh down; tools/dev/sandbox.sh status
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN
```

Up/status: API PID2337 on4898, engine PID2436 on4897, gateway PID2337 on4899.
Down: diagnostics `/private/tmp/hermes-event-notify-20261012-sandbox.evidence.zRJTIO`,
`Sandbox removed`. Post-down status refuses absent security shim (directory is
gone), not a runtime failure. Explicit lsof returned no listeners on all3 ports.
Native fixture children terminated/waited via existing finally context; no browser
was launched because final failure preceded DOM stage. Synthetic temporary state
disposed. Sanitized source fixtures remain unchanged/read-only.

## Exact artifact / independent parent handoff

Final patch SHA256 `7bfbcc0b1cb77ec7d7f06013bb7d42ac7f62d00ba77dcf167e4a08dd4ccada66`.
Manifest SHA256 `c15b9387dca12b8e21dd9a49bcccc729ffd7742abab71a8e0c7336376253d857`.
Changed native output `api/rhythm_inbox.py` SHA256
`f699cd0beeced3444b69e338d4d41e8868061a0df170b18b28d4b1c6555a1a6c`.
Native module/builder/UI/models/routes/schema outputs retain preceding hashes.

Parent notified in progress and here: native output identity changed, so hostgate
exact-native proof is invalidated; host algorithm-only tests remain meaningful.
Host parent owns final seven-manifest reconciliation; no host manifest/proof
update attempted. source_guard/install/restart hold remains; artifact not qualified.

Independent parent/verifier can run frozen migration and reentrant tests against
read-only source with verifier-owned temporary databases; live test requires
canonical approved isolated sandbox and build fixture setup. Make unchanged checks
pass, do not weaken them. No live runtime restart/install until a fresh independent
gate. **FAIL_REAL_ACK_NESTED_MIGRATION_LOCK; both criteria are not resolved.**
