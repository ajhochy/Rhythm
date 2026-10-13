---
date: 2026-10-13
repo: Rhythm
branch: feat/hermes-event-notify-20261012
pr: 1616
issues: [NOTIFY-HERMES]
status: BLOCKED_RETRY_CONTRACT_RESOLUTION
tags: [run, rhythm]
---

# Coordinator/native notification continuation

## Parent-authorized contract correction — current continuation

Parent handoff resumes `09f95698`, preserving the dirty candidate at HEAD
`18c5359658e580b8d86ea1bca848858bbcd2eabf`. Sole writer, same worktree.
Only journal contract and this dedicated note may change; no product source repair.
Parent explicitly supersedes historical idle-as-completion with no idle-as-success.
WAIVED: new failing behavioral test before implementation for this non-behavioral,
test-only contract correction; no implementation is authorized or performed.
The existing conflicting assertion was nevertheless rerun before editing: journal
5 PASS /1 FAIL, expected final `completion`, actual `progress`, line30. Command:
environment E below; `tools/dev/sandbox.sh up && tools/dev/sandbox.sh status &&
sqlite3 "$RHYTHM_SANDBOX_DIR/rhythm.db" ".backup '$RHYTHM_SANDBOX_DIR/journal-before-correction.db'" &&
env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/journal-before-correction.db"
node --test tools/dev/hermes_notify_journal_contract.mjs`; captured result1, stock
down0, sandbox absent. API42663/engine42760/gateway42663; diagnostics
`/private/tmp/hermes-event-notify-20261012-sandbox.evidence.KAJkqU`.
Prior complete aggregate remains explicitly **old RED:19 PASS /1 FAIL** (below).
This is not a pass waiver: the corrected expectation plus zero-completion and
separate durable/all-successful-children assertions enforce stronger safety.
GitNexus upstream impact on `tools/dev/hermes_notify_journal_contract.mjs`,
repo Rhythm, includeTests true: target not found, risk UNKNOWN. No indexed callers
or processes established; not a zero-radius claim. Entire intended test surface,
service qualification, workflow/terminal contracts and launcher inspected up front.
No route/product members edited. Risks: false success after error/gates/idle and
premature success before all children; existing auth/hash/cursor/error assertions
remain intact. Parent independently verifies read-only against disposable artifacts.
All scope exclusions and primary Pi/Hermes BLOCKED gates below remain unchanged.
Current bounded GREEN results/fingerprints are appended after execution; historical
results below remain historical, not rewritten into current acceptance.

## Scope and continuity

Single writer in `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-event-notify-20261012`,
HEAD `18c5359658e580b8d86ea1bca848858bbcd2eabf`, unchanged throughout.
Parent explicitly handed off provider-disconnect recovery from
`e26da1c6-097c-40c2-ac3f-62242e48215d`; disconnect is not a product failure.
No restart/discard of retained source. Loaded acceptance-contract first, then
coding-agent; read AGENTS, project-state, current-plan, all nine retained source/test
files, notification v1 contract and both prior notification/bootstrap receipts.
No orchestrator/peers dispatched. Parent owns independent verification, commit/push.
Parent reports prior-HEAD PR1616 CI green; this run did not query CI or claim new CI.

Approved scope carries forward: coordinator-authoritative notification projection,
necessary internal notification members, subscriber labels, tools/dev native source
artifacts/contracts, disposable fixtures and this dedicated run. Exclusions unchanged:
no deployment/merge/commit/push; no other worktree integration; no runner repair,
approval/card changes, credential widening, installed Hermes writes/imports, live DB
migrations, SSH writes, Pi/container/Hermes restart, network/port/relay/Tailscale
configuration changes, shared dependency installs, real AJ messages, production,
drive/email/billing or unrelated communication. No live4001/4096 or approval4198.
Only stock launcher manages owned sandbox ports4898/4897/4899. No host permission
denial occurred; blockers below are compatibility/evidence/contract conflicts.

Retained diagnostics `.evidence.FJnEoi/opencode-health.log` say engine ready,
bridgeLive true; they are not acceptance output. Prior child supplied no final
receipt or complete new-test results in the worktree. Historical independent
receipts were read: notifier verifier `f4678286` qualified20 checks; bootstrap
verifier `ce398af1` qualified49+20. These are historical, not current pass claims.
All current results below were rerun. Sandbox directory was absent and lsof showed
no named listeners before reuse; nothing unknown was stopped. Read-only fixture
DB/config0400 and preexisting dependency symlink were verified, not changed.

## Phase 0 — acceptance RED, fixed mandate

No behavioral waiver. The retained test
`terminal success with an unresolved durable approval reference is withheld`
was run before implementation: **0 pass / 1 fail**, `1 !== 0`, at terminal contract
line23 (completion was emitted despite pendingApprovalId).
Added two additive tests before source repair, preserving the retained assertion:

- `opaque workflow correlation and error then idle never qualify success`;
- `settled mixed children, fail gate, and cancellation tombstone cannot become success`.

Expanded RED: **0 pass / 3 fail**. First two failed `1 !== 0`; third passed mixed
settlement refusal then failed `gate-fail: 1 !== 0` before reaching cancellation.
Cancellation was subsequently exercised by the passing complete test. These are
actual repository/service/SQLite checks against launcher-built code, not mocks.
Implementer's mandate: pass these named checks without changing their assertions.
Independent parent verifier can rerun read-only against this artifact with its own
disposable DB/runtime; independence has not occurred for this continuation yet.

### Exact environment E (all launcher invocations)

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

Unchanged own previously built fork reused; no new fork-build claim. Every `up`
rebuilt API (tsc/postbuild passed), MCP with its existing --noCheck (not MCP
typecheck). Transient curl connection refusal preceded launcher readiness, not an
acceptance failure. Commands below use worktree root except explicit API cwd.

First RED, after E:

```sh
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status &&
sqlite3 "$RHYTHM_SANDBOX_DIR/rhythm.db" ".backup '$RHYTHM_SANDBOX_DIR/terminal-red.db'" &&
env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/terminal-red.db" \
  node --test tools/dev/hermes_notify_terminal_contract.mjs
result=$?; tools/dev/sandbox.sh down; teardown=$?
test "$result" -eq 0 && test "$teardown" -eq 0
```

Exit1 as expected; API44254/engine44363/gateway44254. Teardown passed, diagnostics
`/private/tmp/hermes-event-notify-20261012-sandbox.evidence.jPP1YE`.
Expanded RED used the same up/status/backup/test/down sequence, plus the native
commands below before down. API60999/engine61104/gateway60999; teardown passed,
diagnostics `.evidence.sNsaDs`. Its shell group used semicolons so overall exit0
reflected the final native command, **not** a passing aggregate. TAP reports3fail.

## Phase 1 — consolidated authority/impact review

GitNexus upstream impact on HermesNotifyService (including HAS_METHOD/HAS_PROPERTY),
syncWorkflows, bind and ingest returned **UNKNOWN / target not found**. These new
paths are not indexed; no zero-radius claim or HIGH/CRITICAL rating. Read full
notification service/subscriber/router, actual callers (server bootstrap and stop,
HTTP/SSE handlers, journal/workflow scripts, bootstrap tests), repository and runner
lifecycle/fanout/gate source. API route handlers were not edited. Supplementary API
impact on hermes_notify_routes returned no indexed routes (coverage unknown).
Concrete risks: wrong-owner linkage, false terminal success, unresolved approval,
retry snapshot identity, duplicate publications and confusing storage with wakeup.
Tests target those risks; no symbol-by-symbol reapproval needed in unchanged scope.

Independent planning receipt `5da082d4` is incorporated, not copied as code:

- recipe_workflow_repository supplies durable RunRow/StageExecutionRow, attempts,
  owner and provisional/committed session bindings. Outbox workflowId remains an
  opaque delivery correlation, not an FK or authority by itself. Existing run and
  exact owner must be found before projecting a registry lifecycle.
- Bridge jobs already supply durable chain/parent-child/request-hash/lease and
  terminal fencing. Do not build another run tracker. This candidate projects
  recipe registry only; bridge-job notification integration is **not implemented**.
- dispatchFromHermes.onSessionCreated is the pre-engine origin binding seam;
  automatic Hermes notification origin binding there is **not integrated** here.
- Fanout runner tryJoinFanOut accepts failed OR succeeded item terminals and then
  marks the join succeeded. That means settled, not all-pass. Projection checks
  all durable children and verdict fail/repair, not join status alone.
- Strict coordinator terminal + atomic appendCodingResult exist only in the
  separate coordinator repair worktree. They were not imported/copied and are
  **not available in this candidate**.
- Runner cancellation late completion is unfenced in reviewed repository/runner
  writes. Actual runtime reproduction was not performed; no unrelated runner fix.
  Qualifier refuses success with cancelledAt, pending children, failed/cancelled
  rows, failed/repair verdicts or an unresolved pending approval.

