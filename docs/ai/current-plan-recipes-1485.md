# Epic #1485 Plan — Recipes as Durable, Enforced Multi-Agent Workflows

**Status:** Repaired authoring plan; AJ's retained product decisions are resolved. Docs only; no implementation or PR.

## Goal

Turn cookbook recipes from opaque prompt JSON into versioned, validated, durable multi-agent workflows that preserve legacy behavior, use one shared root-agent dispatch seam, and fail closed at every verdict, provider, approval, capability, budget, reconciliation, and side-effect boundary.

## Constraints

- Flutter is the shipping editor. Web/mobile are not new workflow-authoring surfaces.
- Existing rows remain explicit `legacy_prompt` recipes; migration never reinterprets or rewrites `steps_json`.
- Workflow definitions may exist in SQLite and Postgres, but execution is local-agent-server only. A hosted/Postgres process returns `workflow_execution_unavailable` without creating a run.
- Research keeps its lifecycle loop, persistence/statuses, prompts, cancellation, retry, and restart behavior unchanged.
- `dispatchAgentStage()` is the only shared orchestration extraction. Recipe-only durable claims, attempts, audit, cancellation fences, approval progression, and reconciliation stay in the recipe runner.
- Every agent stage is a root `AgentRunner` session, so stage count does not consume delegation depth.
- Verdict, provider, approval, taint, capability, identity, completion, and budget checks fail closed.
- Workflow execution remains behind `RHYTHM_RECIPE_WORKFLOWS_ENABLED`, default off, through S4.
- Backend completion requires a live behavioral test through the real API and engine in `tools/dev/sandbox.sh`, with an exact run note. Never start a second API server by hand.
- S4 side effects are allowed only in private `ajhochy/rhythm-workflow-e2e`, never the production Rhythm repository.

## Existing baseline and targeted code findings

- `agentCookbookController.ts:119-197` compiles one prompt and calls blocking `AgentRunner.run()` once; malformed JSON falls back to raw prompt text.
- `research_project_orchestrator.ts:19-316` has a research-specific loop, mutable jobs, in-process coalescing, coarse budgets, root dispatch, and restart re-dispatch. It does **not** have durable claims, attempt identity, a transition engine, an audit ledger, persist-first cancellation, or session reattachment.
- `AgentRunner.run()` is blocking and returns no durable workflow receipt or usage. Usage is persisted in `agent_session_messages`; post-restart session reconciliation only changes stale active sessions to `idle`.
- `rhythm_complete_research_pass` does not call an API. Research completion is scraped from transcript tool frames on idle by `specialist_research_indexer.ts`; it is not a completion pattern for recipes.
- Teacher escalation can replace a provider-pinned run, unpinned routing can use most-recently-used defaults, and the process-wide runner has eight slots by default. `capacity` and `profile_unavailable` can occur before model dispatch.
- `AgentApprovalContinuationService` prompts an existing idle session; it cannot advance a sessionless workflow node. Existing approval records provide signatures/nonces and the tainted redemption path provides TTL, payload binding, and single-use consumption.

## Intent and scope boundary

The delivery sequence is **S0 durability probe → S1a additive migration/default-off + S1b validator after S0 → S2 dispatch seam → S3 runner/completion endpoint/DTO → S4 dedicated-repo E2E → S5 Flutter editor**. S1a has zero dependency on the rest of the epic and is independently shippable. No general graph language, recursive schema system, research migration, or second execution substrate is introduced.

## Design

### Considered approaches

| Option | Shape | Decision |
|---|---|---|
| Add recipes to `ResearchProjectOrchestrator` | Couple recipe graphs to research passes/prompts | Reject: wrong domain boundary. |
| Migrate research and recipes onto a new durable engine | Generic claims/transitions/reconciliation plus adapters | Reject: most mechanics are net-new and would rewrite proven research behavior. |
| **Share only `dispatchAgentStage()`** | Extract root dispatch, model parsing, session binding, and budget predicate; recipe runner owns recipe durability | **Approved:** smallest reusable seam and lowest research regression risk. |

### Approved extraction boundary and anti-second-engine invariant

Extract only `dispatchAgentStage()` from the current research path. It owns:

1. Root `AgentRunner.run()` dispatch.
2. Atomic `provider/model` override parsing and forwarding.
3. The `onSessionCreated` callback that binds the durable local session ID.
4. The existing four-field budget predicate used by research.
5. A provider-pinned option that suppresses teacher escalation; recipe stages that declare provider/model overrides always set it.

