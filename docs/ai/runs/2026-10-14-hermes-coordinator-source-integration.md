---
date: 2026-10-14
repo: Rhythm
branch: feat/hermes-shipping-rollout-20261014
pr: null
issues: [NOTIFY-HERMES, HERMES-APPROVALS]
status: FAIL_COORD_SOURCE_CANONICAL_RELATION_MISSING
tags: [run, rhythm]
---

## Scope / approvals retained

Explicit parent specialist handoff; no orchestrator invocation, peers or tasks.
Worktree: `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014`,
HEAD `c74f4392`. Preserve shipping dirty source continuation/6c4 bridge/card work.
Permitted source: `hermes_notify_service.ts`, `server.ts`, and
`persistent_workstream_coordinator.ts` only if necessary; new
`src/__tests__/hermes_coordinator_notify*.test.ts`; this note. Parallel CLI/E2E
owner owns tools/sandbox/provisioning and no apps/src writes. Parent owns one
integration boundary. No changed scope approval is requested for unchanged scope.

Excluded: shared_agents, approval repository, existing tests, routes/interfaces,
MCP, frontend/native fixture updates, production flags/release environment,
installed app/UI/signing/qualification artifacts, live DB/auth/credentials,
providers/real cards, live4001/4096, peer4898/4897/4899, relay/Tailscale/Pi,
service restarts/deploys, dependency installs, commits/pushes/destructive cleanup.
Own canonical sandbox up/status/down on4998/4997/4999 was explicitly permitted.
Existing signed/staged artifacts remain STALE; no new qualification is claimed.

## Files

- NEW `apps/api_server/src/__tests__/hermes_coordinator_notify_contract.test.ts`.
  Real SQLite migrations, users/projects/sessions, bridge jobs/projections,
  conversation root designation, add/reserve/settle goal operations, async
  delegations, canonical approvals, and notifier/outbox. No system mocks.
- NEW this note.
- Approved external fixture root generated fresh with canonical builder:
  `/private/tmp/hermes-coordinator-notify-20261014-fixture`.
  Additional sanitized `coordinator-opencode.json`, mode0400, uses private Node
  and shipping MCP with API4998; no copied operator config/data or provider setup.
  Builder's synthetic DB is mode0400. Defaults were not enabled/relaxed.
- **No implementation source file was edited.** Existing dirty files and
  existing source contract are retained. Peer tools appearing during execution
  were not read/modified/adopted as source authority.

## Phase 0: executable RED before implementation

Loaded `acceptance-contract` first, then `coding-agent`. Read AGENTS, current-plan,
project-state, source-continuation run and regression registry. Named checks:

1. `terminal bridge and idle parent cannot complete two pending coordinator children`
2. `settled fanout containing a child error cannot publish success`
3. `canonical child approval blocks completion and publishes only the existing card ID`
4. `returned_result_unverified remains manual verification, including notifier reopen and replay`

All four genuinely fail on the current behavior, not missing imports/schema.
Each observes **one completion event** (`version=2`, `state=pending`,
`referenceId=null`, `text="Rhythm session completed."`) where none is allowed.
First check also observes `agent_async_delegations` count2 before asserting.
The manual-verification check first observes the actual repository outcome
`returned_result_unverified`. All journal outputs used the authorized bridge's
exact root/chat/run tuple; no latest-session lookup or arbitrary chat adoption.

RED command exit1: 1 file / **4 failed, 0 passed**, tests523ms, duration881ms.
Frozen checks unchanged after RED. Assertions after the first failure in each
test are NOT reported as executed passes (in particular child card publication,
error projection and replay ID assertion remain unqualified).
Notifier object recreation is exercised against the same in-memory DB; this is
NOT SQLite file close/reopen or process-restart/outbox-recovery proof.
Encompass/Rhythm/Opus labels here are synthetic cases, NOT three production-origin
qualification or simultaneous independent-origin proof.

