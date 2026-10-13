---
date: 2026-10-12
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: READY_FOR_VERIFICATION
tags: [run, rhythm]
---

# PR1616 bootstrap recovery

## Scope / source identity

Parent-authorized single-writer specialist repair, only
`/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`.
Initial clean HEAD `a09d5448e925df326a9a20373591f347da9be6a5`, branch
`feat/hermes-event-notify-20261012`. Read AGENTS, project-state, current-plan and
nearest `2026-10-12-hermes-event-notify.md`; loaded acceptance-contract first,
then coding-agent. No peer/orchestrator dispatch. Parent owns commit/push and
independent read-only verification. Existing approval qualification owner is in
another worktree with nonoverlapping paths/ports; unchanged scope is approved.

Permitted repair surface: router construction, server DB-ready bootstrap, necessary
notification lifecycle members, one focused regression and this dedicated run.
No existing webhook/CORS tests or policies may change; no lazy request init,
DB-error swallowing, route hiding or guard bypass. No dependency install/symlink
changes, credential/private-key access, live4001/4096, approval4198, desktop,
drive/billing/email, production, network/relay/Tailscale/Pi/Hermes restart,
deployment, merge, commit/push or destructive cleanup. Stock owned sandbox teardown
is required. Full Hermes/Pi ingestion/wakeup/visible/browser-closed, real dispatch
and canonical card-ID hooks, offline/overflow recovery remain BLOCKED.

## Phase 0 — fixed acceptance / RED

Make these checks pass without editing assertions in
`apps/api_server/src/__tests__/hermes_notify_bootstrap.test.ts`:

1. `constructs repeated apps without a DB or notification subscriptions` — actual
   createApp twice, DB remains uninitialized, hub subscriber count unchanged.
2. `initializes and subscribes after DB readiness, gated before execution producers`
   — source contract (existing startup-test pattern); SQLite/nonrelay/execution
   gates, initialize before start, DB before startup and subscription before jobs,
   app, gateway/engine, owned stop in shutdown.
3. `stops only its subscription and cannot rearm after shutdown or an immediate restart`
   — actual service and hub, unrelated subscriber preserved, idempotent start/stop,
   stale async finalizer cannot duplicate subscription after stop/start.

Parent independently reruns against source/artifacts without source write access.
No mock of app, service, DB or hub. Source checks are wiring evidence, not live proof.
Existing actual engine/SSE/restart/consumer fixture checks are also required.

All sandbox commands use the following exact environment (`E` below):

```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-event-notify-20261012-fixture
export RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-event-notify-20261012-fixture/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-event-notify-20261012-fixture/notifier-opencode.json
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-event-notify-20261012-sandbox
export RHYTHM_SANDBOX_API_PORT=4898 RHYTHM_SANDBOX_ENGINE_PORT=4897 RHYTHM_SANDBOX_GATEWAY_PORT=4899
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export OPENCODE_DISABLE_DEFAULT_PLUGINS=1 OPENCODE_PURE=1 RHYTHM_NUMBAT_MONITORING_DISABLED=1
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1
```

Reuse this workstream's unchanged previously built fork; no engine source changed.
Preflight `git status --short && git branch --show-current && git rev-parse HEAD`
confirmed clean identity above. `ls -ld` confirmed existing dependencies (preexisting
API symlink, not changed); `stat -f '%Sp %N'` confirmed both fixture files0400.
`lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN` found no listeners.

Exact RED command, cwd `apps/api_server`, after E:

```sh
../../tools/dev/sandbox.sh up && ../../tools/dev/sandbox.sh status &&
env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db" \
  RHYTHM_OPENCODE_ENGINE_PORT=4897 RHYTHM_MOBILE_GATEWAY_PORT=4899 \
  PROD_API_URL=http://127.0.0.1:4898 node node_modules/vitest/vitest.mjs run \
  src/__tests__/hermes_notify_bootstrap.test.ts \
  src/__tests__/issue_1491_local_trigger_delivery.test.ts \
  src/middleware/local_agent_surface_guard.test.ts --no-file-parallelism
result=$?
../../tools/dev/sandbox.sh down
teardown=$?
test "$result" -eq 0 && test "$teardown" -eq 0
```

Observed: launcher API build/postbuild pass; API/gateway80653, engine80750.
Three regression checks fail: createApp throws Database not initialized; explicit
bootstrap missing; service.stop undefined. Actual failed CI suites reproduce:
issue1491 beforeAll -> createApp -> router.initialize -> getDb throws (3 skipped;
secondary afterAll close-is-not-function); renderer preflight throws same error
before requests (1 failed/1 passed). Overall3 failed files,4 failed tests,1 passed,
3 skipped. This is the supplied CI run38353596655/job1151513033452 root cause,
not webhook/CORS policy failure. Teardown succeeded; diagnostics
`/private/tmp/hermes-event-notify-20261012-sandbox.evidence.5v2rWc`.

