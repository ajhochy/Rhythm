---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES, HERMES-APPROVALS]
status: READY_CONSERVATIVECOORD_SOURCE
tags: [run, rhythm]
---

## Scope / resolved parent approval

Explicit PARENTSCOPE_RESOLUTION specialist handoff supersedes the source-producer
blocker in `2026-10-14-hermes-coordinator-source-integration.md`. Missing verified
producer is a capability ceiling, not a reason to block the conservative guard.
Engine question IDs are allowed references, NOT canonical queue/reply authority.
No new workflow approval requested; no orchestrator/peer dispatch performed.

Same exclusive SOURCE worktree: `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014`,
HEAD `c74f4392a6df61979fbe33e620a0077ebb6e0b4b`. Permitted source: notifier,
server, optional persistent coordinator; additive coordinator tests/run notes.
Only notifier required modification. No server/coordinator observer needed:
engine envelopes and authenticated HTTP/SSE replay recompute current rows.
Existing grant checks, execution guards and Recipe verified gates are unchanged.

Excluded/preserved: peer tools/sandbox/E2E work, bridge and approval repositories,
routes, MCP/tools, existing tests, schema/producers, frontend/installed app,
live4001/4096, peer4898/4897/4899 and fixtures, providers, real cards/data,
credentials, network relays/Tailscale, installs/dependency mutations, restart of
live services, commits/push/deploy/destructive cleanup. Canonical own sandbox
up/status/down on4998/4997/4999 retained authorization. No host denial/bypass.

## Files

- Modified existing dirty/untracked `apps/api_server/src/services/hermes_notify_service.ts`.
- Added `apps/api_server/src/__tests__/hermes_coordinator_notify_boundaries.test.ts`.
- Added `apps/api_server/src/__tests__/hermes_coordinator_notify_live.test.ts`.
- Added this note. Frozen four-check contract and three-check source contract unchanged.
- Generated build outputs through canonical sandbox command only; no tool edits.

## Phase 0 — completed before source edits

Loaded acceptance-contract first, then coding-agent. Read AGENTS, project-state,
current-plan, regression registry, prior source-integration record and frozen tests.
Mandate: pass the four unchanged named checks; parent independently reruns read-only.