Full contract creation stops at the canonical-source boundary below: no fake
qualified terminal receipt or fake canonical question queue was seeded merely
to make a positive completion/question test expressible. No behavior waiver.
Implementer's mandate remains to pass these unchanged checks; parent is the
independent verifier and can execute the tests read-only against source.

## Phase 1: bounded review and exact missing relationships

GitNexus calls (repo Rhythm, upstream):
`PersistentWorkstreamCoordinator` with CALLS/IMPORTS/HAS_METHOD/HAS_PROPERTY and
`HermesNotifyService` each return **Target not found / UNKNOWN**. These are not
zero-dependency findings. No HIGH/CRITICAL result was returned. Primary graph
does not index these shipping symbols; no reindex or source edits were made.

Reviewed whole notifier, actual bridge preengine hook/projection repository,
coordinator observer interface and post-reconciliation terminal sequence,
native row contract, actual C74 coding-goal contract/read model, conversation
schema/outcome repository, async repository, and question paths. Manual callers:
server composes one terminal observer, currently calling conversation service;
bridge preengine callback calls `bindBridge`; notifier list/ingest replays the
bridge; canonical card listener calls `publishPendingCard`. No execution guards
were relaxed and no runtime actions were taken to manufacture terminal facts.

**Available identity relationship:**
bridge `id` -> `child_session_id` (local root) -> owner/project-bound coordinator
conversation -> exact `delegate_goal` command -> `delegation_id` / `child_session_id`
-> existing async delegation. This is sufficient for status-only correlation;
it is NOT missing and must not be replaced with a new tracker or guessed ID.

**Missing qualified-terminal relationship:**
`CoordinatorGoalDelegationOutcome` has only running/returned_result_unverified/
failed/cancelled/unknown (repository lines234-243,1050-1100). The installed
coding-goal run uses `agent_async_delegations`; its child return has no durable
all-pass qualifier/criterion receipt and no exact link to a strict native
workstream job/attempt receipt. `coordinator_goal_runs.ts` lines62-66,121-125
explicitly treats finished as unverified. The separate native terminal observer
(persistent coordinator lines167-176,2908-2916) carries workstream/job/epoch
IDs for a finite native turn. Its application is quarantined/stale
(lines2859-2878), not proof that coding-manager plus codeworkers passed.
Assigning this native job to an async goal by shared parent/latest session would
violate the requested exact-operation/attempt qualification.

**Missing canonical-question relationship:**
native reconciliation reads engine lifecycle pendingQuestionSessionIds and
pendingPermissionSessionIds (lines2571-2604), or live listQuestions/listPermissions
(lines3074-3090). Stream bridge holds `pendingQuestions` in an in-memory Map
(line926), with recovery from engine listQuestions (line1065). The inspected
canonical conversation/native/async records have no durable owner/operation/
attempt-bound canonical question queue ID to publish/replay. Publishing raw
engine question identifiers as a new durable authority or adding a second
question journal is prohibited by this dispatch.

**Concrete risk / parent boundary:** merely wiring the existing terminal observer
would still leave C74 async coding outcomes outside that strict native lifecycle;
promoting returned_result_unverified to completion is false success. Creating
the missing qualified goal receipt or canonical question queue changes forbidden
repository/schema/interface paths or invents lifecycle authority. Per coding-agent,
stop rather than broaden scope. Parent must identify an existing authoritative
receipt/queue and exact join, or assign the necessary producer/schema work at the
single integration boundary. This is a workflow-source blocker, not a host denial
or request to repeat prior scope approval.

## Checks / exact commands

From shipping root, fixture generation (exit0):
`tools/dev/.hermes-shipping-runtime/node/bin/node tools/dev/sandbox_fixture.mjs /private/tmp/hermes-coordinator-notify-20261014-fixture`.
Canonical builder reports synthetic read-only sources; backfill tasks0/project_steps0.
Created sanitized additional config using apply_patch and ran
`chmod 0400 /private/tmp/hermes-coordinator-notify-20261014-fixture/coordinator-opencode.json`.

