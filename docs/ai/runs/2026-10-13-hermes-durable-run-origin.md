---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: QUALIFIED_PASS_RHYTHM_ARCHITECTURE_PI_BLOCKED
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Separately approved durable-run origin architecture

## Scope / contract

Explicit parent handoff and AJ approval supersede only the old session-as-run-origin
architecture/repair ceiling. Sole writer; HEAD18c5359658e580b8d86ea1bca848858bbcd2eabf
and all13 retained dirty paths preserved. Max two repairs per new criterion.
Loaded acceptance-contract first, coding-agent second; mandatory memory and entire
1153-line coordinator/native run read. Historical latest95 =94PASS/1FAIL, not green.
No orchestrator/peers. Parent independently verifies read-only source with disposable
runtime writes; parent owns commits/push. Pi source inspection remains parent's child.

Permitted surface: notifier service/schema, notifier router/API, subscriber contract,
actual runner-backed additive contracts, authorized retry-fixture correction, this
dedicated note. Registry/runner are read/invoked, not repaired or duplicated. No PR1615
approval/card edits, live DB/production migration, native activation, SSH, new ports,
relay/Tailscale changes, restart/recreate installed services, shared installs, real AJ
messages, drive/email/billing/desktop signatures, destructive cleanup, commit/push.
All Rhythm runtimes use stock sandbox up/status/down and approved four paths/0400
fixtures/4898,4897,4899; no manual API or4001/4096/4198.

Fixed executable contract: tools/dev/hermes_notify_run_origin_live.mjs (3 independent
Encompass-security-map/Rhythm-notify-approval/Opus-review cases). Uses actual
RecipeWorkflowRunner + createAgentRunnerDispatcher + repositories/SQLite and HTTP;
only engine boundary is safely injected, not notifier/coordinator. Real gate repair
resets old attempt, dispatches new session, proves both bindings and fresh attempt ID.
Expected: old v1 history/ACK revoked; explicit owner-authorized v2 run-origin binding
accepts new exact attempt without409, retains original conversation/IDs/cursors/states,
recovers pending history, rejects stale/arbitrary session/refbind/invalid auth/owner
transfer, and publishes one terminal only after actual runner completion. Mandate:
make frozen assertions pass, do not weaken them. Native Pi remains separate BLOCKED.

## Phase 0 — RED before implementation

Command environment E is identical to prior coordinator run94–105 plus
RHYTHM_LIVE_E2E=1. At root: stock up && status; env HOME="$RHYTHM_SANDBOX_DIR/home"
DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db" RHYTHM_OPENCODE_ENGINE_PORT=4897
RHYTHM_MOBILE_GATEWAY_PORT=4899 PROD_API_URL=http://127.0.0.1:4898
node --test tools/dev/hermes_notify_run_origin_live.mjs; capture result; stock down.
First RED0PASS/3FAIL showed2!=3 because dispatcher intentionally catches assertion
errors; before any implementation added diagnostic propagation (no assertion change).
Final RED0PASS/3FAIL exact404!=201 at v2 run origin endpoint after actual second
dispatch. API23904/engine23998; down0; diagnostics .evidence.TuILSZ (initial.LSpu3E).
Both fixtures0400 verified; initial sandbox absent/ports free. API build passed;
MCP --noCheck is not typecheck. Existing unchanged prebuilt fork reused.

## Phase 1 — consolidated review

Read complete service/router/subscriber, runner717lines and repository526lines;
reviewed existing callers via exact references: bootstrap initialize/start/stop;
origin HTTP→bind, GET/SSE→list→projection, hub→ingest, ACK→ack, all retained fixtures.
GitNexus query located actual registry/dispatcher. Impact service with class-member
edges, router, subscriber, old workflow contract: all target-not-found, UNKNOWN.
API impact router: no indexed routes. This is missing index coverage, not zero risk.
No HIGH/CRITICAL returned. Consequential risks: adopting arbitrary sessions, stale
attempt authority, migration guessing a conversation, owner transfer, two concurrent
origin assignments, false terminal and raw status/verdict leakage. Proportionate
actual runner/revocation/migration/security/regression checks required.

