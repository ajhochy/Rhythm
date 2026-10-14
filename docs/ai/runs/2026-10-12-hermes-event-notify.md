---
date: 2026-10-12
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: null
issues: [NOTIFY-HERMES]
status: partial-verification
tags: [run, rhythm]
---

# NOTIFY HERMES

## Scope / approvals

AJ's explicit specialist handoff; single owner, assigned worktree only, HEAD/base
`4f915540f700bbb403728ef8e01e0b5e02baf94f`. Parent owns integration/shared contracts.
Approval-owner paths and all other worktrees/installed Hermes are untouched.
Installed Hermes source was read-only evidence: AGENTS first, then webhook adapter
and `tui_gateway/server.py` notification poller. No config/auth/live database reads.
No credentials printed or stored in docs. No production send, external communications,
SSH, deployments, container/live restarts, commits/pushes or network changes.

Linked [plan](../plans/2026-10-12-hermes-event-notify.md) and
[candidate trust contract](../contracts/hermes-event-notify-v1.md).

## Phase 0 — acceptance first

Loaded `acceptance-contract`, then `coding-agent`. Read AGENTS, project-state and
current-plan. Scope criteria are AJ's six criteria; checks do not redefine full
completion. Four acceptance checks are fixed and were red before implementation.
AC5's actual Hermes session wakeup and AC6's runtime-boundary proof remain separate
gates; no mocked wakeup, cron workaround or queue-as-visible claim.

Initial dependency discovery failed: assigned worktree had no node_modules.
`ls apps/api_server/node_modules apps/opencode_fork/node_modules` returned missing
paths. Added ignored dependency symlinks **inside assigned worktree only**, pointing
to existing read-only dependency trees (root, API, MCP, fork root and fork package).
No npm install or shared source edit was performed.

Canonical synthetic fixture command:
`node tools/dev/sandbox_fixture.mjs /private/tmp/hermes-event-notify-20261012-fixture`
returned `Synthetic read-only sources: /private/tmp/hermes-event-notify-20261012-fixture`.
Selected a separate 0400 synthetic `notifier-opencode.json` within that fixture root
with a harmless local stdio fixture MCP, avoiding the generator's hardcoded 4098
MCP URL (approval-owner port). Launcher `ensure_rhythm_mcp` wires its own 4898 URL.

Every sandbox command used this exact environment (no real auth fallback):

```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-event-notify-20261012-fixture
export RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-event-notify-20261012-fixture/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-event-notify-20261012-fixture/notifier-opencode.json
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-event-notify-20261012-sandbox
export RHYTHM_SANDBOX_API_PORT=4898 RHYTHM_SANDBOX_ENGINE_PORT=4897 RHYTHM_SANDBOX_GATEWAY_PORT=4899
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
```

`lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN` initially returned no listeners.
`tools/dev/sandbox.sh up` built the fork through the launcher (offline model fixture,
skip-install/web-embed flags built into launcher), API tsc and MCP; ready API74717,
engine74808, gateway74717. Initial curl connection refusal was launcher readiness
retry, not an acceptance pass/fail.

`RHYTHM_LIVE_E2E=1 node --test tools/dev/hermes_notify_acceptance.mjs`:
**0 passed / 3 failed**: event surface `404 !== 200`, unauthenticated read
`404 !== 401`, unsafe ACK `404 !== 400` (absent feature).

First separate lifecycle invocation found the host tool had reaped background
processes: `status` showed empty listeners; **1 failed**, `fetch failed`. Preserved
as setup failure, **not** behavioral red. Repeat via `tools/dev/sandbox.sh restart`
in the same command as the test reached real API create201, then failed on
`origin is durably bound before dispatch/prompt: 404 !== 201`: **0 passed / 1 failed**.
No implementation existed yet. All subsequent server checks keep launcher/test
operations in one tool invocation so tool process cleanup cannot masquerade as proof.