## Phase 1 — consolidated impact / risk review

Read full server startup/shutdown, notification service/router/hub and all literal
router/service callers (app mount; journal fixture creates independent services).
server.main is the only production entry; initDb precedes createApp already, but
jobs/scheduler run before createApp. Therefore router initialization cannot own
subscription startup: move it immediately after awaited initDb, before all jobs
and engine/gateway producers. Keep matching app SQLite/nonrelay/execution gate.
Capture only the started service in a nullable shutdown reference. Stop must close
only that subscription, cancel pending retry, and prevent a stale async finalizer
from reviving or replacing a new subscription. No transport/recovery expansion.

GitNexus upstream impact `main` file server.ts: LOW,1 direct file caller,0 indexed
processes/modules. `createHermesNotifyRouter`, `HermesNotifyService` (including
HAS_METHOD/HAS_PROPERTY), and member `start`: not indexed, UNKNOWN risk.
API impact route file: no indexed routes. Counts are not proof of zero dependents.
No HIGH/CRITICAL rating returned. Parent notified of LOW/UNKNOWN and lifecycle
risks before edits. Proportionate checks: fixed regression, exact failed suites,
role/auth/startup/shutdown neighbors and all20 notify contracts + live receipts.

## Files / implementation / checks

First and only production repair attempt; no second attempt required. Changed:

- `apps/api_server/src/routes/hermes_notify_routes.ts`: remove initialize/start
  from construction; all route handlers/auth/validation unchanged.
- `apps/api_server/src/server.ts`: explicit awaited-DB, execution/SQLite/nonrelay
  bootstrap before any job; nullable owned reference stopped in shared shutdown.
- `apps/api_server/src/services/hermes_notify_service.ts`: necessary owned stop,
  cancel retry; subscription-identity guard prevents stale finalizer from resetting
  a new subscription or rearming after stop. Existing ingestion/DB error behavior,
  overflow retry policy and journal schema unchanged.
- `apps/api_server/src/__tests__/hermes_notify_bootstrap.test.ts`: three fixed
  RED-before-patch regressions; no subsequent assertion edits.
- This dedicated recovery run only. Existing webhook/CORS assertions unchanged.

Exact GREEN command, cwd `apps/api_server`, after E and
`export RHYTHM_LIVE_E2E=1`:

```sh
../../tools/dev/sandbox.sh up && ../../tools/dev/sandbox.sh status && (
  export HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db"
  export RHYTHM_OPENCODE_ENGINE_PORT=4897 RHYTHM_MOBILE_GATEWAY_PORT=4899
  export PROD_API_URL=http://127.0.0.1:4898
  node node_modules/vitest/vitest.mjs run \
    src/__tests__/hermes_notify_bootstrap.test.ts \
    src/__tests__/issue_1491_local_trigger_delivery.test.ts \
    src/middleware/local_agent_surface_guard.test.ts \
    src/__tests__/issue_755_role_separation.test.ts \
    src/__tests__/relay_role.test.ts \
    src/__tests__/agent_local_auth_bypass.test.ts \
    src/__tests__/server_shutdown_signal_contract.test.ts \
    src/__tests__/issue_1375_transcript_share_purge_startup.test.ts \
    --no-file-parallelism &&
  node node_modules/typescript/bin/tsc --noEmit &&
  sqlite3 "$RHYTHM_SANDBOX_DIR/rhythm.db" ".backup '$RHYTHM_SANDBOX_DIR/journal-green.db'" &&
  env DB_PATH="$RHYTHM_SANDBOX_DIR/journal-green.db" \
    node --test ../../tools/dev/hermes_notify_journal_contract.mjs &&
  node --test ../../tools/dev/hermes_notify_acceptance.mjs ../../tools/dev/hermes_notify_live.mjs &&
  node ../../tools/dev/hermes_notify_restart.mjs before &&
  ../../tools/dev/sandbox.sh restart && ../../tools/dev/sandbox.sh status &&
  node ../../tools/dev/hermes_notify_restart.mjs after &&
  python3 -B ../../tools/dev/hermes_notify_consumer_live.py &&
  python3 -B ../../tools/dev/test_hermes_notify_subscriber.py -v &&
  python3 -B ../../tools/dev/test_hermes_notify_repair.py Repairs -v
)
result=$?
../../tools/dev/sandbox.sh down
teardown=$?
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN
test "$result" -eq 0 && test "$teardown" -eq 0
```

Overall exit0. Launcher `npm run build` API tsc/postbuild passed (and MCP build
with existing `--noCheck`, not an MCP typecheck claim). API `tsc --noEmit` silent
exit0. Initial API/gateway4077, engine4171; post-restart API/gateway9410,
engine9468. Initial transient curl refusal was launcher readiness retry, not failure.

Observed exact results:

- Vitest: **8 files passed,49 tests passed,0 failures,0 skips**. Includes new3,
  actual CI issue1491 suite3, renderer-origin suite2 and41 role/auth/startup/shutdown
  neighbors. Existing successful webhook/auth/CORS assertions were not changed.
- Journal TAP: **6 pass/0 fail**, including owner-transfer refusal/preservation.
- HTTP/live TAP: **4 pass/0 fail**; `LIVE: actual fork session.updated -> durable
  notification; no Hermes wakeup claimed`. Real fork API PATCH200 reached durable
  journal through actual global SSE, despite constructor no longer starting service.
- `RESTART before: 1 durable pending events`; launcher restarted without replacing
  DB/vault; `RESTART after: 1 identical IDs/cursors/payloads recovered`.
  Actual restart happened **before consumer drain**.
- `PASS: real SSE -> durable busy inbox -> consumer reopen -> one fixture transcript
  row -> visible ACK; NOT actual Hermes`.
- Original Python suite: **Ran6 ... OK**. Repair class: **Ran10 ... OK**, including
  six inherited originals and four new checks. Thus **20 UNIQUE notification checks**
  (6 journal +4 HTTP/live +6 originals +4 repairs), not26; restart/consumer receipts
  additional. Bootstrap/neighbor49 are separately counted.
- Stock teardown: `Sandbox removed: /private/tmp/hermes-event-notify-20261012-sandbox`;
  final lsof no listeners. Sanitized diagnostics:
  `/private/tmp/hermes-event-notify-20261012-sandbox.evidence.KO9dgR`.

Final review command (cwd assigned worktree root):

```sh
git diff --check && git status --short && git diff --stat &&
git diff -- apps/api_server/src/routes/hermes_notify_routes.ts apps/api_server/src/server.ts apps/api_server/src/services/hermes_notify_service.ts &&
shasum -a 256 apps/api_server/src/routes/hermes_notify_routes.ts apps/api_server/src/server.ts apps/api_server/src/services/hermes_notify_service.ts apps/api_server/src/__tests__/hermes_notify_bootstrap.test.ts &&
git rev-parse HEAD && test ! -e /private/tmp/hermes-event-notify-20261012-sandbox
```

Exit0; only above five paths dirty; tracked production diff28 insertions/5 deletions.
No existing tests modified. HEAD unchanged. SHA256 verified source identity:

| File | SHA256 |
|---|---|
| routes/hermes_notify_routes.ts | `92848b7455a487699042981fa7fadbbb8a8edb4ba331dee447ac18d48ba4fdc5` |
| server.ts | `f9692f989dad8bb330ddfa7adec72c33421e4266db5f548bff764bd308dba28e` |
| services/hermes_notify_service.ts | `185a63f48a7f1dd6774f02b60468c946d9f4e4ed728667d7160792a88a242bbf` |
| __tests__/hermes_notify_bootstrap.test.ts | `7f78f06e62383843f8f0da5c57e4382f1763ed28ee40a695c257a3c269dba891` |

## Handoff / current boundaries

**READY_FOR_VERIFICATION — PR1616 bootstrap repair only.** Independent parent
verification remains pending; supplied remote CI failure was reproduced locally,
not rerun remotely. No commit/push; parent owns both. Do not merge/deploy.
Unchanged full feature blockers remain BLOCKED: actual Hermes/Pi ingestion,
wakeup/visible/browser-closed behavior, real-dispatch origin hook, canonical
approval card-ID hook, offline/overflow source completeness. Fixture transcript
visible ACK is not an actual Hermes receipt. No transport expansion or approval
workstream edits. All approvals/exclusions above carry forward for unchanged scope.

## Parent independent recovery gate

Verifier `ce398af1-7d9d-400d-b0bb-ff482fd17e81` returned **PASS-qualified-bootstrap-only** after provider overload retry. It reran the documented GREEN sequence:49tests/8files nofailures/skips;6journal+4HTTPengine+6Pythonoriginal+4newunique repair checks=20unique, actual restart-before-drain recovered1identical pending ID/cursor/payload; fixture consumer visibleACK expressly NOTactualHermes. APIbuild/typecheck exit0. Four source hashes above unchanged before/after. Inline compiled-artifact probes passed DB-free construction, DB-error propagation, idempotent start/stop, immediate restart, retry cancellation/no-rearm, unrelated-subscriber preservation, and anonymous401. Existing webhook/CORS assertions andguards unchanged.

Both ownedteardowns passed;4898/4897/4899free, sandboxabsent. Diagnostics .evidence.q8TCgh and.o6CZyx retained; noenvironmentrepairs/sourcewrites byverifier. New-head CI mandatory after parentcommit/push. ActualHermes/Piingestion,wakeup,visible/browserclosed,realdispatch/cardhooks,offline/overflow remainBLOCKED; no merge/deployment authorized. Prior READY statement is historical superseded by this qualified gate.