Identical sandbox environment for up/status/down:
```sh
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/hermes-coordinator-notify-20261014-fixture
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/coordinator-opencode.json"
export RHYTHM_SANDBOX_DIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox
export RHYTHM_SANDBOX_API_PORT=4998 RHYTHM_SANDBOX_ENGINE_PORT=4997 RHYTHM_SANDBOX_GATEWAY_PORT=4999
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
export RHYTHM_SANDBOX_NODE_BIN="$PWD/tools/dev/.hermes-shipping-runtime/node/bin/node"
export RHYTHM_SANDBOX_ENGINE_DIR="$PWD/tools/dev/.hermes-shipping-runtime"
export RHYTHM_SANDBOX_SKIP_ENGINE_BUILD=1
bash tools/dev/sandbox.sh up && bash tools/dev/sandbox.sh status
```
Exit0; API strict build/postbuild and MCP build pass. Initial health polling
reported connection refusal once, then sandbox ready. API PID21131/4998,
engine PID21307/4997, gateway PID21131/4999. No hand-started API or peer port use.

From `apps/api_server`, exact RED command:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp/hermes-coordinator-notify-20261014-sandbox/home TMPDIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox/tmp XDG_CONFIG_HOME=/private/tmp/hermes-coordinator-notify-20261014-sandbox/home/.config XDG_DATA_HOME=/private/tmp/hermes-coordinator-notify-20261014-sandbox/home/.local/share XDG_CACHE_HOME=/private/tmp/hermes-coordinator-notify-20261014-sandbox/home/.cache DB_CLIENT=sqlite RHYTHM_OPENCODE_ENGINE_PORT=4997 RHYTHM_MOBILE_GATEWAY_PORT=4999 RHYTHM_OPTIMIZER_MODE=shadow ./node_modules/.bin/vitest run src/__tests__/hermes_coordinator_notify_contract.test.ts --no-file-parallelism
```
Same env prefix, replacing test path with
`src/__tests__/hermes_source_contract.test.ts`: exit0 / **3 passed**, tests428ms,
duration847ms. Then strict check:
```sh
env -i PATH="/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/hermes-shipping-rollout-20261014/tools/dev/.hermes-shipping-runtime/node/bin:/usr/bin:/bin:/opt/homebrew/bin" HOME=/private/tmp/hermes-coordinator-notify-20261014-sandbox/home TMPDIR=/private/tmp/hermes-coordinator-notify-20261014-sandbox/tmp DB_CLIENT=sqlite ./node_modules/.bin/tsc -p tsconfig.json --noEmit
```
Exit0, no output. These are UNIT-only checks, no engine behavior/native ACK proof.

From shipping root under identical sandbox exports:
`bash tools/dev/sandbox.sh status && bash tools/dev/sandbox.sh down && git diff --check && git status --short`:
exit0; only own sandbox stopped, sanitized evidence retained at
`/private/tmp/hermes-coordinator-notify-20261014-sandbox.evidence.lwXfpl`.
No destructive cleanup outside authorized canonical down. No production/source
implementation repair attempts; no tests weakened, no commit/push.

## Phase 2 / handoff

**BLOCKED / bounded FAIL, not READY_COORD_SOURCE or READY_FOR_VERIFICATION.**
Four new RED checks remain deliberately failing. No observer/authority hooks,
schemas or lifecycle projection were changed. Remaining positive all-qualified
completion, canonical durable questions, independent three origins, real SQLite
restart/recovered publication, active receiver-link revocation and no unauthorized
history ACK are NOT validated. No tool-count/auth401/live-feature claims are
inferred from these units; MCP/routes/defaults remain untouched by this worker.

Parent should retain these RED checks and resolve the two missing canonical
relationships above before further source implementation. Source is frozen by
this worker (no source modifications); peer can finish CLI/E2E independently,
but parent must not count bridge-only terminal/old native evidence as aggregate
success. Verify independently after the single integration boundary.