## Phase 1 — whole intended surface

GitNexus query discovered `OpencodeEventHub`, stream bridge, relay outbox/uplink,
relay gateway and async delegation completion. Read existing SSE route, event hub,
global bridge's persistence-before-publish ordering, relay outbox and relay gateway,
async delegation completion/restart/claim logic and session ownership/create flow.
Existing async completion uses deterministic engine wake IDs for Rhythm parents;
it does not wake Hermes. Existing session SSE forwards tokens with no durable ID.
Relay replica ACK/prune is not consumer-visible ACK; do not reuse its meaning.

GitNexus impact `createApp`, upstream, `apps/api_server/src/app.ts`: **LOW**,
0 indexed direct callers, 0 processes/modules. Actual source server.ts calls it;
index counts are not a guarantee. New `HermesNotifyService`: UNKNOWN/not indexed.
API impact `/hermes-notify`/new route file: no indexed routes (additive surface).
No HIGH/CRITICAL rating was returned. Necessary tests target auth, hub/journal,
source labels, replay/ACK and actual engine event path. No shared runtime function
besides createApp is changed; app mount is the only parent-integration patch.

Read primary historical receipt
`docs/ai/runs/2026-10-10-coordinator-delivery-acceptance-checkpoint.md` (absent from
base worktree): original Rhythm-chat delivery-only; explicitly not Hermes proof.
Read September18 Hermes repair receipt: draft textarea without Enter is not wakeup.
Installed webhook uses a new listener and webhook sessions/cross-platform deliver;
not allowed here and not proof of the original WebUI session. TUI poller lines
10841–11015 routes internal process completions, buffers busy events and triggers
`_run_prompt_submit`; its ownership and process-global queue do not expose the
required external authenticated durable/visible-receipt contract.

## Files

- `apps/api_server/src/app.ts`: additive import/mount, SQLite local engine only.
- `apps/api_server/src/services/hermes_notify_service.ts`: separate additive tables,
  immutable owner-origin binding, stable IDs/cursors, semantic hub events, fixed labels.
- `apps/api_server/src/routes/hermes_notify_routes.ts`: requireAuth-only origin,
  pending replay/SSE and monotone honest ACK; no new listener.
- `tools/dev/hermes_notify_subscriber.py`: outbound SSE + durable local inbox,
  bounded reconnect, watchdog, strict trust schema and local owner-adapter gate.
- `tools/dev/hermes_notify_acceptance.mjs`, `hermes_notify_live.mjs`: fixed RED→GREEN
  HTTP/security and real fork session-update acceptance.
- `tools/dev/hermes_notify_journal_contract.mjs`: real SQLite/hub-ingestion contract.
- `tools/dev/hermes_notify_restart.mjs`: before/after actual launcher restart receipt.
- `tools/dev/hermes_notify_consumer_live.py`: actual sandbox SSE/ACK/subscriber path
  into the local durable fixture sink; expressly not an actual Hermes runtime.
- `tools/dev/test_hermes_notify_subscriber.py`: six real SQLite fixture adapter cases.
- This run, linked plan and candidate trust contract.

## Phase 2 — actual checks so far

First implementation validation (no failed repair round): set the environment above,
then `export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1` (reuse **own** just-built unchanged
fork binary), then:

```sh
tools/dev/sandbox.sh down && tools/dev/sandbox.sh up && tools/dev/sandbox.sh status &&
  RHYTHM_LIVE_E2E=1 node --test tools/dev/hermes_notify_acceptance.mjs tools/dev/hermes_notify_live.mjs
python3 -B tools/dev/test_hermes_notify_subscriber.py
tools/dev/sandbox.sh down
```