Additional fail-closed ceiling: repository updateRunStatus uses COALESCE for the
pending approval ID, so a null patch cannot clear a historical reference here.
This projection conservatively withholds success for such a reference; it cannot
prove the approval resolved. Fixing source lifecycle/approval clearing remains
separate parent review, not a silent notification-side bypass.

## Phase 2 — minimal implementation, one repair attempt

Preserved prior writer's registry projection, owner/origin checks, stable publication
snapshot keys and strict subscriber labels. This continuation changed only service
qualification/opaque idle and added two terminal tests. Service now:

- prioritizes unresolved pendingApprovalId as approval-request with exact reference;
- allows completion only for durable succeeded run, no approval/cancellation marker,
  nonempty all-succeeded settled stages, no fail/repair verdict;
- emits progress, not completion, for unqualified opaque busy→idle.

The source registry remains lifecycle owner. Publication hashes stage ID/status/
attempt-count/attempt-ID, not tokens, usage, model output or timestamps. Historical
outbox events are not deleted/requalified; no destructive cleanup or data migration.
No second repair to restore the unsafe expectation. All preexisting tests/assertions
remain unchanged. This is **BLOCKED**, not an all-green candidate.

### Current sandbox checks (after E, RHYTHM_LIVE_E2E=1)

```sh
export RHYTHM_LIVE_E2E=1
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status && (
  export HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db"
  export RHYTHM_OPENCODE_ENGINE_PORT=4897 RHYTHM_MOBILE_GATEWAY_PORT=4899 PROD_API_URL=http://127.0.0.1:4898
  sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/terminal-green.db'" &&
    env DB_PATH="$RHYTHM_SANDBOX_DIR/terminal-green.db" node --test tools/dev/hermes_notify_terminal_contract.mjs
  terminal=$?
  sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/workflow-green.db'" &&
    env DB_PATH="$RHYTHM_SANDBOX_DIR/workflow-green.db" node --test tools/dev/hermes_notify_workflow_contract.mjs
  workflow=$?
  sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/journal-green.db'" &&
    env DB_PATH="$RHYTHM_SANDBOX_DIR/journal-green.db" node --test tools/dev/hermes_notify_journal_contract.mjs
  journal=$?
  node --test tools/dev/hermes_notify_acceptance.mjs tools/dev/hermes_notify_live.mjs &&
    node tools/dev/hermes_notify_restart.mjs before && tools/dev/sandbox.sh restart &&
    tools/dev/sandbox.sh status && node tools/dev/hermes_notify_restart.mjs after &&
    python3 -B tools/dev/hermes_notify_consumer_live.py
  live=$?
  node --test tools/dev/hermes_notify_workflow_live.mjs
  workflowlive=$?
  env -i HOME="$HOME" HERMES_HOME="$HOME/native-fixture" PATH=/opt/homebrew/bin:/usr/bin:/bin \
    /opt/homebrew/bin/python3 -B tools/dev/hermes_native_atomic_contract.py /Users/ajhochhalter/.hermes/hermes-agent
  native=$?
  printf 'RESULTS terminal=%s workflow=%s journal=%s live=%s workflowlive=%s native=%s\n' \
    "$terminal" "$workflow" "$journal" "$live" "$workflowlive" "$native"
)
result=$?; tools/dev/sandbox.sh down; teardown=$?
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN
test "$result" -eq 0 && test "$teardown" -eq 0
```

Observed **terminal=0 workflow=0 journal=1 live=0 workflowlive=0 native=0**.
Outer exit0 is not all-tests-green; printf is the final command. Exact outcomes:

- terminal3pass/0fail; workflow5pass/0fail (three independent synthetic durable
  run IDs, exact origins, child idle/tokens, question/permission refs, retry/reopen,
  aggregate success/error/approval, cross-owner rejection).
- Preserved journal **5pass/1fail**, line30 expects final kind completion after
  session.error and idle; actual final kind progress. Count remains6 and all other
  identity/replay/auth/ACK/ref/transfer assertions pass. User requires no
  idle==qualifiedsuccess AND preservation of this old assertion; cannot honestly
  claim both green. Parent must resolve the explicit contract conflict; do not
  restore unsafe behavior or change the assertion covertly.
- HTTP/real engine4pass. Output `LIVE: actual fork session.updated -> durable
  notification; no Hermes wakeup claimed`. No completed provider turn.
- `RESTART before: 1 durable pending events`; `RESTART after: 1 identical
  IDs/cursors/payloads recovered`, before consumer drain.
- `PASS: real SSE -> durable busy inbox -> consumer reopen -> one fixture
  transcript row -> visible ACK; NOT actual Hermes`.
- workflow HTTP/SSE1pass: three synthetic registry states independently reach
  real authenticated routes with completion/approval/error, accepted replay IDs
  and cursors. Direct registry fixture transitions, **not real coordinator runs**.
- Native atomic command printed PASS quoted below.

Initial API75909/engine76004/gateway75909; after actual owned sandbox restart,
API79749/engine79814/gateway79749. No Pi/native runtime restart. Teardown passed;
no listeners; diagnostics `.evidence.a7qHbd`.

Python/static exact command at root:

```sh
python3 -B tools/dev/test_hermes_notify_subscriber.py -v &&
python3 -B tools/dev/test_hermes_notify_repair.py Repairs -v &&
python3 -B tools/dev/test_hermes_notify_workflows.py WorkflowContract -v &&
node apps/api_server/node_modules/typescript/bin/tsc -p apps/api_server/tsconfig.json --noEmit &&
git diff --check
```

Exit0: Ran6 OK, Ran10 OK (6 inherited +4 repair), Ran8 OK (6 inherited +2 new).
API typecheck/diffcheck silent exit0. Thus preserved20notify = **19pass/1fail**,
not26 or all20green. New workflow/terminal/HTTP/Python checks =11 unique pass;
native source atomic test counted separately, not Hermes end-to-end acceptance.

Preserved49 bootstrap/neighbor checks, exact command in `apps/api_server` after E:

```sh
../../tools/dev/sandbox.sh up && ../../tools/dev/sandbox.sh status &&
env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db" \
  RHYTHM_OPENCODE_ENGINE_PORT=4897 RHYTHM_MOBILE_GATEWAY_PORT=4899 PROD_API_URL=http://127.0.0.1:4898 \
  node node_modules/vitest/vitest.mjs run \
  src/__tests__/hermes_notify_bootstrap.test.ts \
  src/__tests__/issue_1491_local_trigger_delivery.test.ts \
  src/middleware/local_agent_surface_guard.test.ts \
  src/__tests__/issue_755_role_separation.test.ts src/__tests__/relay_role.test.ts \
  src/__tests__/agent_local_auth_bypass.test.ts src/__tests__/server_shutdown_signal_contract.test.ts \
  src/__tests__/issue_1375_transcript_share_purge_startup.test.ts --no-file-parallelism
result=$?; ../../tools/dev/sandbox.sh down; teardown=$?
test "$result" -eq 0 && test "$teardown" -eq 0
```

Exit0: **8 files /49 tests pass**, no failures/skips. API89775/engine89869/gateway89775.
Teardown passed; diagnostics `.evidence.VCVX2A`. No existing webhook/CORS/security,
startup or shutdown assertion changed.

## Actual native storage proof — bounded, not Pi

Read-only local source `/Users/ajhochhalter/.hermes/hermes-agent`, AGENTS first,
HEAD `68518c1f9bca11d9f5dbdf59ecf7e024cce057ba`; targeted hermes_state.py status clean.
SHA256 `1752d22d6a888985e2ac6c04514aec5f0f82ee506b6ca69288cf6ffaee97a42f`.
Reviewed actual append_message closure10525–10669, write boundary4912–5040 and
admission guards10369–10478. Source is archived as tracked Python files only,
no .env/.git; imports use disposable copy, clean env and isolated HOME/HERMES_HOME.
No installed runtime imports, installed config/live state access or provider calls.

Expanded RED sandbox used these commands (also atomic rerun during GREEN):

```sh
env -i HOME="$RHYTHM_SANDBOX_DIR/home" HERMES_HOME="$RHYTHM_SANDBOX_DIR/home/native-fixture" \
  PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/python3 -B \
  tools/dev/hermes_native_receipt_contract.py --source /Users/ajhochhalter/.hermes/hermes-agent --baseline
env -i HOME="$RHYTHM_SANDBOX_DIR/home" HERMES_HOME="$RHYTHM_SANDBOX_DIR/home/native-fixture" \
  PATH=/opt/homebrew/bin:/usr/bin:/bin /opt/homebrew/bin/python3 -B \
  tools/dev/hermes_native_atomic_contract.py /Users/ajhochhalter/.hermes/hermes-agent
```