Architecture: additive run-origin authorization metadata only, not lifecycle tracker.
Existing journal/FK storage anchor remains immutable historical identity; v2 delivery
authority belongs to exact immutable run owner, not anchor's current attempt. V1 stays
fail-closed and cannot read/ACK v2 history. Explicit owner-existing-run contract requires
exact current two-sided stage/session membership for origin registration/reaffirmation;
opaque client workflowId alone is never authority. Legacy durable correlations are
quarantined automatically, never guessed/promoted; explicit owner activation validates
unique matching legacy tuple. Ambiguous/inconsistent legacy origins error, no reassignment.
Run projection checks every present current session binding; pending unbound reset is
not a new authority, but owner may recover past journal and see pending registry state.
Current attempt remains necessary for incoming engine events; no old-session ACK via run.
Runner recordCompletion/commitSession and processAgent late writes are not cancellation
fenced despite comments. Do not broaden scope: projection must withhold success with
cancelledAt, failed/repair/unknown/gate verdicts or child pending; approval COALESCE
cannot clear stale pending ID and remains conservatively withheld. Question/permission
engine IDs are not qualified canonical cards. Native storage is not wake/visibility.

## Files / checks / handoff

## Phase 2 — completed, bounded repairs and actual outcomes

Initial implementation/runner validation GREEN:3 new runner cases, corrected old
workflow5, subscriber2; `RUN_ORIGIN_GREEN1 checks=0 teardown=0`, API65250/engine65357,
diagnostics `.evidence.jqTTbQ`. Subscriber RED before subscriber edit was1PASS/1ERROR,
`unsupported notification schema` for valid v2 event; fixed checks both pass.

New adversarial/migration contract initially6PASS/1FAIL: moved origin stage to a
different run still allowed read, `Missing expected exception.` at79. Exact E;
up/status/backup run-safety.db; env isolated HOME/DB_PATH node --test
tools/dev/hermes_notify_run_origin_contract.mjs; capture result/down. API83321/
engine83426; `RUN_SAFETY checks=1 teardown=0`, diagnostics `.evidence.KwOhs5`.
Membership repair1 adds immutable origin-stage reference, not a lifecycle tracker.
First full aggregate108PASS (95 retained+13 new), down0, `.evidence.S66loj`;
API5172/engine5266, owned restart8965/9033. Historical, before final one-line guard.

Final review exposed same-run sibling substitution: added one independent named
assertion before repair, preserving all existing frozen assertions. Exact E;
up/status/backup sibling-red.db; env isolated HOME/DB_PATH node --test
--test-name-pattern='same-run sibling' tools/dev/hermes_notify_run_origin_contract.mjs;
capture result/down.0PASS/1FAIL `Missing expected exception.` at106, API27697/
engine27801; `EXACT_STAGE_RED checks=1 teardown=0`, `.evidence.sQScBk`.
Membership repair2 requires each current session's reverse binding to match the
EXACT stage being inspected, not merely any sibling in the same run. Maximum two
membership repairs respected; no further product repair loop. Final full109 below
passes this same frozen test and all prior95; no assertion weakened to avoid409.

### Exact changed files (this continuation, beyond retained13)

- `apps/api_server/src/services/hermes_notify_service.ts`: additive authorization
  metadata, explicit bindRun/listRun/ackRun; shared v2 current-registry authority,
  run-owned projection/store, no new lifecycle/attempt scheduler/cache/tracker.
- `apps/api_server/src/routes/hermes_notify_routes.ts`: authenticated v2 run origin,
  pending-event replay/ACK and run-scoped existing SSE transport; auth unchanged.
- `tools/dev/hermes_notify_subscriber.py`: explicit opt-in run mode and v2 validation/
  receipt identity, no native adapter, listener or fake Hermes implementation.
- `tools/dev/hermes_notify_workflow_contract.mjs`: authorized actual-runner retry
  fixture correction; all five named checks and original running-publication
  assertion retained. Adds actual fresh dispatch, v1 history/ACK isolation and
  original conversation/IDs/cursors assertions. Never rebinds old session.
- Added `tools/dev/hermes_notify_run_origin_live.mjs` (3 runner-backed HTTP cases),
  `tools/dev/hermes_notify_run_origin_contract.mjs` (8 migration/security cases),
  `tools/dev/hermes_notify_run_engine_live.mjs` (1 real fork event/SSE/concurrency
  case and separate before/after restart receipt),
  `tools/dev/test_hermes_notify_run_origin.py` (2 v2 schema/inbox cases), this run.

Final19 dirty paths = all13 retained + router + five additive files. Old coordinator
note, journal/guard/revocation/terminal/workflow-live/Python workflow/native artifacts
untouched in this continuation. No project-state/current-plan overwrite.