`ResearchProjectOrchestrator` keeps its current lifecycle loop, `inFlight` behavior, persistence/statuses, prompts/evidence, cancellation, retry, and restart behavior. It merely calls the shared dispatch seam. The recipe runner owns all net-new durable claims, append-only attempts/audit, transition selection, fan-out/join, approval polling/subscription, persist-first cancellation, and restart reconciliation.

**Anti-second-engine invariant:** there is one shared agent-dispatch seam, and recipe code does not copy research lifecycle machinery: no research `for` loop, research prompts/status model, `inFlight` map, budget predicate, session callback, or interrupted-run scan.

### S0 durability decision gate

Before schema v1 freezes, an isolated-sandbox probe dispatches one root stage, persists its session and direct completion record, restarts the API process, and asserts whether the terminal outcome can be recovered without a second prompt.

- **Recoverable:** S3 may use synchronous `AgentRunner.run()` with direct durable completion as the authoritative receipt.
- **Not recoverable:** S3 dispatches with `promptAsync`; durable completion plus terminal session state becomes the authoritative completion condition.

S0 records the observed behavior and selected dispatch mode in a decision note. S0 gates S1b and S3, not S1a. The plan does not pre-select an answer the runtime has not proved.

## V1 contract

### Cookbook persistence and compatibility

Additive cookbook fields:

- `recipe_format`: `legacy_prompt | workflow`.
- `schema_version`: null for legacy, exactly `1` for workflow.
- `definition_json`: null for legacy, validated workflow definition for workflow.

Every existing row is classified `legacy_prompt`; `steps_json` remains byte-identical and authoritative. List/get surfaces `migrationState: explicit_upgrade_required`. Legacy `/run` behavior and response remain unchanged. Workflow creation/update validates before persistence. Run snapshots contain canonical definition/input hashes so later edits affect only later runs; no recipe revision-history subsystem is added.

### Minimal schema shape

TypeScript plus its imported test fixtures are the single source of truth. There is no duplicate docs JSON schema artifact and no new validation dependency.

```ts
type ScalarType = 'string' | 'number' | 'boolean';
type ScalarFields = Record<string, ScalarType>;
type OutputContract = {
  fields: ScalarFields;
  items?: { keyField: string; fields: ScalarFields };
};
type RunInput = Record<string, string>;
```

V1 run input is a named scalar string map; the target uses `goal`. An agent output has scalar record fields and, only when needed, one keyed collection shape. V1 does not recursively nest objects/arrays.

The closed workflow definition contains `schemaVersion: 1`, `entryStageId`, `stages`, run-wide cost/token/wall-time/stage-execution budgets, and named loop budgets. Supported stages are only `agent`, `gate`, `approval`, and `fanOut`. Bindings are closed references to run input, a declared stage-output scalar/keyed item, or the current scope item. Unknown fields, duplicate IDs, unreachable stages, missing targets, type mismatches, unavailable producers, sibling-scope ambiguity, unbounded back edges, invalid provider/model pairs, and uncapped fan-out fail validation with stable `{path, code, message}` diagnostics.

No arbitrary expressions, recursive value contracts, dependency lineage, staleness propagation, or retry invalidation exist in v1. Append-only attempts remain because bounded repair loops require history. A stage binding resolves the nearest committed producer while walking from its scope to ancestors and then the run root; it never reads a sibling scope.

### Provider-separated stages

Every provider-separated author and reviewer stage requires explicit atomic `{providerId, modelId}` overrides. `differentProviderFromStageId` is valid only when both stages are explicit and their provider IDs differ. Provider-pinned stages suppress teacher escalation.

After completion, the runner verifies the **observed** provider/model from durable session/message metadata, using the live-engine fallback when the message mirror is incomplete. Missing or mismatched observed routing invalidates the attempt and cannot take success. Pre-dispatch intent and post-hoc observed routing are both audited.

### Typed data flow, taint, and capability floor

- Inputs are materialized, hashed, and persisted before dispatch. Downstream prompts receive only declared bindings plus run/stage identity.
- Completion validates the declared output shape before immutable commit.
- Every output records the union of taint IDs inherited from declared inputs and external/tool content observed in its session. Taint propagates through later bindings.
- A consequential stage is subject to a server policy floor. Recipe authors may strengthen but never weaken required approval.
- Tainted approval evidence uses the existing tainted approval binding (`taintId`, bound agent/profile, action, payload digest), not a plain approval.
- A stage profile/provider/tool/skill set must be within the recipe creator/run owner's effective server-side grants. Null legacy allowlists are not interpreted as no grants; runtime computes the actual effective grant set and fails closed when it cannot prove containment.