Stock baseline fails for the stated reason: `event replay produced 2 native
transcript effects, expected 1` (exit1). Actual native subclass test passes (exit0):
`PASS: actual native append closure + atomic receipt/reopen/digest/revocation/rollback;
persisted NOT wake/visible ACK`. It invokes native SessionDB.append_message and
native BEGIN IMMEDIATE/_execute_write; abort trigger after native insert proves
rollback, then retry succeeds; busy real turn lease refuses insertion, replay/reopen
deduplicate, changed identity and revoked origin refuse. No generic SQLite fixture
was relabeled native Hermes. This qualifies only this local source version/storage.

Retained hermes_native_atomic_receipt.py is a **source artifact, not a runnable
subscriber adapter**: persist_notification returns state persisted, never visible;
does not provide owns/deliver or wake. It calls native append_message as assistant,
which currently writes an active provider-history row. Therefore cache-safe,
role-alternating, display-only delivery is **not qualified** and it must not be
installed into a live session. The old hermes_native_receipt_contract.py nonbaseline
branch references missing hermes_native_receipt.NativeReceiptAdapter and expects
visible/inactive semantics; that branch was NOTRUN, is not an available adapter,
and must not be offered as a working Pi command. Retained unchanged for parent
review rather than inventing a fake visible acknowledgment.

## Pi handoff — nonrestarting procedure and specific missing artifact

Exact tested candidate Pi-facing source files: hermes_notify_subscriber.py
(strict outbound owner-bearer SSE/local inbox), hermes_native_atomic_receipt.py
(native transaction primitive only). Native storage runner is
hermes_native_atomic_contract.py, not a deployed service. These are local-version
tested source, **not Pi-version tested files**. No turnkey Pi adapter exists yet.

Protocol identified in prior source receipt: authenticated `/api/ws`, JSON-RPC
session.resume `{session_id: STORED_SYNTHETIC_ID}` returns live session_id plus
stored_session_id; prompt.submit `{session_id: LIVE_SYNTHETIC_ID, text: FIXED_INPUT,
queued: true}` is a native turn request, not passive notification. Busy/in-memory
queues are not durable receipts. Alternate authenticated `/v1/chat/completions`
with X-Hermes-Session-Id is a different surface; in-memory idempotency300seconds
does not establish restart dedup. Neither HTTP200 nor enqueue proves visibility.
Existing private relay is device-auth/mobile-gateway buffered finite RPC, not an
owner-bearer notification SSE tunnel. No connectivity/config changes attempted.

Specific parent/operator request, **not a new general scope approval request**:
provide a sanitized Pi Hermes+WebUI version/source artifact; existing authorized
private route/protocol capability for owner-bound notification replay+ACK (no
secrets); original stored/live synthetic-session mapping; and the WebUI's supported
receipt/render observation method plus an approved deterministic offline provider
fixture. If the existing ingress cannot supply these semantics, have its owner
approve a separately scoped source/protocol change. Do not widen device/bearer
auth or configure a new relay/listener to make this candidate appear to work.

After those artifacts exist, Hermes/operator can execute this safe sequence without
restarting or reconfiguring installed services:

1. Read exact Pi revision and protocol capability, confirm current authenticated
   owner and disposable synthetic original session. Never substitute AJ's real chat.
2. Through that existing native session-create/resume surface, create/resume only
   the synthetic conversation with an already approved deterministic offline
   responder. Fixed input can be `Synthetic notification receipt check; reply
   SYNTHETIC_READY only.` Do not submit if it would reach a real provider or tools.
3. Obtain returned stored/live IDs; register the tuple locally under that owner.
   Bind notification origin before dispatch at the existing onSessionCreated seam.
   Three separate synthetic workflows retain independent run/origin/session IDs.
4. Drive actual coordinator state transitions, not token/idle guesses, through
   the qualified existing private transport to the local durable inbox. Record
   eventId/cursor and ingestion proof, with secrets redacted. accepted only after
   durable inbox write. Keep busy events pending; never steer/interrupt a live turn.
5. A version-qualified native adapter must atomically persist/deduplicate within
   native SessionDB with cache/role-safe presentation semantics, then invoke the
   supported original-session wake path. Observe native wake independently.
6. Assert original WebUI transcript/render contains exactly one intended update;
   close/reopen the browser, repeat/reconnect and verify same original session,
   one effect and durable recovery. Emit visible ACK only from a qualified receipt.
   Do not restart installed Hermes to test crash recovery; use disposable runtime.

This is a conditional procedure, **NOTRUN**. It cannot be executed honestly with
the missing Pi artifacts. No real records were found/provided for Encompass
security-map, Rhythm-notify approval or separate Opus review; the three named
contracts above are independent synthetic examples, not actual workflow reports.

## Gate matrix / remaining blockers

| Gate | Current result |
|---|---|
| Registry terminal safety / additive contracts | PASS bounded,3+5+1+2 unique |
| Existing20 notification checks | **19 PASS /1 FAIL**, preserved unsafe idle expectation |
| Preserved49 bootstrap/auth/startup checks | PASS |
| Real fork event → Rhythm HTTP/SSE/restart → fixture inbox | PASS bounded; no provider/model completion |
| Actual native SessionDB atomic storage | PASS isolated local-version source fixture |
| Actual event → existing private relay → Pi inbox ingestion | **BLOCKED /NOTRUN**, no qualified protocol artifact |
| Original Hermes synthetic conversation wakeup | **BLOCKED /NOTRUN** |
| Original Hermes visible WebUI update | **BLOCKED /NOTRUN** |
| Browser-closed/reopen delivery | **BLOCKED /NOTRUN** |
| Bridge/coordinator origin-before-dispatch and canonical approval-card hook | NOT integrated; parent ownership |
| Native cache/role/display-safe receipt adapter | BLOCKED; source primitive writes active history |
| Offline/overflow source recovery | Not lossless; hub ceiling unchanged |
| Runner cancellation stale-write fix | Source issue flagged, runtime not reproduced, not patched |
| Independent verification / new-head CI | Pending parent; no commits/push |

Overall **BLOCKED**. Do not commit as ready, merge or deploy. One repair attempt,
no endless retries; parent must resolve contract conflict and missing target
protocol/artifact. This is not a provider failure or host permission denial.

## Files / fingerprints

Tracked changes retained: apps/api_server/src/services/hermes_notify_service.ts,
tools/dev/hermes_notify_subscriber.py. Untracked retained: the seven files below.
Continuation edited only service and terminal contract; added this run. All other
retained files preserved, no reset/deletion. Dedicated run is the durable handoff;
unrelated project-state/current-plan were not overwritten.

| Path (tools/dev unless specified) | SHA256 |
|---|---|
| apps/api_server/src/services/hermes_notify_service.ts | `5a2dea370bef861ebe8618dd4222dabf1c3e1e965b5f67f0970689c05ec2bb1f` |
| hermes_notify_subscriber.py | `08026273643f59277fe3b03083840cf75c784d5d9551d4fb522d4f243e1b7ca7` |
| hermes_native_atomic_contract.py | `c3f7a7af609783f42e021a2ffe3f4cc12944497c9ca8303a426a13c65221546c` |
| hermes_native_atomic_receipt.py | `2e6c42d8ad2f3d8923e1277a57c13778ca22d0e5cd8331faabc243d2e465cda1` |
| hermes_native_receipt_contract.py | `4f2b7c291c9783b771277e53495a1db7d7f2955dd27f1bdd38591dae71b9c77c` |
| hermes_notify_terminal_contract.mjs | `0936a59c70f6ceae43e25009ed75e392cb5affc853d763bef54da7b37dd626ea` |
| hermes_notify_workflow_contract.mjs | `3701015984b7c239ecbb5c86340328d7fcda14ed6741d1cd2f3593052dad2fb9` |
| hermes_notify_workflow_live.mjs | `548d356c775b28396044f3ab2d9a87c98877f78c8122db7abfe654486b24d43d` |
| test_hermes_notify_workflows.py | `2d5ac342ab337ec719dae77ddb31cfd4a4eaf4a59504b8a9a1f568a739495884` |

Final source review before note: git diff --check passed; tracked diff75 additions,
2 deletions across two files. git diff --exit-code on old journal/bootstrap tests
passed (unchanged). HEAD unchanged, sandbox absent, no4898/4897/4899 listeners.
Fingerprint command: `shasum -a 256` on the nine listed source/test paths.

## Authorized correction — completed bounded GREEN / parent handoff

**READY_FOR_BOUNDED_VERIFICATION; primary acceptance remains BLOCKED.**
Historical BLOCKED/RED statements above describe the prior continuation, not the
current corrected test result. Only the explicit contract conflict is resolved.
No actual Hermes/Pi ingestion, wakeup, visible update or browser-closed acceptance
is claimed. Parent independent gate is next; no commit/push or integration.

### Files and safety rationale

This continuation changed exactly:

- `tools/dev/hermes_notify_journal_contract.mjs`: changed only the old final-kind
  expectation from completion to progress, added explicit zero completion for the
  same opaque error/question/permission/idle sequence, and a separate real
  repository/SQLite test requiring a durable terminal AND both successful children.
  The new test asserts no completion before durable terminal or with pending child,
  then exactly one completion with correct original session and aggregate label.