### Exact schema / migration / authorization contract

Schema is initialized only by the existing local SQLite notification service seam.
New `hermes_notify_run_origins` columns:

| Column | Definition / semantics |
|---|---|
| run_id | TEXT PK, FK recipe_workflow_runs(id), actual durable run identity |
| owner_user_id | INTEGER nullable for quarantine, immutable actual owner when active |
| session_id | TEXT UNIQUE FK hermes_notify_origins(session_id), historical journal anchor ONLY |
| hermes_session_id | TEXT nullable for quarantine, immutable original conversation when active |
| stage_execution_id | TEXT nullable for quarantine, immutable origin-stage existence fence |
| state | TEXT NOT NULL CHECK quarantined/active, authorization state, NOT run lifecycle |

Idempotent INSERT OR IGNORE backfills matching legacy run IDs as quarantined with
NO inferred owner/conversation/anchor. Explicit authenticated owner activation
checks a real current two-sided registry session, a claimed nonempty current
attempt ID, and a unique matching legacy owner/Hermes/session-stage tuple. Multiple
or inconsistent legacy rows error404/409, never guessed/reassigned. Active rows
cannot be overwritten by another attempt, owner or conversation. Incomplete earlier
dev metadata gains stage_execution_id by additive ALTER and is quarantined if
missing its stage fence; no inference from opaque IDs. Existing origin/event tables,
IDs/cursors/source keys/ACK states are neither rebuilt nor backfilled/rewritten.
No migrations.ts/Postgres/bootstrap/production/live database migration performed.

API (all paths under `/hermes-notify`, unchanged requireAuth owner-bound bearer):

- POST `/runs/:runId/origin` body `{sessionId,hermesSessionId}`: explicit owner-existing-
  run grant. Requires current exact two-sided session/stage binding; response201
  `{version:2,runId}`. Fresh legitimate attempts reaffirm the same run conversation;
  stale/arbitrary/other-run session404; another chat409. No client-supplied owner,
  opaque workflowId grant or lifecycle transition accepted.
- GET `/runs/:runId/events?after=CURSOR`: `{version:2,runId,events}`; existing journal
  events gain explicit `version:2,runId`, retaining sessionId as historical anchor
  and workflowId equal to actual runId.100 pending/accepted rows, ordered stable
  cursors. Active origin + immutable actual run owner + current bound-stage/session
  membership are rechecked. Reset with no bound current session does not make old
  session authoritative; legit run owner can recover pending history and registry
  progress while awaiting a new dispatch. Malformed present binding/stage relocation/
  owner transfer/unknown run status denies read/ACK. Visible events omitted.
- POST `/runs/:runId/ack` body `{eventId,state:accepted|visible}`: same run authority,
  exact event's run/anchor required, wrong-run/owner/event404. Existing monotone
  accepted/visible state semantics; no session ID grants or replies/actions.
- GET `/stream?runId=ID`: existing SSE, preflights v2 authority before headers and
  rechecks on each flush; revoked/mismatched run ends replay rather than leaking.
- V1 remains version1; active v2 history is excluded BEFORE LIMIT100 and v1 ACK
  returns404 even while original attempt is current. Unactivated legacy v1 requires
  current session authority. Opaque legacy correlation never qualifies terminal.

Incoming events still require current exact actual registry session/run/stage
membership; old SDK session after reset cannot project or signal. V2 owner delivery
authorization is not a session credential. All current linked stages are checked;
same-run sibling substitution cannot pass merely through run membership. Verdict
allowlist/status sanitation/no-idle-success/changed-verdict dedup/approval and child
withholding remain unchanged and tested. Source lifecycle writes remain registry-
owned, including documented cancellation/approval-clearing limitations.

Subscriber `--run-id ID` opts into v2 run-owned GET/ACK/SSE; no run ID uses v1 only.
V2 runId must equal workflowId; schema version/fields are exact. `owns(event)` remains
an operator adapter's trusted owner/run/original-conversation registry check, never
remote-origin adoption. V2 visible receipt must contain version2,eventId,runId,
hermesSessionId,state=visible; ingestion alone is only accepted. No native adapter
is shipped. V1 inbox payloads cannot silently become v2 (identity mismatch is
fail-closed); use a separate version-qualified v2 inbox rather than delete/rewrite
old tombstones. Native adapter migration/visible receipt remains unqualified.