### Verdicts, loops, fan-out, and capacity

A verdict is a closed v1 object containing matching `runId`, `stageExecutionId`, `attemptId`, outcome (`pass | fail | repair | blocked`), non-empty reasons, and typed evidence references. Unsupported versions/keys/outcomes, missing identity, malformed output, conflicting verdicts, and contract failures produce `invalid_verdict`; they never choose success. `onInvalid` is mandatory.

Each loop instance is keyed by `(loopId, scopePath)` and independently bounded by positive iteration, cost, token, and wall-time caps. Run budgets are the only aggregate ceiling. Usage is aggregated from `agent_session_messages` joined through each attempt's `agentSessionId`, mirroring research `listRunUsageRows`. Workflow wall-time is checked at dispatch boundaries; in-flight stage timeout remains `AgentRunner`'s deadline policy.

Fan-out uses stable item keys and unique `(runId, fanOutStageId, itemKey)` claims. Effective concurrency is bounded by configured `maxConcurrency` and the runner's remaining slots. Because remaining capacity can race, `capacity` and `profile_unavailable` are requeued dispatch failures: they create no model attempt, consume no repair iteration, and do not take `onFail`. Children are root sessions and the target fixture uses deterministic `join(all)`.

### Completion, identity, restart, cancellation, and approval

- Logical stage execution identity is `(runId, stageId, scopePath, loopIteration)`; append-only attempt identity adds `attemptId`.
- The MCP `rhythm_complete_workflow_stage` tool directly calls a real authenticated local-agent HTTP endpoint. It does not depend on transcript scraping, session-idle indexing, or the research indexer.
- The completion table has unique key `(runId, stageExecutionId, attemptId)`. Byte/canonical-equivalent duplicate completion is idempotent; a conflicting duplicate fails closed and appends an integrity event.
- Workflow start persists the run and returns `{runId, status: 'pending'}` before dispatch. It never holds the HTTP request for the full workflow.
- Restart never replays committed work. Known sessions/completions reconcile according to S0's selected mode. Ambiguous consequential side effects become `blocked_reconciliation`; v1 exposes only an authenticated human-unblock action for that state, not a general resume endpoint.
- Cancellation atomically fences the run and active/pending stages before best-effort SDK abort. Late completion cannot resurrect the run; prior output/audit remains.
- Approval progression uses signed, expiring, nonce-bound, single-use records. Signature/nonce are verified on decision; TTL, payload/action/taint binding, and `consumedAt` are atomically validated when the workflow consumes the decision. Expired and already-consumed decisions take explicit fail-closed targets.
- The recipe runner polls or subscribes to the durable approval transition and advances the stage exactly once. It does not use `AgentApprovalContinuationService` or prompt a session to progress the state machine.
- Audit is append-only and records snapshots/hashes, claims, configured and observed routing, sessions, taints, outputs/verdicts, transitions, attempts, budgets, fan-out keys, approvals, reconciliation, cancellation, and terminal state.

## Named S3 run/stage DTO contract

`RecipeWorkflowRunDtoV1` is the Flutter S5 contract:

```ts
type RecipeWorkflowStageDtoV1 = {
  stageExecutionId: string;
  stageId: string;
  scopePath: string;
  attemptId: string | null;
  status: 'pending' | 'dispatching' | 'running' | 'blocked_approval' |
    'blocked_reconciliation' | 'succeeded' | 'failed' | 'cancelled';
  profileId: string | null;
  configuredProviderId: string | null;
  configuredModelId: string | null;
  observedProviderId: string | null;
  observedModelId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  outcome: string | null;
};
type RecipeWorkflowRunDtoV1 = {
  version: 1;
  runId: string;
  recipeId: string;
  status: 'pending' | 'running' | 'blocked_approval' |
    'blocked_reconciliation' | 'succeeded' | 'failed' |
    'budget_exhausted' | 'cancelled';
  stages: RecipeWorkflowStageDtoV1[];
  pendingApprovalId: string | null;
  terminalReceipt: { repository: string; prUrl: string; headSha: string; base: string; draft: boolean; requiredCheck: string } | null;
  createdAt: string;
  updatedAt: string;
};
```