API build passed tsc. **4 Node checks passed / 0 failed**. Actual engine PATCH200
emitted session.updated through real global SSE and created durable event; stream,
cross-owner denial, immutable rebind, accepted-vs-visible ACK and replay passed.
Observed output: `LIVE: actual fork session.updated -> durable notification; no
Hermes wakeup claimed`. This exercises no model inference or external action.
**6 Python checks passed** (busy, duplicate, restart, post-transcript-commit crash,
remote ACK failure, malformed/forged replay). Fixture transcript is **not Hermes**.
Ready listeners API21684/engine21778/gateway21684. Stock down completed; sanitized
diagnostics preserved at `.evidence.aYwvF5` (preimplementation) and `.evidence.elekhM`
(first passing candidate), siblings of the named sandbox under `/private/tmp`.

Final journal/restart/neighbor checks and status matrix follow below after execution.

## Remaining boundary / deployment handoff

This is partial implementation, not full acceptance, not production-ready. Actual
Hermes ingestion/wakeup/visible update/browser-closed behavior are NOTRUN/BLOCKED.
Exact missing adapter and parent integration steps are in the linked contract/plan.
No supported original-WebUI wake API was demonstrated. No cron workaround attempted.
Parent independently verifies; parent alone integrates after approval owner finishes.

## Independent FAIL receipt — received in focused repair round 1

Parent reports coding `ce0ce514` finished; independent verifier
`aabdebd3-93f7-4384-904d-0069d384759e` finished **FAIL, no writes**.
This is a received receipt, not a claim that this agent ran the verifier's commands.
Its exact original commands/output artifacts were not supplied. Named defects:

1. `Subscriber.run`: a healthy 15-second heartbeat stream never leaves the inner
   loop, starving the 600-second watchdog. Reported controlled 1365-second probe:
   `requests=['/events','/stream']`, no GET at 600/1200 seconds.
2. `Inbox.accept` / `Subscriber.receive`: different eventId with the same cursor
   silently loses INSERT to UNIQUE, then indexes missing SELECT row and crashes
   with TypeError. Existing same-ID changed replay must still refuse.
3. `validate`: `kind=[]` crashes with unhashable TypeError; `version=True` passes
   equality with 1. Malformed inputs must be controlled validation refusals.
4. Additional truthfulness defect: same-origin rebind by a transferred session's
   new owner succeeds despite retaining an inaccessible old-owner binding.
5. Receipt defect: line 147 promised final journal/restart/neighbor checks but
   recorded none. The following are **newer reruns**, not reconstructed old passes.

## Repair scope, contract and impact

Same sole-owner worktree and branch, HEAD
`4f915540f700bbb403728ef8e01e0b5e02baf94f`; initial dirty implementation retained.
Loaded acceptance-contract then coding-agent. Read full subscriber, existing tests,
consumer, journal, restart, HTTP/live checks and router; searched all subscriber,
inbox.accept and bind references. Read AGENTS and both memory snapshots.
No workflow/peer dispatch. Approval re-gate elsewhere remains ACTIVE.
Only the bounded fixes above are authorized; no reserved approval source paths,
other worktrees, installed Hermes, deployments, networks, credentials, commits,
pushes, installs or live data touched. No approval on 4198/4197/4199 inferred.

GitNexus upstream impact on `Subscriber`, `validate`, `accept`, `run` in
`tools/dev/hermes_notify_subscriber.py` and `bind` in
`apps/api_server/src/services/hermes_notify_service.ts` all returned
`Target ... not found`, risk **UNKNOWN**. Zero indexed matches is not zero blast
radius. Actual dependents are main/run/receive, inbox tests, consumer fixture and
the origins route/journal checks. No route handler edited. Risks reviewed:
watchdog must not become primary polling; conflicting inbox identity must not ACK
or overwrite; owner transfer must not reassign history. Tests below target these.
Durable acceptance stays before ACK; drain commits the fixture receipt before
visible ACK, retains receipt after failed ACK, and keeps dedup tombstones.
Storage errors are not covered by any new broad exception catch.