- `docs/ai/runs/2026-10-13-hermes-coordinator-native-integration.md`: this receipt.

All existing tests remain runnable. No skips/removals or auth/hash/cursor/error
assertion weakening. Product service, subscriber and every retained candidate file
have identical before/after fingerprints. This is a **stronger safety contract**
reflecting the user's explicit no-idle-as-success criterion, not a covert test
change to excuse unsafe product behavior or a full-acceptance pass waiver.
One validation attempt after correction, zero repair attempts; max two respected.

### Exact current check command

Run from the assigned worktree root with environment E above, adding
`export RHYTHM_LIVE_E2E=1`. The executed shell uses fail-fast inside the subshell
and captures result before teardown; unlike the old printf-final aggregate it
cannot return success after an earlier test failure:

```sh
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status && (
  set -e
  export HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db"
  export RHYTHM_OPENCODE_ENGINE_PORT=4897 RHYTHM_MOBILE_GATEWAY_PORT=4899 PROD_API_URL=http://127.0.0.1:4898
  sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/journal-corrected.db'"
  env DB_PATH="$RHYTHM_SANDBOX_DIR/journal-corrected.db" node --test tools/dev/hermes_notify_journal_contract.mjs
  sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/terminal-corrected.db'"
  env DB_PATH="$RHYTHM_SANDBOX_DIR/terminal-corrected.db" node --test tools/dev/hermes_notify_terminal_contract.mjs
  sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/workflow-corrected.db'"
  env DB_PATH="$RHYTHM_SANDBOX_DIR/workflow-corrected.db" node --test tools/dev/hermes_notify_workflow_contract.mjs
  node --test tools/dev/hermes_notify_acceptance.mjs tools/dev/hermes_notify_live.mjs
  node tools/dev/hermes_notify_restart.mjs before
  tools/dev/sandbox.sh restart
  tools/dev/sandbox.sh status
  node tools/dev/hermes_notify_restart.mjs after
  python3 -B tools/dev/hermes_notify_consumer_live.py
  node --test tools/dev/hermes_notify_workflow_live.mjs
  python3 -B tools/dev/test_hermes_notify_subscriber.py -v
  python3 -B tools/dev/test_hermes_notify_repair.py Repairs -v
  python3 -B tools/dev/test_hermes_notify_workflows.py WorkflowContract -v
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
printf 'CORRECTED allchecks=%s teardown=%s\n' "$result" "$teardown"
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN
test "$result" -eq 0 && test "$teardown" -eq 0 && test ! -e "$RHYTHM_SANDBOX_DIR"
```

### Observed output / count reconciliation

Exit0, `CORRECTED allchecks=0 teardown=0`. Same canonical4898/4897/4899 sandbox,
all four explicit paths, fixture DB/config0400 unchanged; no auth fallback.
API tsc/postbuild passed during up (also baseline up); final noEmit and diffcheck
passed silently. Launcher MCP build uses --noCheck, not a typecheck claim.
Own unchanged prebuilt fork reused; no new fork build claim. Transient curl
connection refusal preceded readiness, not an acceptance failure.

- Corrected journal: **7 PASS /0 FAIL**, six old checks plus one additive two-child
  qualification test. Historical conflicting journal baseline:5 PASS /1 FAIL.
- Old20notify now **20 PASS /0 FAIL**: six original journal, four HTTP/engine,
  six subscriber and four unique repair tests. Python repair Ran10 includes six
  inherited repeats; do not count those twice. Explicit **old RED19 PASS /1 FAIL**
  remains above; it is not relabeled a historical pass.
- Retained new11unique coordinator contracts: **11 PASS /0 FAIL** = terminal3,
  workflow5, real workflow HTTP/SSE1, Python WorkflowContract2 new. WorkflowContract
  Ran8 includes six repeated originals. New journal qualification is **one extra**,
  not silently counted as part of the retained11. These workflows are synthetic
  registry fixtures, not actual coordinator/native workflow executions.
- Neighbors: **8 files /49 PASS /0 FAIL**, no skips.
- Restart: `RESTART before: 1 durable pending events`, then
  `RESTART after: 1 identical IDs/cursors/payloads recovered`, before consumer drain.
- Engine: `LIVE: actual fork session.updated -> durable notification; no Hermes wakeup claimed`.
- Consumer: `PASS: real SSE -> durable busy inbox -> consumer reopen -> one fixture transcript row -> visible ACK; NOT actual Hermes`.
- Native source storage separately: `PASS: actual native append closure + atomic receipt/reopen/digest/revocation/rollback; persisted NOT wake/visible ACK`.
  Only tracked Python source archived/imported into disposable HOME/HERMES_HOME;
  no active installed runtime, protected config/state or provider access. Native
  source HEAD `68518c1f9bca11d9f5dbdf59ecf7e024cce057ba`, hermes_state.py hash
  `1752d22d6a888985e2ac6c04514aec5f0f82ee506b6ca69288cf6ffaee97a42f` unchanged.

Initial API59158/engine59252/gateway59158; after owned sandbox restart
API62738/engine62796/gateway62738. Stock down passed, sandbox absent (including
symlink check), final lsof no listeners. Diagnostics:
`/private/tmp/hermes-event-notify-20261012-sandbox.evidence.FqUqSB`.
No unknown process stopped; no Pi/Hermes/container restart. No desktop signature,
drive/email/billing/real-card/communications, network/relay/Tailscale operations,
deployment, live migration, destructive cleanup, commit or push.

### Current fingerprints / preserved blockers

Before journal SHA256:
`118b2d0cddad9aeb0e254121dd4d26380af396f85e119f7cfaf936c40fd6183b`.
Corrected journal SHA256:
`0e257f073e1355bf4edf9afe0896ba7cfd68e93f7a8c9c4fdeb2cda66078fa67`.
All nine retained source/test SHA256 values in the preceding table were rerun and
remain identical. HEAD unchanged at18c53596. Fixture DB SHA256
`9bc96d72845b21e982b7aff0f85daf7b1992828456bc0fc5dab2a4f17334f77a`;
config SHA256 `276e4c0c5e0729b762d8c50c4bcf6e41270660a927f6e8773ec58d17bd4a645f`.
Final git diff review shows only authorized journal delta beyond retained dirty
candidate; bootstrap/security tests untouched. No unrelated memory overwrite.

**Primary acceptance BLOCKED intact:** Pi ingest, original Hermes wakeup, actual
visible WebUI update and browser-closed/reopen delivery remain BLOCKED/NOTRUN.
Exact missing sanitized Pi/WebUI revision/source, authorized existing private
protocol/replay/ACK capability, original stored/live synthetic mapping, supported
render receipt and approved offline responder requirements, plus the conditional
safe nonrestarting six-step procedure in “Pi handoff” above, carry forward unchanged.
No turnkey safe display-only/cache-safe adapter exists; active-history storage
primitive must not be installed live. Real-dispatch binding/canonical card hook,
bridge-job projection, offline/overflow completeness and runner cancellation
fencing remain unqualified/not integrated as documented. Parent verifier can
rerun the command on this artifact with only disposable runtime writes; parent
must independently gate before any broader readiness claim.

## Guard repair round 1 — independent FAIL25cf0610

Parent reports independent81 unique checks passed and native atomic storage passed
separately, but three actual built-service/repository/SQLite probes FAILED:
unbound same-owner origin adoption accepted; fail→repair same-attempt publication
counts2→2; unknown succeeded-stage verdict produced completion1. Exact independent
probe transcript was not supplied in this dispatch; these are parent-reported
outputs, not a fabricated independent transcript. Local reproductions below are
the exact observed output. No bounded acceptance PASS is claimed from those81.

Sole writer retains HEAD18c53596 and all prior dirty work. Approved scope is only
these three root-cause guards in hermes_notify_service.ts, additive actual-repository
guard tests, valid fixture binding corrections, and this run. All earlier exclusions
carry forward unchanged; no commits/push, no runner/coordinator import or repair.
Parent independently verifies read-only candidate with disposable runtime writes.
Loaded acceptance-contract first, then coding-agent; mandatory memory files read.

### Phase 0 completed — actual repository RED before product edits

Added tools/dev/hermes_notify_guard_contract.mjs. Mandate: pass its immutable
assertions, preserving all81 prior checks except authorized valid fixture binding
corrections. Command from root with environment E above:

```sh
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status &&
sqlite3 "$RHYTHM_SANDBOX_DIR/rhythm.db" ".backup '$RHYTHM_SANDBOX_DIR/guard-red.db'" &&
env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/guard-red.db" \
  node --test tools/dev/hermes_notify_guard_contract.mjs
result=$?; tools/dev/sandbox.sh down; teardown=$?
printf 'GUARD_RED checks=%s teardown=%s\n' "$result" "$teardown"
test "$result" -eq 1 && test "$teardown" -eq 0
```