Unknown internal diagnostics stay in audit APIs; S5 renders this stable operational projection.

## Target workflow and approved roster

The target remains:

`planning → contrarian_review → adjust_plan → issue_writer → fanOut(issue) { acceptance_contract → coder → review → review_verdict_gate → [pass | coder_repair → review loop] → smoke → smoke_verdict_gate → [pass | failure_triage → smoke_repair → smoke loop] } → join(all) → approval → shippable_pr`

| Work | Profile | Provider rule |
|---|---|---|
| Planning, adjusted plan | `planning-agent` | Explicit OpenAI authoring override |
| Contrarian review | `planning-agent` | Explicit Anthropic Opus review override; post-hoc provider verified |
| Issue and acceptance contract | `issue-writer` | Explicit OpenAI authoring override |
| Code and code/smoke repair | `coding-agent` | Explicit OpenAI authoring override |
| Code review/verdict | `verification-gate` | Explicit Anthropic review override; post-hoc provider verified |
| Smoke | `smoke-test-writer` | Explicit OpenAI authoring override |
| Failure triage | `failure-triage` | Explicit OpenAI authoring override |

The issue collection has stable keys. Each issue scope receives only its issue, acceptance contract, and declared ancestor plan references. Both repair loops have all four caps and explicit exhausted targets. The PR stage requires all scopes to pass, server-required approval to be consumed, and the smoke-tested head SHA to match the final receipt.

## S4 dedicated-repository contract

- Destination: private `ajhochy/rhythm-workflow-e2e`; base `main`.
- Success receipt: a **draft** PR whose head SHA matches the tested SHA and whose required check named exactly `workflow-e2e` is green.
- S4 never targets `ajhochy/Rhythm` or any production repository.
- Repair branches are exercised deterministically through the real API/engine boundary: a fixture profile/provider keys a first-attempt contract instruction/tool result by `(stageExecutionId, attemptId)`, emits the required repair verdict on the first attempt, and emits pass after repair. No workflow/API/engine mock is permitted.
- After evidence and the PR receipt are recorded, close the test PR and delete its remote branch. Cleanup failure is recorded and fails the cleanup criterion; it never silently reuses the branch.

## User journeys

| User job | Shipping entry point | Visible success | Slice |
|---|---|---|---|
| Preserve/run an old prompt recipe | Agents → Cookbook → legacy recipe | Legacy badge; byte-compatible run; explicit upgrade | S1a, S5 |
| Build an enforced workflow without raw JSON | Agents → Cookbook → New/Edit | Validated vertical cards and inline server diagnostics | S1b, S5 |
| Understand routing | Recipe view/editor | Generated read-only branches, loops, fan-out, approvals | S5 |
| Start/monitor a run | Cookbook recipe → Run | Stable run ID and S3 DTO survive restart | S3, S5 |
| Approve a consequential action | Existing approval UI | Signed decision advances the correct stage once | S3, S5 |
| Obtain delivery result | Target run | Dedicated-repo draft PR receipt or explicit bounded terminal state | S4, S5 |

## File structure map