### Exact final full check command (worktree root)

```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-event-notify-20261012-fixture
export RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-event-notify-20261012-fixture/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-event-notify-20261012-fixture/notifier-opencode.json
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-event-notify-20261012-sandbox
export RHYTHM_SANDBOX_API_PORT=4898 RHYTHM_SANDBOX_ENGINE_PORT=4897 RHYTHM_SANDBOX_GATEWAY_PORT=4899
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1 RHYTHM_LIVE_E2E=1
test ! -e "$RHYTHM_SANDBOX_DIR" &&
(lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN; test $? -eq 1) &&
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status && (
  set -e
  export HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db"
  export RHYTHM_OPENCODE_ENGINE_PORT=4897 RHYTHM_MOBILE_GATEWAY_PORT=4899 PROD_API_URL=http://127.0.0.1:4898
  for contract in revocation guard journal terminal workflow run_origin; do
    sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/$contract-durable-green.db'"
    env DB_PATH="$RHYTHM_SANDBOX_DIR/$contract-durable-green.db" node --test "tools/dev/hermes_notify_${contract}_contract.mjs"
  done
  node --test tools/dev/hermes_notify_acceptance.mjs tools/dev/hermes_notify_live.mjs
  node tools/dev/hermes_notify_restart.mjs before
  node --test tools/dev/hermes_notify_run_engine_live.mjs
  tools/dev/sandbox.sh restart
  tools/dev/sandbox.sh status
  node tools/dev/hermes_notify_restart.mjs after
  node tools/dev/hermes_notify_run_engine_live.mjs after
  python3 -B tools/dev/hermes_notify_consumer_live.py
  node --test tools/dev/hermes_notify_workflow_live.mjs
  node --test tools/dev/hermes_notify_run_origin_live.mjs
  python3 -B tools/dev/test_hermes_notify_subscriber.py -v
  python3 -B tools/dev/test_hermes_notify_repair.py Repairs -v
  python3 -B tools/dev/test_hermes_notify_workflows.py WorkflowContract -v
  python3 -B tools/dev/test_hermes_notify_run_origin.py -v
  env -i HOME="$HOME" HERMES_HOME="$HOME/native-fixture" PATH=/opt/homebrew/bin:/usr/bin:/bin \
    /opt/homebrew/bin/python3 -B tools/dev/hermes_native_atomic_contract.py /Users/ajhochhalter/.hermes/hermes-agent
  node apps/api_server/node_modules/vitest/vitest.mjs run --root apps/api_server \
    src/__tests__/hermes_notify_bootstrap.test.ts \
    src/__tests__/issue_1491_local_trigger_delivery.test.ts \
    src/middleware/local_agent_surface_guard.test.ts \
    src/__tests__/issue_755_role_separation.test.ts src/__tests__/relay_role.test.ts \
    src/__tests__/agent_local_auth_bypass.test.ts src/__tests__/server_shutdown_signal_contract.test.ts \
    src/__tests__/issue_1375_transcript_share_purge_startup.test.ts --no-file-parallelism
  node apps/api_server/node_modules/typescript/bin/tsc -p apps/api_server/tsconfig.json --noEmit
  git diff --check
)
result=$?; tools/dev/sandbox.sh down; teardown=$?
printf 'DURABLE_FINAL checks=%s teardown=%s\n' "$result" "$teardown"
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN; ports=$?
test "$result" -eq 0 && test "$teardown" -eq 0 && test "$ports" -eq 1 &&
  test ! -e "$RHYTHM_SANDBOX_DIR" && test ! -L "$RHYTHM_SANDBOX_DIR"
```

### Observed final result / count reconciliation / teardown

Exit0, `DURABLE_FINAL checks=0 teardown=0`. API build/postbuild and final noEmit pass;
MCP --noCheck build is NOT typecheck. Own unchanged previously built fork reused,
no new fork build claim. Transient curl refusal before readiness is not acceptance
failure. Initial API40740/engine40846/gateway40740; owned sandbox restartAPI44801/
engine44860/gateway44801. Stock down0, sandbox absent including symlink, no named
listeners. Sanitized diagnostics `.evidence.MY5jLt` under the same sandbox prefix.