Observed5 tests /0 PASS /5 FAIL, no skips, all failures behavioral:

1. existing run refuses unbound same-owner adoption and other-run binding:
   `Missing expected exception.` at29 (unbound bind accepted).
2. same-attempt fail to repair publishes distinct sanitized event and replays
   identical IDs: `2 !== 3` at43.
3. unknown durable verdict withholds completion through actual JS repository:
   `1 !== 0` at56.
4. gate missing verdict and unknown stage/status refuse success; legitimate null
   children qualify once: `gate/undefined`, `1 !== 0` at67.
5. cancellation marker changes publication identity even when qualified status
   is unchanged: `2 !== 3` at80.

`GUARD_RED checks=1 teardown=0`. API49502/engine49626/gateway49502;
diagnostics `/private/tmp/hermes-event-notify-20261012-sandbox.evidence.R5VL4F`.
Fixture DB/config0400; ports free and sandbox absent before launch. API build and
postbuild passed; MCP build --noCheck is not typecheck; unchanged prebuilt fork.

### Phase 1 consolidated review completed before product edits

GitNexus upstream HermesNotifyService (HAS_METHOD/HAS_PROPERTY), bind and
syncWorkflows all target-not-found, risk UNKNOWN. Not a zero-radius claim.
Full service, route/SSE callers, journal/workflow/terminal/live fixtures, repository
binding and completion writes, contract kinds/verdicts, full runner and launcher
reviewed. No route handler change, hence no handler API-impact gate required.
Direct callers: origins HTTP→bind; events/SSE→list→syncWorkflows; ingest→syncWorkflows;
bootstrap starts/stops service. Concrete risk remains consequential wrong-origin
delivery/false completion; proportionate RED guards and full81 regressions required.

Actual dispatcher writes BOTH provisional stage session and session run/stage
binding before engine creation, then commits exact returned session. Existing run
membership must verify both sides; same owner alone is insufficient. No trusted
origin-before-engine integration added. Plain agent success can legitimately have
null outcome (runner processAgent386 and dispatcher710); gate success must have
known verdict (processGate429–443), fanOut join success legitimately null (564),
and settled join alone does not imply all children passed. Unknown stage kinds or
undeclared executions cannot qualify success. pendingApprovalId, raw run status,
cancellation presence, and stage ID/kind/status/attempt/verdict are the complete
decision-relevant publication inputs; usage/model output/timestamps excluded.

### Phase 2 completed — one product repair attempt, GREEN

Small root-cause delta in service only: bind validates matching session run/stage
binding AND actual provisional/committed stage membership for existing runs;
publication identity includes durable verdict, stage kind/ID, raw run status,
pending reference and cancellation presence; terminal qualification allowlists
pass, or null for declared agent/approval/fanOut kinds, but gate requires pass.
Unknown kind, undefined gate verdict, unknown outcome/status cannot complete.
No model output enters identity or event payload. Cancellation boolean reflects
the decision without turning timestamp-only changes into progress publications.

Changed this round:

- apps/api_server/src/services/hermes_notify_service.ts (product guards).
- tools/dev/hermes_notify_guard_contract.mjs (five additive RED→GREEN checks).
- tools/dev/hermes_notify_workflow_contract.mjs (origin is the actual bound stage
  session, not an unbound same-owner synthetic parent; child alias points to that
  dispatch session; all five assertions retained, no waiver).
- tools/dev/hermes_notify_terminal_contract.mjs (real two-sided origin bindings).
- tools/dev/hermes_notify_journal_contract.mjs (two-sided origin binding and
  declares the existing second-child execution in durable definition; unchanged
  qualification/ownership assertions).
- tools/dev/hermes_notify_workflow_live.mjs (two-sided real origin fixture binding
  before authenticated HTTP origin request; asserts both writes succeeded).
- this dedicated run note. All other retained dirty files unchanged.

Exact GREEN command is the existing “Exact current check command” at464–501 above,
with E and RHYTHM_LIVE_E2E=1 unchanged, and this fail-fast block inserted immediately
after the subshell exports and before journal backup:

```sh
sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/guard-green.db'"
env DB_PATH="$RHYTHM_SANDBOX_DIR/guard-green.db" node --test tools/dev/hermes_notify_guard_contract.mjs
```

Final printf label was `GUARD_GREEN`, not `CORRECTED`; no other command or gate
changed. All commands ran from the retained worktree root. Observed exit0,
`GUARD_GREEN allchecks=0 teardown=0`:

- guards5 PASS /0 FAIL; all same named checks as RED, assertions unchanged.
- journal7 PASS; terminal3 PASS; workflow5 PASS; HTTP/engine4 PASS; workflow live1 PASS.
- subscriber Ran6 OK; repair Ran10 OK (6 repeated +4 unique); workflow Ran8 OK
  (6 repeated +2 unique). No repeated checks double-counted.
- neighbors8 files /49 PASS, no failures/skips; API noEmit and diffcheck exit0.
- Preserved81 unique PASS +5 new guards =86 unique PASS. This is a repair-validation
  receipt, **not bounded product acceptance PASS**; independent re-verification next.
- `RESTART before: 1 durable pending events` and `RESTART after: 1 identical
  IDs/cursors/payloads recovered`.
- `LIVE: actual fork session.updated -> durable notification; no Hermes wakeup claimed`.
- `PASS: real SSE -> durable busy inbox -> consumer reopen -> one fixture transcript
  row -> visible ACK; NOT actual Hermes`.
- `PASS: authoritative registry -> real HTTP/SSE/replay for three synthetic workflows;
  no Pi/native wake claim`.
- Separate unchanged native source storage check:
  `PASS: actual native append closure + atomic receipt/reopen/digest/revocation/rollback;
  persisted NOT wake/visible ACK`. Storage only, not adapter or visibility qualification.

Initial API70753/engine70859/gateway70753; after owned restart
API74711/engine74780/gateway74711. Teardown0, sandbox absent, lsof no listeners.
Diagnostics `/private/tmp/hermes-event-notify-20261012-sandbox.evidence.vjuUek`.
One repair attempt per criterion, no second attempt needed. No commits/push.

Current fingerprints (`shasum -a 256`), unchanged HEAD18c5359658e580b8d86ea1bca848858bbcd2eabf:

| Changed path | SHA256 |
|---|---|
| apps/api_server/src/services/hermes_notify_service.ts | `204fac0b7e8e9a28a638de37dbda41144598b9a1581e84fcc7d397beab895119` |
| tools/dev/hermes_notify_guard_contract.mjs | `1142af239eaf0a852de7434cb10a3a09c9665a984406ba07f35b49210740c0d5` |
| tools/dev/hermes_notify_journal_contract.mjs | `ff6954025a824ec2eb81109a2c4f896340ab0f709c33337f8e0bdcf7d9f21d43` |
| tools/dev/hermes_notify_terminal_contract.mjs | `644369e8113183c24be680032ae238bd025023237278eae7bde386ddb85f7d14` |
| tools/dev/hermes_notify_workflow_contract.mjs | `8fb42f07d1f2ffe8bdc23432792be28f4b9c9c4ba29aeaf31cf381b367fca684` |
| tools/dev/hermes_notify_workflow_live.mjs | `fc9661a0b4785b6edf53d9f8aa671e51a537198865afb6ede5d755776dfd795d` |

Subscriber, native three files and Python workflow fingerprints remain identical
to the prior table. Fixture DB/config fingerprints remain9bc96d72… /276e4c0c…,
both0400. git diff --check passed after review; prior dirty work preserved.

**READY_FOR_REVERIFICATION only. Primary relay→Pi inbox/wakeup/WebUI visible and
browser-closed gates remain BLOCKED/NOTRUN.** Canonical card references/engine ID
remain unqualified; preengine trusted origin seam not integrated. Native assistant
active-history row is storage proof, not a cache/role/render/wake-safe adapter.
No coordinator/runner cancellation repair, migrations, production/live calls,
permission widening, deployment, merge, destructive cleanup or forbidden host
operation performed. Parent owns independent checks, commits and any wider scope.

## Final bounded repair round 2 — independent FAIL6b09

Parent reports preserved86 independently PASS and prior three defects fixed, but
F1 cleared session membership still publishes completion1 (expected0), and F2
actual JS updateRunStatus PRIVATE_ARBITRARY_STATUS leaks into workflow text.
These are parent-reported independent outputs; local RED below is independently
observable against the real built repository/service, not mocks.
Sole writer preserves HEAD18c53596 and every prior dirty candidate path. Loaded
acceptance-contract first, coding-agent second; read mandatory memory files.
Approved writes: service shared authority/status checks, additive
tools/dev/hermes_notify_revocation_contract.mjs, this existing dedicated run only.
All exclusions, primary Pi blockers and parent-owned final independent gate above
remain unchanged. No orchestrator/peers, commit/push or new tracker authorized.