| File | Responsibility |
|---|---|
| `apps/api_server/src/config/env.ts` | Default-off recipe-workflow flag and local execution gate. |
| `apps/api_server/src/contracts/recipe_workflow_contract.ts` | Sole v1 TypeScript contract and strict validator. |
| `apps/api_server/src/__tests__/fixtures/recipe_workflow_fixtures.ts` | Valid/invalid fixtures imported by contract and E2E tests. |
| `apps/api_server/src/repositories/agent_cookbook_repository.ts` | Additive format/schema/definition persistence. |
| `apps/api_server/src/database/migrations.ts` | Idempotent SQLite cookbook and workflow tables/indexes. |
| `apps/api_server/src/database/postgres_bootstrap.ts` | Cookbook-definition parity/backfill only; no hosted workflow execution. |
| `apps/api_server/src/services/dispatch_agent_stage.ts` | Shared root dispatch, override parse, session callback, budget predicate, pinned-provider escalation suppression. |
| `apps/api_server/src/services/research_project_orchestrator.ts` | Calls the dispatch seam; otherwise remains behaviorally unchanged. |
| `apps/api_server/src/repositories/recipe_workflow_repository.ts` | Recipe-only run/stage/attempt/completion/approval linkage/audit state. |
| `apps/api_server/src/services/recipe_workflow_runner.ts` | Recipe-only transitions, fan-out, budgets, taint, policy floor, cancellation, reconciliation. |
| `apps/api_server/src/controllers/agentWorkflowController.ts` | Start/get/cancel, blocked-reconciliation unblock, and authenticated completion writes. |
| `apps/api_server/src/routes/agentWorkflowRoutes.ts` | Local-agent workflow routes with explicit local/cloud authentication middleware. |
| `apps/api_server/src/controllers/agentCookbookController.ts` | Legacy compatibility and validated workflow CRUD delegation. |
| `apps/mcp_server/src/tools/agentWorkflow.ts` | Completion tool calling the authenticated HTTP endpoint directly. |
| `apps/mcp_server/src/index.ts` | Tool registration; PR reports updated approximate tool count. |
| `apps/api_server/src/__tests__/contract/recipe_workflow_*.test.ts` | S0, schema, lifecycle, security, restart, approval, and DTO contracts. |
| `apps/api_server/src/__tests__/recipe_workflow_live_e2e.test.ts` | Env-gated dedicated-repo real API/engine proof. |
| `apps/desktop_flutter/lib/features/agent_cookbook/models/recipe_workflow.dart` | Typed v1 definition and run/stage DTOs. |
| `apps/desktop_flutter/lib/features/agent_cookbook/models/cookbook_recipe.dart` | Legacy/workflow format and migration state. |
| `apps/desktop_flutter/lib/features/agent_cookbook/widgets/recipe_steps_editor.dart` | Vertical standard-control cards and move buttons. |
| `apps/desktop_flutter/lib/features/agent_cookbook/widgets/recipe_flow_visualization.dart` | Read-only generated workflow rendering. |
| `apps/desktop_flutter/lib/features/agent_cookbook/views/agent_cookbook_view.dart` | Create/edit/run/monitor/approval UX. |
| `apps/desktop_flutter/test/features/agent_cookbook/recipe_workflow_editor_test.dart` | Real-view editor, legacy, diagnostics, and DTO monitoring tests. |

## Delivery slices / issue table