| Suite | Unique final checks |
|---|---:|
| Retained revocation/guard/journal/terminal/workflow |9+5+7+3+5 =29 PASS |
| Retained actual HTTP/engine and workflow HTTP/SSE |4+1 =5 PASS |
| Retained Python subscriber/repair/workflow |6+4+2 =12 PASS |
| Retained8-file bootstrap/auth/neighbor Vitest |49 PASS |
| **All retained95, including supported retry correction** |**95 PASS /0 FAIL** |
| New real-runner retry HTTP fixtures |3 PASS |
| New migration/adversarial run-origin contract |8 PASS |
| New actual fork V2 event/SSE/concurrency |1 PASS |
| New v2 subscriber schema/inbox |2 PASS |
| **Final numbered unique aggregate** |**109 PASS /0 FAIL** |

Python Ran10 and Ran8 repeat six inherited checks each; not double-counted. All
numbered suites have no skips/removals. Restart and native receipts are separate,
not inflated into109: v1 before1durable pending/after1identical; v2 restart prints
`PASS V2 sandbox restart: 4 identical pending IDs/cursors/ACK states/original conversation recovered`.
Real engine test polls journal storage BEFORE GET to prove actual fork SSE caused
projection; stale old SDK PATCH produces no new journal row, fresh SDK PATCH does.
No provider/model turn ran. Runner tests use real coordinator gate/loop/registry/
dispatcher, with injected Runner.run boundary creating synthetic real repository
sessions; this does NOT qualify live AgentRunner/provider/Hermes workflow execution.
Generic consumer output explicitly says `NOT actual Hermes`. Native source check:
`PASS: actual native append closure + atomic receipt/reopen/digest/revocation/rollback; persisted NOT wake/visible ACK`.
Only tracked source copied/imported into disposable clean HOME/HERMES_HOME; no
installed runtime/config/live state/provider activation. Native active history row
is still storage proof, not safe display-only/cache/role/wake adapter qualification.

### Final fingerprints / independent handoff

`shasum -a 256` source fingerprints (tools/dev unless qualified):

| Path | SHA256 |
|---|---|
| apps/api_server/src/services/hermes_notify_service.ts |6b49cc995e8267b143a742d4081f50e624923a70a08e63089de562d8c1735b77 |
| apps/api_server/src/routes/hermes_notify_routes.ts |cba73dd09efa92b8af329f0fbf77bad605250c9469881c1ec71ccf95f028cf27 |
| hermes_notify_subscriber.py |273d8398312391ecb3189cb11d951bdac512bf00624286cf46df9811ba134cca |
| hermes_notify_workflow_contract.mjs |534292b1ec3717b323fb5f536b105995d1f21e6acdebf64748c1457ea9a4f0db |
| hermes_notify_run_origin_live.mjs |14bd774add911891dae4f6d75f5860bd011a44bb0ff9ac5bfe2528a70fe7454a |
| hermes_notify_run_origin_contract.mjs |c925606b9643ef1cc6c5490f28ccafe7605045167b011f49d3d64fffb66b8e2f |
| hermes_notify_run_engine_live.mjs |4e51aa514f9c5aad0599ed2a37c129ac7be2de9807bf94bb3bb9500921ec7cab |
| test_hermes_notify_run_origin.py |e491eeb5f7e1f9fa0e4a2e4a51daa8f15219aa7abf6d31d8f18af1fedbf898c6 |

Unchanged retained revocation2e6c7db5…, guard1142af23…, journalff695402…,
terminal644369e8…, workflow-livefc9661a0…, Python workflow2d5ac342… and native
threec3f7a7af…/2e6c42d8…/4f2b7c29… match the full hashes in the prior coordinator
run. Native hermes_state.py remains1752d22d6a888985e2ac6c04514aec5f0f82ee506b6ca69288cf6ffaee97a42f.
Read-only fixture DB9bc96d72845b21e982b7aff0f85daf7b1992828456bc0fc5dab2a4f17334f77a,
conf276e4c0c5e0729b762d8c50c4bcf6e41270660a927f6e8773ec58d17bd4a645f;
both0400 unchanged. HEAD18c5359658e580b8d86ea1bca848858bbcd2eabf unchanged;
git diff --check and source review pass. No commit/push/destructive cleanup.