### Phase 0 complete — fixed RED contract

Mandate: pass all nine named F1/F2 revocation contracts without editing assertions;
retain all86 earlier checks unchanged. Parent final verifier reruns read-only source
with its own disposable runtime writes. With environment E unchanged:

```sh
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status &&
sqlite3 "$RHYTHM_SANDBOX_DIR/rhythm.db" ".backup '$RHYTHM_SANDBOX_DIR/revocation-red.db'" &&
env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/revocation-red.db" \
  node --test tools/dev/hermes_notify_revocation_contract.mjs
result=$?; tools/dev/sandbox.sh down; teardown=$?
printf 'REVOCATION_RED checks=%s teardown=%s\n' "$result" "$teardown"
test "$result" -eq 1 && test "$teardown" -eq 0 && test ! -e "$RHYTHM_SANDBOX_DIR"
```

First run9FAIL included one unrelated fixture UNIQUE failure moving a root stage
to a run with its own root; before any implementation, fixture corrected to a
distinct item_key. F2 also explicitly starts without pendingApprovalId to match
the exact independent text probe, then checks with pending reference as well.
Final immutable RED: **0PASS/9FAIL**, all behavioral. F1 exact completion1!=0;
session-stage/run and stage-session/run and run-owner expose retained history;
session-owner permits direct append; revoked child permits permission event;
F2 text contains `Rhythm workflow PRIVATE_ARBITRARY_STATUS: 0 settled, 1 awaiting.`
and appends a question/reference. Corrected RED API74056/engine74179/gateway74056,
down0/absent, diagnostics `.evidence.Z56sSu`. Initial RED API62678/engine62783,
down0/absent, `.evidence.tRBfh3`. Fixture DB/config0400, ports free before launch.

### Phase 1 complete — consolidated root boundary review

GitNexus upstream HermesNotifyService with HAS_METHOD/HAS_PROPERTY, plus file-scoped
bind/append/list/syncWorkflows/ack/ingest all target-not-found **UNKNOWN**, not zero
radius. Inspected full service, HTTP/SSE handlers, all shared-helper callers,
session binding reads/writes, full durable workflow repository and retained retry
contract. Direct consumers: HTTP origin→bind, GET/SSE→list→syncWorkflows,
hub→ingest→syncWorkflows/append, HTTP→ack, bootstrap start/stop. No route handler
edit. Consequential risks: stale authority publishes/reads/ACKs wrong history,
revoked children signal a valid origin, raw durable status/reference enters labels
or hashed publication identity. Shared current two-sided membership and closed
run-status enum required at every boundary, no per-caller duplicated predicate.
Unknown status policy: omit publication, before text/reference/source construction.
Opaque legacy correlation retains progress/error/question semantics but never
authoritative terminal. History/origins are retained, never reassigned/deleted.

**Discovered contract conflict:** retained workflow test47–55 calls resetForRetry,
which clears BOTH stage session links, then expects new running progress without
rebinding. Exact F1 current membership requires fail-closed in that state. Preserve
the test unchanged, run it, and hand off FAIL if necessary; do not silently change
fixtures/assertions or allow revoked-origin progress merely to regain86green.

### Phase 2 complete — one repair attempt; new GREEN, aggregate FAIL

Small shared service repair: authority validates exact current owner, session run
and stage binding, and that same stage's provisional/committed session membership.
originAuthority applies the same predicate to immutable persisted origin. bind,
syncWorkflows, list, append, ACK and ingest all reuse it; child ingestion also
checks child membership before signaling any origin. No caches/tracker/schema or
permissions added. Closed durable RunStatus allowlist runs before any label,
reference or source construction. Invalid status omits publication (and hides
read/ACK while invalid); no raw invalid status logged, neutral error invented,
or historical row rewritten. Valid pending approval and cancellation behavior
remains tested by retained guards/terminal/live contracts.

Only changed this round:
- apps/api_server/src/services/hermes_notify_service.ts
- tools/dev/hermes_notify_revocation_contract.mjs (nine additive frozen RED checks)
- this existing coordinator/native run note (including current FAIL frontmatter)

Every prior test/subscriber/native artifact remains byte-for-byte unchanged.
One source repair attempt per new criterion. No second attempt: the single
remaining failure is the exact documented contradictory old retry fixture, not
an unresolved F1/F2 defect that can safely be repaired under unchanged criteria.
Workflow round2 limit reached: stop, preserve candidate, hand off **FAIL**.
Independent parent final bounded gate has not run on this new artifact.

#### Exact canonical fail-fast command/result

Environment E plus RHYTHM_LIVE_E2E=1, root cwd. API build/postbuild passed; existing
unchanged prebuilt fork reused; MCP --noCheck build is not a typecheck claim.
The canonical command at464–501 was executed with the four individual backups
replaced by this exact block (revocation first, then all retained contracts):

```sh
for contract in revocation guard journal terminal workflow; do
  sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/$contract-round2.db'"
  env DB_PATH="$RHYTHM_SANDBOX_DIR/$contract-round2.db" \
    node --test "tools/dev/hermes_notify_${contract}_contract.mjs"
done
```

Subshell `set -e` remained active. Final label ROUND2, same down/ports/absent gate:
**`ROUND2 allchecks=1 teardown=0`, exit1**, not a success hidden by teardown.
New revocation9PASS/0FAIL; guard5PASS; journal7PASS; terminal3PASS; workflow4PASS/1FAIL.
Failure at workflow_contract55:
`assert.ok(events(f).some(e=>e.text==='Rhythm workflow running: 0 settled, 1 awaiting.'))`
actual false. Before that assertion, valid completion and unchanged reopen replay
assertions pass. resetForRetry clears provisional_session_id AND
committed_session_id, revoking the origin; projection correctly publishes nothing
and read hides history until actual current membership is restored. Do not
reassign the origin to the next attempt or let that revoked session ACK history.
API99694/engine99799/gateway99694; stock down0, sandbox absent, lsof no listeners.
Diagnostics `/private/tmp/hermes-event-notify-20261012-sandbox.evidence.P6sjAi`.

Canonical fail-fast stopped before the remaining checks. To honor the request to
rerun all86, those unexecuted checks were run once in a separate fail-fast receipt
against fresh stock sandbox, **not relabeled as canonical aggregate PASS**:

```sh
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status && (
  set -e
  export HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db"
  export RHYTHM_OPENCODE_ENGINE_PORT=4897 RHYTHM_MOBILE_GATEWAY_PORT=4899 PROD_API_URL=http://127.0.0.1:4898
  node --test tools/dev/hermes_notify_acceptance.mjs tools/dev/hermes_notify_live.mjs
  node tools/dev/hermes_notify_restart.mjs before
  tools/dev/sandbox.sh restart
  tools/dev/sandbox.sh status
  node tools/dev/hermes_notify_restart.mjs after
  python3 -B tools/dev/hermes_notify_consumer_live.py
  node --test tools/dev/hermes_notify_workflow_live.mjs
  python3 -B tools/dev/test_hermes_notify_subscriber.py -v
  python3 -B tools/dev/test_hermes_notify_repair.py Repairs -v
  python3 -B tools/dev/test_hermes_notify_workflows.py WorkflowContract -v
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
printf 'ROUND2_REMAINDER checks=%s teardown=%s\n' "$result" "$teardown"
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN
test "$result" -eq 0 && test "$teardown" -eq 0 && test ! -e "$RHYTHM_SANDBOX_DIR"
```

Exit0 `ROUND2_REMAINDER checks=0 teardown=0`: HTTP/real engine4PASS;
workflow HTTP/SSE1PASS; subscriber6OK, repair10OK (6 inherited+4 unique),
workflow8OK (6 inherited+2 unique); neighbors8files/49PASS, no skips/failures.
API noEmit/diffcheck pass. Restart before1 durable pending, after1 identical
IDs/cursors/payloads recovered. Consumer output exactly:
`PASS: real SSE -> durable busy inbox -> consumer reopen -> one fixture transcript row -> visible ACK; NOT actual Hermes`.
Separate native storage output exactly:
`PASS: actual native append closure + atomic receipt/reopen/digest/revocation/rollback; persisted NOT wake/visible ACK`.
No native adapter/display/runtime qualification broadened. Initial API8315 /
engine8468 /gateway8315; owned sandbox restart API12248 /engine12317 /gateway12248.
Stock down0, sandbox absent including symlink check, lsof no listeners;
diagnostics `/private/tmp/hermes-event-notify-20261012-sandbox.evidence.kb4flf`.
Transient initial curl refusal occurred before readiness, not a test failure.

All requested86 rerun across the canonical failure and separate remainder:
**85PASS/1FAIL**, plus **9 new PASS**. No inherited repeats double-counted.
Aggregate **94PASS/1FAIL**, storage separately PASS; not READY_FOR_FINAL_BOUNDED_GATE.

#### Fingerprints / durable final handoff