| Slice / issue | Likely files | Falsifiable acceptance criteria | Dependencies | Required validation |
|---|---|---|---|---|
| **S0 — Probe restart recovery and choose dispatch mode** | S0 contract/live test; decision note | Root stage is dispatched once; completion is persisted; sandbox API restarts; test proves whether terminal output is recoverable without another prompt. Decision records sync `run()` or async `promptAsync` and resulting attempt/completion state. | None; gates S1b/S3 only. | Build fork/API; `tools/dev/sandbox.sh up/status/down`; run focused env-gated probe serially; record exact output. |
| **S1a — Add cookbook classification and default-off flag** | env; cookbook repository/controller; SQLite migration; Postgres bootstrap; legacy tests | Every old row is `legacy_prompt`; `steps_json` bytes and legacy run behavior are unchanged; `explicit_upgrade_required` is surfaced; migration self-heals/idempotently matches Postgres fields; workflow flag defaults off. | **None; zero epic dependency and independently shippable.** | API `tsc --noEmit`; cookbook, #740, migration self-heal, and focused Postgres parity tests; malformed/array/object/scalar/empty legacy fixture. |
| **S1b — Freeze minimal workflow v1 validator** | TS contract; imported test fixtures; schema tests | Goal-string input, scalar outputs plus one keyed collection, four stages, explicit targets, four loop caps, fan-out/all join, provider rules, ancestor binding, and policy metadata validate; every listed invalid shape returns stable path/code; no recursive contracts/lineage/general resume/docs schema. | S0 decision; may follow S1a without coupling to its rollout. | API `tsc --noEmit`; focused contract tests covering every validator rule and S0's selected dispatch-mode schema. |
| **S2 — Extract only `dispatchAgentStage()`** | dispatch seam; research orchestrator; unchanged #1292–#1295 tests | Research calls the seam for root dispatch/override/session bind/budget predicate; provider-pinned escalation suppression is available; research loop, persistence/statuses/prompts/cancellation/retry/restart remain unchanged; recipe code copies no research lifecycle machinery. | S1b vocabulary stable; no recipe execution. | GitNexus impact before symbol edits; #1292–#1295 contract suite; API `tsc --noEmit`; compare-scope `detect_changes` before commit. |
| **S3 — Build recipe runner, direct completion endpoint, security policy, and DTO** | recipe repository/runner; workflow controller/routes; MCP tool/index; workflow DB tables; approvals linkage; contract tests | Start returns pending before dispatch; local-only execution; unique claims/attempts/completions; identical duplicate idempotent and conflict closed; explicit/post-hoc provider checks; capacity/profile requeue; loop/run caps; deterministic fan-out/all join; taint propagation and effective-grant containment; signed/TTL/single-use approval advances once without continuation service; cancel fence/reconciliation/audit work; only blocked-reconciliation unblock exists; named DTO matches this plan. | S0 mode + S1b + S2. | Focused serial Vitest contracts for transitions, identity races, completion auth/conflict, provider mismatch/escalation, capacity/profile requeue, all budgets, fan-out restart, taint/grants, approval expiry/replay, cancellation, reconciliation, locality, audit, DTO; `npm test`; `tsc --noEmit`; sandbox live lifecycle test and run note. |
| **S4 — Prove target workflow in dedicated private repo** | live E2E; fixture profiles/provider; imported workflow fixture; run note | Exact target path traverses real API/engine; OpenAI author and Anthropic reviewers are observed; deterministic first-attempt review and smoke repairs occur; malformed verdict, each cap, restart, cancellation, rejected/expired approval, and ambiguous side effect terminate explicitly without duplicate side effects; draft PR targets `ajhochy/rhythm-workflow-e2e:main`, tested SHA matches, `workflow-e2e` is green; evidence is recorded, PR closed, remote branch deleted. | S3. Repo/provider provisioning probe is the only remaining factual precondition. | Probe repo visibility/permissions/base/protection/check and both providers/models; build fork/API; sandbox only; `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/recipe_workflow_live_e2e.test.ts --no-file-parallelism`; record exact receipt and cleanup. |
| **S5 — Ship Flutter cards, flow, and monitoring** | Flutter models/data/view/widgets/tests | No raw JSON editor; standard vertical controls and move buttons; no drag/drop/canvas/new dependency; local/server errors inline; legacy explicit and runnable; generated flow only from typed definition; real view starts and monitors S3 DTO, approval and terminal receipt across app restart. | S1b + stable S3 DTO + S4 golden fixture. Editor and visualization widgets may proceed in parallel after model. | `dart format . --set-exit-if-changed`; `flutter analyze --no-fatal-infos`; feature tests; macOS manual smoke of create/edit/view/run/restart/approve/reject/terminal. |

## Dependency and rollout gates

1. S0 gates S1b's attempt/completion schema and S3 dispatch mode.
2. S1a can land independently at any time; it enables no workflow execution.
3. S1b freezes only the minimal contract before S2/S3.
4. S2 proves the shared dispatch seam without migrating research.
5. S3 must pass live local lifecycle evidence before S4.
6. S4 must prove the exact dedicated-repo/provider contract before S5 uses it as the golden example.
7. Default-on rollout is outside this epic plan and requires later manual smoke/authorization; legacy recipes remain available.

## Requirement coverage matrix

| Requirement | Slice | Falsifiable proof |
|---|---|---|
| Restart dispatch premise | S0 | Restart probe chooses sync/async without duplicate prompt. |
| Additive legacy migration/default-off | S1a | Byte-identical legacy fixture and SQLite/Postgres parity. |
| Minimal v1 schema/data flow | S1b | Closed fixtures and stable rejection diagnostics. |
| One shared seam/no research migration | S2 | Unchanged research contracts and structural inspection. |
| Root/profile/model dispatch | S2/S3 | Root session identity and configured routing audit. |
| Strict cross-provider execution | S1b/S3/S4 | Both overrides required; escalation suppressed; observed provider mismatch fails. |
| Fail-closed verdicts/branches | S1b/S3 | Invalid verdict never reaches success. |
| Per-instance loop/run budgets | S3/S4 | Each cap independently reaches `budget_exhausted`. |
| Capacity-safe fan-out/all join | S3/S4 | Pre-dispatch failures requeue without attempt/loop count; stable child count after restart. |
| Direct durable completion | S3 | Authenticated endpoint survives bridge/indexer absence; duplicate/conflict tests. |
| Durable identity/reconciliation/cancellation/audit | S3/S4 | Restart/cancel races preserve fences, outputs, and ordered events without replay. |
| Signed approval + taint/policy/capability floor | S3/S4 | Expired/replayed/weakened/escalated cases fail; valid decision advances once. |
| Named run/stage DTO | S3/S5 | API contract fixture decodes and renders in Flutter. |
| Exact target workflow and PR receipt | S4 | Real dedicated-repo draft PR has tested SHA and green named check, then cleanup succeeds. |
| Flutter cards/read-only flow | S5 | Real-view tests and macOS smoke; dependency list unchanged. |