From `apps/api_server`, shared exact test environment used below:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp TMPDIR=/private/tmp DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow ./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_contract.test.ts --no-file-parallelism
```
Exit1, **4 failed / 0 passed**, duration882ms. Every failure observed a completion
where none was allowed, not an import/schema failure. Frozen names:
1. terminal bridge and idle parent cannot complete two pending coordinator children
2. settled fanout containing a child error cannot publish success
3. canonical child approval blocks completion and publishes only the existing card ID
4. returned_result_unverified remains manual verification, including notifier reopen and replay

## Phase 1 — bounded impact review complete

`gitnexus_impact({repo:'Rhythm',target:'HermesNotifyService',direction:'upstream',relationTypes:['CALLS','IMPORTS','HAS_METHOD','HAS_PROPERTY']})`
returns Target not found / **UNKNOWN**, not a zero-blast-radius result; no HIGH/CRITICAL
rating was returned. Manual review compensates for absent shipping index coverage.
Reviewed the whole notifier and callers: server initialization/start/stop,
trusted bridge pre-engine bind callback, HTTP origin/list/ACK/SSE routes,
canonical approval listener, frozen source/coordinator checks. Internal changed
surface: ingest, bridge replay, card projection, additive scoped read helpers and
question reference status. Reviewed durable conversation contract/get/outcomes,
async delegation repository, grant validation and canonical card list/publication.

Risk: false success and cross-origin card/question leakage. Mitigation: current
owned bridge grant remains necessary; exact designated root/owner/project,
declared goal command and delegation IDs must prove the initial child; repository
unknown outcomes never authorize child publication. Deeper descendants need real
async delegation edges plus matching current session parent/owner/project. Scan
bounded to100 parents/100 edges per parent; coding sources remain fail-closed even
if coverage is incomplete. No arbitrary parent/latest-source lookup. Tests cover
owner/project/target/undeclared-edge mismatch and parent-only spoofing.

## Phase 2 — implementation / actual repair loop

Small root guard in shared bridge replay: coding goals never become completion
from root idle/bridge terminal/child prose. Coarse durable failed/cancelled child
outcome publishes fixed ERROR. Other coding state publishes fixed
`Rhythm returned output; verification pending.`. Source keys include goal
revision/state/link, declared command/delegation IDs/state, coarse outcome,
descendant delegation status/error presence, pending card verdicts and observed
engine question identities; exclude raw output/error/question text and token usage.

Canonical descendant cards publish only actual existing card IDs. Questions
persist fixed summary once in delivery outbox with generation/local session/engine
question identity and expose `engineRequestID` on V2 notification output. No new
reply API, queue, action authorization or verification producer. Known pending
questions withhold ordinary terminal success; resolution clears in-memory hold.
Ordinary no-goal bridge success is `Rhythm agent execution completed.`, explicitly
not verification. Existing Recipe all-pass completion path unchanged.

Attempt1 seven-test command (same test env, both frozen files): exit1, **5 failed /
2 passed**, invalid invented method `listPending`; strict check reported TS2339/
TS7006. Repair used existing canonical `list()` and included scoped descendant
failed/cancelled/error verdict. Attempt2 same seven checks: exit0 **7 passed**,
duration1.75s; strict noEmit exit0. No further implementation repair.

Additive fixture check initially **18 passed / 1 failed**: second primary root
for same owner is not a legitimate canonical source. Corrected NEW fixture to
three distinct owners (one primary root each), preserving every assertion.
Then **19 passed**, duration4.48s. Added question replay test. Final issue check:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp/hermes-coordinator-notify-20261014-sandbox/home TMPDIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox/tmp DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow ./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_contract.test.ts src/__tests__/hermes_coordinator_notify_boundaries.test.ts src/__tests__/hermes_coordinator_notify_live.test.ts src/__tests__/hermes_source_contract.test.ts src/__tests__/hermes_approvals.test.ts src/__tests__/coordinator_conversation_repository.test.ts src/__tests__/coordinator_workflow_runs.test.ts --no-file-parallelism
```
Exit0, **33 passed / 1 skipped**, 6 files passed / 1 skipped, duration7.12s.
Breakdown: frozen4 + bridge3 + boundaries8 + approval5 + conversation6 + workflow7.
Live skip is deliberate when flag absent, not counted as passed.
Strict check initially caught six unknown-JSON type errors in NEW live test;
added typed HTTP response generics without changing assertions. Final command:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp TMPDIR=/private/tmp DB_CLIENT=sqlite ./node_modules/.bin/tsc -p tsconfig.json --noEmit
```
Exit0, no output. Existing coordinator workflow tests have their own unit engine
fixtures; they are not claimed as real provider behavior. Added tests mock nothing.

## Own live effect check / exact build identity

Existing approved sanitized fixtures reused read-only, peer fixtures untouched.
Canonical prebuilt-intake inspected: hard scoped to4798/4797/4799, not allowed to
change it for4998. Used canonical normal build with already-authorized private
engine. Shared-dist risk: no freeze claimed; source and compiled notifier hashes
checked before shutdown unchanged. Parent must rebuild/rerun after peer finishes.

From shipping root, identical env for up/status/down:
```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-coordinator-notify-20261014-fixture
export RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-coordinator-notify-20261014-fixture/rhythm.db
export RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-coordinator-notify-20261014-fixture/coordinator-opencode.json
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox
export RHYTHM_SANDBOX_API_PORT=4998 RHYTHM_SANDBOX_ENGINE_PORT=4997 RHYTHM_SANDBOX_GATEWAY_PORT=4999
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export RHYTHM_SANDBOX_NODE_BIN="$PWD/tools/dev/.hermes-shipping-runtime/node/bin/node"
export RHYTHM_SANDBOX_ENGINE_DIR="$PWD/tools/dev/.hermes-shipping-runtime"
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1
bash tools/dev/sandbox.sh up
```
Exit0, API strict build/postbuild and existing MCP noCheck build passed. One
initial health connection refusal then sandbox ready. Final status: API/gateway
PID17091 on4998/4999, enginePID17239 on4997. No second API hand-launch.

From `apps/api_server`:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp/hermes-coordinator-notify-20261014-sandbox/home TMPDIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox/tmp DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow RHYTHM_LIVE_E2E=1 RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-coordinator-notify-20261014-fixture RHYTHM_LIVE_DB_PATH=/private/tmp/hermes-coordinator-notify-20261014-fixture/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/hermes-coordinator-notify-20261014-fixture/coordinator-opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox ./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_live.test.ts --no-file-parallelism
```
Exit0 **1 passed**, tests124ms / duration462ms. Actual API origin bind201;
engine creates root/two child SDK sessions and real abort/idle lifecycle without
provider turns. Durable synthetic goal/delegation/outcome/card setup is through
actual repositories in the sandbox COPY only. Synthetic new auth token never
reads operator credentials. HTTP list asserts: two pending children no completion,
fixed progress; later unverified result plus failed sibling still no completion,
ERROR, exact child card ID, no RAW content, stable repeated event IDs. This is
live notification projection/engine metadata proof, NOT provider coding/all-pass
execution, real question-hub replay, installed native receiver ACK or full rollout.

SHA256 checked while live and again before down:
- source notifier `0ba0f1f81a22ac84e2894b3c709388b01bd8118c25d19cf2195aa6897baba5a7`
- compiled notifier `fe6763b0e5e91447912ddbe44ce0f85a33c32886b20c4d95e1801bc63d825689`
- private prebuilt engine `d60f5a42930ddb824184242da36dd4a4fffd6d8f4460ff5faf03e0dc09afa072`

With identical sandbox exports: `bash tools/dev/sandbox.sh status && shasum -a 256 apps/api_server/src/services/hermes_notify_service.ts apps/api_server/dist/services/hermes_notify_service.js && bash tools/dev/sandbox.sh down && git diff --check` exit0.
Own sandbox stopped; diagnostics `/private/tmp/hermes-coordinator-notify-20261014-sandbox.evidence.5sXyNZ`.
File-backed boundary DB evidence retained in temp; true SQLite close/reopen and
new notifier object exercised, not OS process restart. No destructive cleanup.

## Handoff / ceilings

**READY_CONSERVATIVECOORD_SOURCE / READY_FOR_VERIFICATION for bounded source only.**
Parent independently reruns frozen4/bridge3 plus boundaries8 and live check, then
single integration build/test freeze with peer tools. Existing staged/signing/CI
artifacts STALE. No MCP120/API9/tool-count or installed behavior claim made here.

CEILING: no durable verified coding-goal outcome producer exists; this source
never declares coding verification success. Future canonical producer required
for a positive verified completion. No fabricated positive all-pass fixture.
Question outbox is durable delivery only; pending-known map is process-local and
missed/offline hub occurrences are not guaranteed recoverable. No durable source
question queue/action guarantee; coding always remains unverified regardless.
Three independent synthetic owners/roots prove origin isolation and SQLite reopen
IDs, not three production projects or restart of the full API/native receiver.
No waiver, no frozen assertion edits, no source expansion; resumed agents retain
the same resolved approval/exclusions without asking again.