`shasum -a 256` after validation:
- service: `cfef9be9b484aa4f33c4c1c8444f0f3419748a57c2578c309c136619b6ae0427`
- frozen revocation contract: `2e6c7db56d2e474c0ab75703ad681288b7f4df8d5df1119189453206efb9942f`
All six preceding guard/journal/terminal/workflow/live/subscriber fingerprints
match their recorded round1 values; native three and Python workflow unchanged.
Fixture DB `9bc96d72845b21e982b7aff0f85daf7b1992828456bc0fc5dab2a4f17334f77a`,
config `276e4c0c5e0729b762d8c50c4bcf6e41270660a927f6e8773ec58d17bd4a645f`,
both0400 unchanged. HEAD18c5359658e580b8d86ea1bca848858bbcd2eabf unchanged.
Final git diff --check pass; no unrelated file overwrite, source reset or cleanup.

**FAIL honest handoff:** parent must resolve the old retry fixture conflict before
claiming final bounded green. Renewed general scope approval is not requested.
All primary Pi/Hermes ingress/wakeup/visible/browser-closed gates remain
BLOCKED/NOTRUN and the exact missing artifacts/nonrestarting procedure above
carry forward. Trusted preengine/bridge dispatch binding and canonical approval
card hook remain unqualified; raw permission IDs are not canonical cards.
Native SessionDB is storage proof only. No commits/push, production/live4001/4096,
approval4198, shared installs, desktop/signature/drive/email/billing/communications,
cards/network/relay/Tailscale, installed Hermes/container restart, deployment,
merge, migrations, permission bypass or destructive cleanup performed.

## Parent retry-contract resolution — BLOCKED, source immutable

Parent explicitly authorized test-fixture/docs correction ONLY after product
round2 limit, preserving HEAD18c53596 and dirty candidate. Loaded
acceptance-contract first, then coding-agent; read AGENTS/project-state/current-plan.
No orchestrator or peers. Permitted writes are workflow_contract.mjs and this
dedicated note; **only this note changed**. No fixture change can honestly retain
the required running-publication assertion for the actual single-stage retry.
No product repair or assertion weakening, no new scope approval inferred.

WAIVED: a new failing acceptance test before implementation for this non-behavioral
test/docs-only contract review. No implementation is authorized or performed.
The retained conflicting test was nevertheless rerun before any edits: workflow
4PASS/1FAIL at55, expected running publication, actual false. Historical round2
**94PASS/1FAIL** remains historical; current rerun below is also94PASS/1FAIL.
Parent is the independent verifier and can rerun against read-only source with
only disposable sandbox writes. No READY_FOR_FINAL_BOUNDED_VERIFICATION claim.

### Phase 1 — actual supported semantics, not an invented rebind

GitNexus query `resetForRetry recipe workflow runner dispatch bindProvisionalSession`
located the repository and actual dispatcher. Upstream impact on
`tools/dev/hermes_notify_workflow_contract.mjs`, repo Rhythm, includeTests true:
target not found, risk UNKNOWN. Not proof of zero callers/processes. Entire intended
workflow contract, actual runner/dispatch binding surface, notifier authority and
immutable-origin guards, and canonical launcher were inspected before edits.
No HIGH/CRITICAL rating returned; no shared product path edited. Consequential risk
is test-fixture fabrication that silently revives revoked authority.

Actual source establishes:

- recipe_workflow_repository.ts369–378 clears provisional AND committed session
  links on reset. advanceTo287 invokes reset on repair-loop re-entry.
- recipe_workflow_runner.ts362–375 claims pending→running, dispatches anew;
  createAgentRunnerDispatcher660–676 binds the **new onSessionCreated session** on
  both stage and session sides; commitSession700 commits the returned same session.
- dispatch_agent_stage.ts24–25 invokes runner.run, omitting parentSessionId.
  agent_runner.ts1118–1137 calls _recordSession for each run, then onSessionCreated;
  _recordSession663 inserts a fresh session. No retained-session retry/rebind path
  is supplied here. No actual provider turn or runner dispatch was invoked.
- hermes_notify_service.ts35–47 requires exact current two-sided membership.
  Reset therefore hides retained history, refuses new publication and ACKs.
  bind79–80 rejects another session origin for the same durable run with409;
  retained origin is immutable, not transferable to the fresh attempt.

**Exact blocker:** this fixture's origin IS the only stage session. Reset revokes
that origin. Legitimate next-attempt binding uses a different session and cannot
restore that origin's authority; binding the new session as the same run's origin
is forbidden. Thus `Rhythm workflow running: 0 settled, 1 awaiting.` cannot be
published to the original origin under actual retry semantics. Rebinding the old
session would invent runner behavior; deleting/reassigning its origin would weaken
guards. Both are excluded. A distinct still-current stage origin can remain valid
while another stage retries, but that is a different multi-stage case, not proof
of this single-stage assertion (nor its exact0-settled label). No substitute case
was used to hide the conflict. Requested split cannot make this contract GREEN
without changing its supported scenario or product semantics; stop as instructed.

### Phase 0 baseline and Phase 2 full95 rerun — exact commands

All commands used worktree root and environment E above (four canonical paths,
4898/4897/4899, fixture DB/config0400), plus RHYTHM_LIVE_E2E=1 for full95. Before each
up, sandbox absent (including symlink) and lsof showed all three ports free. No
unknown process stopped. Existing unchanged prebuilt fork reused, not rebuilt.
Each stock up built actual API with tsc/postbuild PASS; launcher MCP --noCheck is
not a typecheck claim. No shared installs or alternate launcher.

Baseline after E:

```sh
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status &&
sqlite3 "$RHYTHM_SANDBOX_DIR/rhythm.db" ".backup '$RHYTHM_SANDBOX_DIR/workflow-contract-resolution-red.db'" &&
env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/workflow-contract-resolution-red.db" \
  node --test tools/dev/hermes_notify_workflow_contract.mjs
result=$?; tools/dev/sandbox.sh down; teardown=$?
printf 'RETRY_BASELINE checks=%s teardown=%s\n' "$result" "$teardown"
test "$result" -eq 1 && test "$teardown" -eq 0 &&
  test ! -e "$RHYTHM_SANDBOX_DIR" && test ! -L "$RHYTHM_SANDBOX_DIR"
```

Observed checks1/teardown0; workflow4PASS/1FAIL, no skips. API50394/engine50510,
gateway50394; diagnostics `.evidence.oTdAqD`. The expected-failure shell exit0
does NOT mean acceptance passed.

Full95 puts the known failing workflow LAST so every other check actually runs;
set-e still propagates its failure, not a printf-success aggregate. After E and
`export RHYTHM_LIVE_E2E=1`:

```sh
test ! -e "$RHYTHM_SANDBOX_DIR" &&
(lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN; test $? -eq 1) &&
tools/dev/sandbox.sh up && tools/dev/sandbox.sh status && (
  set -e
  export HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/rhythm.db"
  export RHYTHM_OPENCODE_ENGINE_PORT=4897 RHYTHM_MOBILE_GATEWAY_PORT=4899 PROD_API_URL=http://127.0.0.1:4898
  for contract in revocation guard journal terminal; do
    sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/$contract-contract-resolution.db'"
    env DB_PATH="$RHYTHM_SANDBOX_DIR/$contract-contract-resolution.db" \
      node --test "tools/dev/hermes_notify_${contract}_contract.mjs"
  done
  node --test tools/dev/hermes_notify_acceptance.mjs tools/dev/hermes_notify_live.mjs
  node tools/dev/hermes_notify_restart.mjs before
  tools/dev/sandbox.sh restart
  tools/dev/sandbox.sh status
  node tools/dev/hermes_notify_restart.mjs after
  python3 -B tools/dev/hermes_notify_consumer_live.py
  node --test tools/dev/hermes_notify_workflow_live.mjs
  python3 -B tools/dev/test_hermes_notify_subscriber.py -v
  python3 -B tools/dev/test_hermes_notify_repair.py Repairs -v
  python3 -B tools/dev/test_hermes_notify_workflows.py WorkflowContract -v
  node apps/api_server/node_modules/vitest/vitest.mjs run --root apps/api_server \
    src/__tests__/hermes_notify_bootstrap.test.ts \
    src/__tests__/issue_1491_local_trigger_delivery.test.ts \
    src/middleware/local_agent_surface_guard.test.ts \
    src/__tests__/issue_755_role_separation.test.ts src/__tests__/relay_role.test.ts \
    src/__tests__/agent_local_auth_bypass.test.ts src/__tests__/server_shutdown_signal_contract.test.ts \
    src/__tests__/issue_1375_transcript_share_purge_startup.test.ts --no-file-parallelism
  node apps/api_server/node_modules/typescript/bin/tsc -p apps/api_server/tsconfig.json --noEmit
  git diff --check
  sqlite3 "$DB_PATH" ".backup '$RHYTHM_SANDBOX_DIR/workflow-contract-resolution.db'"
  env DB_PATH="$RHYTHM_SANDBOX_DIR/workflow-contract-resolution.db" \
    node --test tools/dev/hermes_notify_workflow_contract.mjs
)
result=$?; tools/dev/sandbox.sh down; teardown=$?
printf 'CONTRACT_RESOLUTION allchecks=%s teardown=%s\n' "$result" "$teardown"
lsof -nP -iTCP:4898 -iTCP:4897 -iTCP:4899 -sTCP:LISTEN; ports=$?
test "$result" -eq 1 && test "$teardown" -eq 0 && test "$ports" -eq 1 &&
  test ! -e "$RHYTHM_SANDBOX_DIR" && test ! -L "$RHYTHM_SANDBOX_DIR"
```