## Resolved AJ decisions

| Decision | Resolution |
|---|---|
| Extraction boundary | Only `dispatchAgentStage()`; research lifecycle remains unchanged; recipe-only durability stays in recipe runner. |
| Target roster/providers | Approved profiles listed above. OpenAI authors; Anthropic reviews; both explicit and post-hoc verified. |
| S4 destination/success/cleanup | Private `ajhochy/rhythm-workflow-e2e`, base `main`, required `workflow-e2e`, draft PR receipt; then close PR/delete remote branch; never production Rhythm. |
| Legacy/revision/schema/fan-out | Preserve legacy; immutable run snapshot only; minimal scalar/keyed collection; target join is `all`. |
| Security/reconciliation/rollout | Server approval floor; fail-closed `blocked_reconciliation`; default-off through S4. |

**Unresolved product blockers: none.** Implementation may proceed through S3 without S4 infrastructure.

## External dependencies and remaining factual preconditions

- No new runtime/library is planned. S0 and all live backend tests use the existing fork/API through the isolated sandbox.
- Before S4 only, provision and probe the private repository, `main`, branch permissions/protection, the required check named `workflow-e2e`, noninteractive draft-PR rights, and close/delete cleanup rights.
- Before S4 only, prove the sandbox has authenticated OpenAI and Anthropic access, the selected explicit authoring models and Anthropic Opus model appear in the runtime catalog, and durable message metadata exposes the observed provider/model. These are factual provisioning checks, not product questions.
- `gh pr create` must use explicit `--repo ajhochy/rhythm-workflow-e2e --base main --head ... --draft`; nonzero exit, missing URL, wrong repo/base, missing check, or SHA mismatch fails closed.

## Doubt review

The plan is wrong if S0 cannot recover a terminal completion under either synchronous or asynchronous dispatch, if the message store/live-engine fallback cannot authoritatively identify the observed provider, or if the dedicated repo cannot expose the exact check/cleanup contract. The cheapest probes are S0's restart test, an S3 pinned-provider metadata contract, and S4's preflight-only repo/auth check. Do not compensate with transcript scraping, provider fallback, automatic side-effect replay, or production-repo testing.

## Contrarian repairs incorporated

| Finding | Repaired sections |
|---|---|
| B1 | Design; approved extraction boundary; S2; dependency gates |
| B2 | S0 durability gate; slices S0/S1b/S3; doubt review |
| B3 | Completion/identity; file map; S3 validation |
| H1–H2 | Provider-separated stages; dispatch seam; S3/S4 |
| H3 | Fan-out/capacity; S3 acceptance/tests |
| H4 | Approval semantics; file map; S3 acceptance/tests |
| H5 | Typed data/taint/capability floor; S3/S4 |
| H6 | S4 deterministic real-boundary fixture |
| Y1 | Minimal scalar + optional keyed collection contract |
| Y2 | TypeScript + imported test fixture as one source of truth |
| Y3 | No lineage/staleness/retry invalidation; append-only attempts only |
| Y4 | Named scalar string run-input map |
| Y5 | Blocked-reconciliation human unblock only; no general resume |

Medium review repairs are also incorporated: ancestor-scope binding, per-loop-instance budgets, message-derived usage, dispatch-boundary wall time, nonblocking start, and local-only execution.

## Plan self-review

- Every blocker/high/YAGNI finding and every epic requirement maps to a named slice and falsifiable check.
- No generic lifecycle engine, research adapter/migration, research lifecycle rewrite, fictional dual completion pattern, recursive schema clone, dependency lineage, or general resume endpoint remains.
- S1a is independently shippable; S0 gates schema-dependent work; S3 names the DTO required by S5.
- The target workflow, strict fail-closed posture, exact roster/provider separation, and dedicated-repository contract are consistent across design, files, slices, dependencies, criteria, and external preconditions.
- There are no unresolved AJ product questions. Only S4 repository/provider provisioning facts remain, and they do not block S0–S3.