**READY_FOR_INDEPENDENT_GATE for this Rhythm architecture only.** Parent runs the
exact full command against retained source with disposable runtime writes, confirms
fingerprints and source scope; no unchanged-scope approval request is needed.
**Native Pi ingest/original Hermes wake/visible browser/browser-closed recovery remain
BLOCKED/NOTRUN** until parent forwards exact deployed protocol/source artifacts and
coordinates the separately approved synthetic offline Hermes activation. No SSH/
remote duplicate inspection or Pi activation performed. No new ports/relay changes/
Tailscale, containers/installed Hermes restart, live DB migration/production deploy,
real AJ messages/approvals, PR1615/card changes, desktop signatures, drive/email/
billing/unrelated communication or host permission bypass. Question/permission
engine references remain noncanonical; bridge-job projection and trusted dispatch
origin integration are not newly claimed. Existing finite-hub/offline completeness
and cancellation-source limitations remain documented, not silently repaired.

## Independent gate 7065f528 — qualified PASS, 2026-10-13

Parent-provided independent result for HEAD `18c53596` plus the 19-path dirty
pre-documentation candidate: **109 unique PASS / 0 FAIL**, plus **6 independent
probes PASS / 0 FAIL**. Canonical full command remains the code block at lines
207–256 before this documentation update; no commands/tests were rerun by the
documentation writer. Reconciliation: 49 neighbors + 20 notify + 11 coordinator
+ 1 journal + 5 guards + 9 revocation = 95 retained; 14 new = 109.

| Independent probe | Observed boundary |
|---|---|
| Retry / pre-engine | Old authority 404; new exact membership accepted |
| Origin/auth | Arbitrary, unbound and foreign origins denied; owner body 400, bad credential 401, different chat 409 |
| Corrupt stage / transfer | Read/ACK denied without journal mutation; neither owner inherits transferred origin |
| Ambiguous legacy | Quarantine survives initialize/replay; no inferred authority |
| Concurrent origins / ACK | Competing conversations 201/409; ACK monotone |
| Unknown verdict/status / invalid ACK | Fail closed; raw text not published |

Diagnostics `.evidence.cwv2Ml` and `.evidence.VVvgLa`; teardown 0, sandbox absent,
4898 free, sanitized fixtures still 0400. API build and noEmit/typecheck exit 0;
MCP `--noCheck` is **not** strict typecheck. Unchanged prebuilt fork reused.
Independent fingerprints apply to pre-DOC candidate source only:

| Source | SHA256 |
|---|---|
| `apps/api_server/src/services/hermes_notify_service.ts` | `6b49cc995e8267b143a742d4081f50e624923a70a08e63089de562d8c1735b77` |
| `apps/api_server/src/routes/hermes_notify_routes.ts` | `cba73dd09efa92b8af329f0fbf77bad605250c9469881c1ec71ccf95f028cf27` |
| `tools/dev/hermes_notify_subscriber.py` | `273d8398312391ecb3189cb11d951bdac512bf00624286cf46df9811ba134cca` |

Actual RecipeWorkflowRunner/dispatcher/repositories exercised three synthetic
workflows with an injected engine boundary, not live Encompass/Rhythm/Opus or
provider execution. Actual fork SSE is a separate check. Native atomic active
history storage is not wake/render/visible acceptance. Earlier HEAD CI green is
not qualification of this dirty candidate: parent commit and new CI are required.

**Primary Pi ingest/wake/visible browser/browser-closed acceptance BLOCKED/NOTRUN.**
Read-only SSH host-key verification failed; no bypass. Parent must forward sanitized
deployed Hermes image/source/routes, owner/session mapping, durable receipt/cache/
render/offline-fixture artifacts and coordinate narrow non-restarting synthetic
fixture activation. Real dispatch-origin hook, bridge-job projection and canonical
card-ID publication remain unintegrated/unqualified; engine permission IDs are not
card IDs. No Pi activation, communications/requests, production deploy/migration,
real cards/desktop approvals, network/relay changes or container restart performed.

Documentation handoff: [V2 contract](../contracts/hermes-event-notify-v2.md),
[ADR](../decisions/2026-10-13-hermes-durable-run-origin.md), and compatibility pointer
in V1. Historical RED/repair/gate-ready receipts above are preserved, not current
completion claims. This docs-only continuation does not commit or push.

Docs-only validation: `git diff --check` exit 0; all three source hashes above
reconfirmed unchanged; HEAD remains `18c53596`. A single targeted project-state
pointer records the current qualification/blocker without rewriting unrelated
historical context (`git diff --numstat -- docs/ai/project-state.md`: 1 added,
0 deleted). No product/test/source edits, server commands or test execution.