Observed `CONTRACT_RESOLUTION allchecks=1 teardown=0`: **94PASS/1FAIL**. This is
not GREEN even though the final expected-failure/teardown verification exits0.
No checks changed or split, count remains95 =86old +9new. Exact outcomes:
revocation9PASS, guards5PASS, journal7PASS, terminal3PASS, HTTP/engine4PASS,
workflow HTTP/SSE1PASS, Python6/10/8 allOK (only6+4+2 unique, inherited repeats not
double-counted), neighbors8files/49PASS, workflow4PASS/1FAIL at55 (same false
running-publication assertion). All95 ran, no skips/removals; API noEmit/diffcheck
exit0. All old auth/identity/source/cursor assertions preserved; new9 byte-unchanged.
Initial API60602/engine60709/gateway60602; stock owned restart API64522/engine64602/
gateway64522. Diagnostics `.evidence.FajpVo`, stock down0/absent/no listeners.
Restart before1durable pending/after1identical IDs/cursors/payloads. Actual fork
session.updated→durable notification PASS; no model/provider completion claimed.
Consumer: `PASS: real SSE -> durable busy inbox -> consumer reopen -> one fixture
transcript row -> visible ACK; NOT actual Hermes`. Workflow HTTP uses synthetic
registry states, not actual coordinator/native execution. No native storage test
was rerun this continuation; no native active history/user interaction.

### Additional actual repository compatibility probe (not a repair loop)

After E, fresh up/status/backup to `$RHYTHM_SANDBOX_DIR/retry-membership-probe.db`,
used `env HOME="$RHYTHM_SANDBOX_DIR/home" DB_PATH="$RHYTHM_SANDBOX_DIR/retry-membership-probe.db"
node --input-type=module -e '<probe below>'`, then captured result, stock down,
checked absent/no listeners exactly as full95 (expected probe result0). Probe
uses built actual service/repositories/SQLite, not mocks or injected runner.
Executable probe body (formatting only expanded from the executed -e argument):

```js
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {initDb,getDb}=require('./apps/api_server/dist/database/db.js');
const {AgentSessionsRepository}=require('./apps/api_server/dist/repositories/agent_sessions_repository.js');
const {AgentCookbookRepository}=require('./apps/api_server/dist/repositories/agent_cookbook_repository.js');
const {RecipeWorkflowRepository}=require('./apps/api_server/dist/repositories/recipe_workflow_repository.js');
const {HermesNotifyService}=require('./apps/api_server/dist/services/hermes_notify_service.js');
assert.match(process.env.DB_PATH,/^\/private\/tmp\/hermes-event-notify-20261012-sandbox\//);
await initDb();
const db=getDb(), sessions=new AgentSessionsRepository(), runs=new RecipeWorkflowRepository(), notify=new HermesNotifyService();
notify.initialize();
const definition={schemaVersion:1,entryStageId:'work',budgets:{maxCostUsd:1,maxTokens:100,maxWallTimeMs:1000,maxStageExecutions:10},stages:[{id:'work',kind:'agent',profileId:'fixture',inputs:{},output:{fields:{}},terminal:true}]};
const recipe=await new AgentCookbookRepository().createAsync({title:'Synthetic retry membership probe',schemaVersion:1,definitionJson:JSON.stringify(definition)});
const run=runs.createRun({recipeId:recipe.id,ownerUserId:1,definition,input:{goal:'synthetic retry'}}), stage=runs.listStageExecutions(run.id)[0], old=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic old attempt',ownerUserId:1});
assert.ok(runs.claim(stage.id,'pending','running'));
assert.ok(runs.bindProvisionalSession(stage.id,old.id));
assert.ok(sessions.bindWorkflowSession(old.id,run.id,stage.id));
notify.bind(1,old.id,'synthetic-hermes',run.id);
runs.commitSession(stage.id,old.id);
runs.recordCompletion(stage.id,{status:'succeeded'});
runs.updateRunStatus(run.id,'succeeded');
const history=notify.list(1).filter(e=>e.workflowId===run.id);
assert.equal(history.filter(e=>e.kind==='completion').length,1);
const rows=()=>db.prepare('SELECT * FROM hermes_notify_events WHERE session_id=? ORDER BY cursor').all(old.id), origins=()=>db.prepare('SELECT * FROM hermes_notify_origins WHERE workflow_id=?').all(run.id), stored=rows(), retained=origins();
runs.resetForRetry(stage.id);
runs.updateRunStatus(run.id,'running');
const reset=runs.listStageExecutions(run.id)[0];
assert.equal(reset.provisionalSessionId,null);
assert.equal(reset.committedSessionId,null);
assert.deepEqual(notify.list(1).filter(e=>e.workflowId===run.id),[]);
assert.deepEqual(rows(),stored);
for(const state of ['accepted','visible']) assert.throws(()=>notify.ack(1,history[0].eventId,state),e=>e.statusCode===404);
const fresh=sessions.insert({agentKind:'',cwd:process.env.HOME,name:'Synthetic fresh attempt',ownerUserId:1});
assert.notEqual(fresh.id,old.id);
assert.ok(runs.claim(stage.id,'pending','running'));
assert.ok(runs.bindProvisionalSession(stage.id,fresh.id));
assert.ok(sessions.bindWorkflowSession(fresh.id,run.id,stage.id));
assert.equal(runs.listStageExecutions(run.id)[0].provisionalSessionId,fresh.id);
assert.equal(sessions.getWorkflowBinding(fresh.id).workflowStageExecutionId,stage.id);
assert.deepEqual(notify.list(1).filter(e=>e.workflowId===run.id),[]);
assert.throws(()=>notify.bind(1,fresh.id,'synthetic-hermes',run.id),e=>e.statusCode===409);
assert.deepEqual(rows(),stored);
assert.deepEqual(origins(),retained);
console.log('CONFIRMED BLOCKED: reset revokes old origin/history/ACK; fresh two-sided retry membership succeeds but immutable run origin returns409; no running publication or reassignment.');
db.close();
```

Observed that exact CONFIRMED BLOCKED line, `RETRY_MEMBERSHIP_PROBE checks=0
teardown=0`; API75977/engine76082/gateway75977, diagnostics `.evidence.CdtRL2`.
This probe confirms the blocker, not delivery acceptance; not counted among95.
Three launches total: baseline, one full95 validation, one compatibility probe;
zero product/test repair attempts, no endless retry.

### Final safety and parent handoff

Service SHA256 remains exactly
`cfef9be9b484aa4f33c4c1c8444f0f3419748a57c2578c309c136619b6ae0427`.
Workflow contract remains `8fb42f07d1f2ffe8bdc23432792be28f4b9c9c4ba29aeaf31cf381b367fca684`;
frozen9 remains `2e6c7db56d2e474c0ab75703ad681288b7f4df8d5df1119189453206efb9942f`.
HEAD remains18c5359658e580b8d86ea1bca848858bbcd2eabf. Retained dirty source preserved.
All earlier exclusions/resolved scope approvals and primary Pi/Hermes ingress,
wakeup, visible WebUI and browser-closed gates remain BLOCKED/NOTRUN. No actual
Pi, native runtime/storage/history writes, user interaction, desktop/signature,
drive/email/billing, relay/Tailscale/network configuration, Hermes/container restart,
deploy/migration/production, shared install, destructive cleanup, commit or push.
Only stock disposable sandbox up/status/restart/down on authorized ports occurred.
This is a workflow-contract compatibility blocker, not a host permission denial.
**BLOCKED**: parent must resolve this exact supported-case incompatibility; no
further product repair is authorized and no final bounded readiness is claimed.
Final verification after note edit: `git diff --check`, `git rev-parse HEAD`,
`git status --short`, `shasum -a 256` on service, revocation/workflow/guard/journal/
terminal/workflow-live/subscriber, native three and Python workflow, plus both
fixtures; `stat -f '%Lp %N'` on fixtures; absent/symlink/lsof checks all exit0.
All hashes match the prior retained values, fixtures9bc96d72…/276e4c0c… still0400;
same dirty candidate paths, HEAD unchanged, no sandbox or listeners. Only this
dedicated note was edited in the contract-resolution continuation.