Fixed named checks (implementer's mandate: pass these without editing assertions):
`test_actual_run_watchdog_during_healthy_heartbeats`,
`test_cursor_identity_conflict_refuses_without_ack_or_mutation`,
`test_malformed_types_are_validation_refusals`,
`test_actual_run_refuses_malformed_pages_and_stream_events`, and
`ownership transfer refuses same-origin rebind and preserves journal`.
Actual runner is exercised with transport/monotonic boundary fixtures, not a
reimplemented scheduler. Actual SQLite inbox and fixture sink are not mocked.
Independent parent verifier can rerun checks read-only against source/artifacts;
test databases remain disposable and separate. Independent rerun still pending.

### Phase 0 RED (before any production repair)

From the assigned worktree:

```sh
python3 -B tools/dev/test_hermes_notify_repair.py -v
python3 -B tools/dev/test_hermes_notify_repair.py Repairs -v
```

First command: `Ran 15 tests`, `FAILED (failures=2, errors=5)` (six inherited
checks and six imported checks duplicated, three new checks). Exact reasons:
watchdog actual requests `[('/events', 0), ('/stream', 0)]` differed from expected
`[('/events', 0), ('/stream', 0), ('/events', 600), ('/events', 1200)]`;
cursor conflict raised `TypeError: 'NoneType' object is not subscriptable` at
subscriber line 105; boolean version raised `AssertionError: ValueError not raised`;
kind list/map raised `TypeError: cannot use 'list'/'dict' as a dict key`;
text list/map raised `TypeError: cannot use 'list'/'dict' as a set element`.

Added the runner malformed-page/stream check before production patch. Second
command: `Ran 10 tests`, `FAILED (failures=2, errors=11)`. Same defects plus
page None: `TypeError: 'NoneType' object is not subscriptable`; page list:
`TypeError: list indices must be integers or slices, not str`; error object:
`KeyError: 'events'`; events None: `TypeError: 'NoneType' object is not iterable`.
Malformed stream kind and cursor conflict reproduced the same uncaught TypeErrors
through actual run/receive. These failures are retained here, not relabeled setup.

For all launcher commands below, export **exactly** the four paths and port/env
settings from lines 49–56 above, plus `RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1`
(reuse this workstream's unchanged built fork; no engine source edit).
RED owner-transfer invocation, prior to bind patch:

```sh
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status &&
  sqlite3 "$RHYTHM_SANDBOX_DIR/rhythm.db" ".backup '$RHYTHM_SANDBOX_DIR/journal-red.db'" &&
  env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/journal-red.db" \
    node --test tools/dev/hermes_notify_journal_contract.mjs
tools/dev/sandbox.sh down
```

No initial listeners. Launcher API tsc passed; ready PID API/gateway356,
engine505. Journal used populated canonical sandbox backup, not an empty DB.
`# tests 6`, `# pass 5`, `# fail 1`: ownership-transfer assertion failed at journal
line60 with `Missing expected exception.` Teardown succeeded; diagnostics
`/private/tmp/hermes-event-notify-20261012-sandbox.evidence.alkBlB`.

### Phase 2 changes / attempt 1

Only these five files changed by this repair:

- `tools/dev/hermes_notify_subscriber.py`: require integer version and typed
  kind/text/state before equality/membership; verify stored identity inside the
  INSERT transaction to refuse cursor collision; shared elapsed-time recovery
  check inside healthy SSE as well as outside, validate recovery page shape/list.
- `apps/api_server/src/services/hermes_notify_service.ts`: immutable binding now
  also compares stored owner, returns conflict after transfer, never reassigns.
- `tools/dev/test_hermes_notify_repair.py`: four new runnable RED contracts.
- `tools/dev/hermes_notify_journal_contract.mjs`: additive transfer regression.
- This run receipt. Existing source/test assertions were not weakened.

First repair validation:
`python3 -B tools/dev/test_hermes_notify_subscriber.py -v && python3 -B tools/dev/test_hermes_notify_repair.py Repairs -v && git diff --check`
returned `Ran 6 tests ... OK`, `Ran 10 tests ... OK`, diff check silent exit0.
One production repair attempt per criterion; no second repair necessary.

### New complete sandbox replay / exact command and observed output

Use the environment above, additionally `export RHYTHM_LIVE_E2E=1`:

```sh
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status &&
  sqlite3 "$RHYTHM_SANDBOX_DIR/rhythm.db" ".backup '$RHYTHM_SANDBOX_DIR/journal-green.db'" &&
  env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/journal-green.db" \
    node --test tools/dev/hermes_notify_journal_contract.mjs &&
  node --test tools/dev/hermes_notify_acceptance.mjs tools/dev/hermes_notify_live.mjs &&
  node tools/dev/hermes_notify_restart.mjs before &&
  tools/dev/sandbox.sh restart && tools/dev/sandbox.sh status &&
  node tools/dev/hermes_notify_restart.mjs after &&
  python3 -B tools/dev/hermes_notify_consumer_live.py &&
  python3 -B tools/dev/test_hermes_notify_subscriber.py -v &&
  python3 -B tools/dev/test_hermes_notify_repair.py Repairs -v
result=$?
tools/dev/sandbox.sh down
teardown=$?
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN
test "$result" -eq 0 && test "$teardown" -eq 0
```

Overall exit0. API tsc/postbuild passed; MCP launcher build passed with its existing
`--noCheck` (not a claim of MCP typechecking). Launcher readiness transient curl
refusal preceded success, not a test failure. Before restart listeners API/gateway
16959, engine17053; after restart API/gateway21199, engine21246. Disposable HOME
`/private/tmp/hermes-event-notify-20261012-sandbox/home`; DBs are
`rhythm.db` (canonical sandbox fixture copy) and `journal-green.db` (populated
canonical backup). Fixture sources remain read-only, no real auth fallback.

Observed journal TAP: `# tests 6`, `# pass 6`, `# fail 0`:
semantic transitions/error/question/permission durable duplicate-safe;
new journal instance identical replay; cross-owner denial; monotone honest ACK;
malformed reference transaction refusal; ownership-transfer refusal/preservation.
HTTP/live TAP: `# tests 4`, `# pass 4`, `# fail 0`:
authenticated durable replay surface; unauthenticated401; unsafe ACK400;
actual engine lifecycle/owner stream/replay/honest ACK.
`LIVE: actual fork session.updated -> durable notification; no Hermes wakeup claimed`.
`RESTART before: 1 durable pending events`;
`Sandbox restarted without replacing DB or vault: /private/tmp/hermes-event-notify-20261012-sandbox`;
`RESTART after: 1 identical IDs/cursors/payloads recovered`.
Before/restart/after ran **before consumer drain**.
`PASS: real SSE -> durable busy inbox -> consumer reopen -> one fixture transcript row -> visible ACK; NOT actual Hermes`.
Python existing six: `Ran 6 tests ... OK`; repair class: `Ran 10 tests ... OK`.
The latter includes the six inherited originals plus four new checks, not ten new
unique checks. Thus all **15 existing + 5 new = 20 unique named checks passed**;
consumer and actual restart receipts additionally passed. No omitted neighbor pass
is implied. Teardown: `Sandbox removed: /private/tmp/hermes-event-notify-20261012-sandbox`;
final lsof no listeners; sanitized diagnostics preserved at
`/private/tmp/hermes-event-notify-20261012-sandbox.evidence.0OOfUN`.

## Status matrix / bounded handoff

| Gate | Status | Evidence / limitation |
|---|---|---|
| Independent initial verification | FAIL | Received verifier ID above, named defects; no writes |
| Phase 0 RED | PASS | Actual defect failures recorded above before patch |
| Scope/impact review | PASS with UNKNOWN graph coverage | Actual source/callers inspected; no zero-radius claim |
| Watchdog during healthy SSE | PASS | Actual run at controlled 0/600/1200; no delivery/ACK on heartbeat |
| Cursor identity conflict | PASS | ValueError, no ACK/mutation; run catches refusal |
| Strict malformed schema/page handling | PASS | Bool version/cursor, list/map/null fields/error shapes; actual runner refusal |
| Ownership transfer | PASS | Explicit409; original journal unchanged; both owners list/ACK fail closed |
| Existing15 + new5 contracts | PASS | New rerun20 unique, not reconstructed earlier evidence |
| Real engine update / HTTP / SSE / consumer fixture | PASS bounded | No model turn; durable fixture transcript is not Hermes |
| Actual before/restart/after | PASS | One pending event preserved before consumer drain |
| Sandbox teardown | PASS | Named sandbox removed; 4898/4897/4899 free |
| Neighbor tests | NOTRUN | No evidenced names/commands supplied; no invented prior outputs |
| Independent repaired-candidate verification | PENDING | Parent read-only verifier must rerun |
| Private relay route / Pi adapter runtime | BLOCKED | Unqualified; no runtime/network changes authorized |
| Origin before real dispatch | BLOCKED | No canonical real-dispatch hook qualification |
| Canonical approval cardID hook | BLOCKED | Approval-owner workstream untouched |
| Offline/overflow source recovery | BLOCKED | Incomplete; watchdog is recovery only, not a completeness claim |
| Completed model turn -> actual Hermes visible/browser closed | NOTRUN / BLOCKED | No actual Hermes fixture/runtime adapter; no wakeup claim |
| Full feature / production / deployment | BLOCKED | All full blockers unchanged; no deploy/commit/push |

**READY_FOR_REVERIFICATION — bounded repair only.** Parent must not interpret
fixture-visible ACK, synthetic ownership, or real engine session.updated as actual
Hermes/Pi wakeup or full acceptance. Approved scope/exclusions above carry forward;
unchanged scope does not need a new symbol-by-symbol approval request.

## Parent independent re-gate checkpoint

Verifier `f4678286-c14c-49c9-b400-a9387c2f70d9` returned **PASS-for-bounded-slice**, not full feature acceptance. The uncommitted pre-checkpoint aggregate fingerprint was `42c234743977ed00183aebcb4ff8f0c40a491ebdd0413134c950034787fc350a`; this documentation append changes that identity, not the verified source. API launcher build, four HTTP/engine checks, six journal checks, six subscriber originals and four new repair checks passed: **20 unique checks** total. The repair class ran ten checks including six repeated originals, not ten new checks. Real restart preceded consumer drain; pending event ID/cursor/payload survived. Real SSE reached the durable fixture inbox/transcript and visible ACK, expressly **not actual Hermes**.

Independent actual-runner probes observed `/events` at elapsed 0/600/1200 during healthy heartbeats; conflicting cursor identity and malformed schema/pages were controlled refusals with no inbox/ACK mutation. SQLite storage failures propagated. Actual owner-transfer rebind returned409; reads/ACK remained fail closed. Source/fixtures were unchanged during verification. Neighbor suites NOTRUN; historical RED snapshot authenticity is not independently established by the current rerun.

Owned launcher teardown succeeded, sandbox absent and4898/4897/4899 free; sanitized diagnostics `/private/tmp/hermes-event-notify-20261012-sandbox.evidence.9EKwB6`. No approval/live service operations, source writes or environment repairs occurred. New-file graph coverage UNKNOWN. Full blockers remain: unqualified private relay/Pi route; no actual Hermes ingestion/wakeup/visible/browser-closed proof; no real-dispatch origin integration or canonical card-ID hook; incomplete offline/overflow source recovery; completed model turn NOTRUN. Preserve as a separate bounded draft, not a deployable notification feature or integration into approval PR1615.
