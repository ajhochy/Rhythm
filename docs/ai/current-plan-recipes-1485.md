# Epic #1485 Plan — Recipes as Durable, Enforced Multi-Agent Workflows

**Status:** Repaired after PR #1490 adversarial review. AJ's four reserved decisions are settled. Docs only; implementation has not started.
**Source baseline:** file paths and line citations target branch `plan/recipes-1485` at `f6782882` (2026-08-26).

## Goal

Turn cookbook recipes from opaque prompt JSON into versioned, validated, durable multi-agent workflows that preserve legacy behavior, use one shared root-agent dispatch seam, and fail closed at every verdict, provider, approval, capability, completion-authorization, budget, reconciliation, and side-effect boundary.

## Constraints

- Flutter is the shipping editor. Web/mobile are not new workflow-authoring surfaces.
- Existing rows remain legacy prompt recipes; migration never reinterprets or rewrites `steps_json`.
- Workflow definitions may exist in SQLite and Postgres, but execution is local-agent-server only. Hosted/Postgres start returns `workflow_execution_unavailable` without creating a run.
- Research keeps its lifecycle loop, persistence/statuses, prompts, cancellation, retry, budget predicate, and restart behavior unchanged.
- `dispatchAgentStage()` is the only shared orchestration seam. Recipe claims, attempts, transitions, audit, cancellation fences, approval progression, and reconciliation are net-new and recipe-owned.
- Every stage dispatch is a root `AgentRunner` session; stage count does not consume delegation depth.
- V1 has exactly one fan-out level and `join(all)`; nested fan-out is rejected.
- Workflow execution remains behind `RHYTHM_RECIPE_WORKFLOWS_ENABLED`, default off, through S4.
- Backend completion requires a live behavioral test through the real API and engine in `tools/dev/sandbox.sh`, with an exact run note. Never start a second API server by hand.
- S4 side effects are allowed only in private `ajhochy/rhythm-workflow-e2e`, never the production Rhythm repository.
- `apps/api_server/src/services/generators/recipe_generator.ts` is concurrently owned by another stream; S1a must coordinate or rebase before editing it.

## Existing baseline and verified source findings

- Legacy cookbook execution compiles a prompt and calls blocking `AgentRunner.run()` once (`agentCookbookController.ts:120-166`); malformed JSON falls back to raw text.
- Research owns a research-shaped budget predicate (`research_project_orchestrator.ts:19-27`), in-flight coalescing (`:63-79`), two root dispatch sites (`:128-143`, `:275-298`), and restart re-dispatch (`:313-316`). It lacks durable claims, attempt identity, a transition engine, an append-only workflow ledger, persist-first cancellation, and session reattachment.
- `AgentRunner.run()` is blocking. Teacher escalation re-enters `run()`, invokes `onSessionCreated` again, and returns the teacher result/session (`agent_runner.ts:657-780`). Its global eight-slot capacity is released in `finally` only after `run()` settles (`:831-844`, `:1657-1659`).
- `agent_session_messages` has no provider column. The engine-observed source is assistant `info_json.providerID/modelID`; `agent_sessions.provider_id/model_id` is first-write configured/backfill data and is not authoritative observation.
- Approval redemption currently rejects another session (`external_content_security_service.ts:549-550`) and stale taint (`:570-575`); current TTL is ten minutes (`:250`, `:496`). `decideWithNonce` queues continuation whenever `session_id` is non-null (`agent_approvals_repository.ts:158-176`).
- MCP trusted calls carry signed tool/arguments/session identity; `authorizeOutboundAction` forwards `currentTrustedSecurityCall()` (`apps/mcp_server/src/security/external_content_boundary.ts:356-402`). A bearer-authenticated route alone does not authorize a completion for a stage.
- Flutter cookbook requests send no Authorization header (`agent_cookbook_data_source.dart:14-59`); the MCP client sends `Bearer ${RHYTHM_API_TOKEN}` (`apps/mcp_server/src/index.ts:30-40,63-80`).
- Optimizer recipe generation has its own legacy compiler (`recipe_generator.ts:119-143`) and creates cookbook rows programmatically (`:423` on the reviewed branch); proposal wiring is registered in `org_proposal_appliers_wiring.ts`.

## Design

### Settled architecture

| Option | Result |
|---|---|
| Put recipes in `ResearchProjectOrchestrator` | Rejected: wrong domain and research-shaped state. |
| Extract a generic durable orchestration engine | Rejected: research has none of the durable mechanics to extract. |
| **Share one minimal dispatch seam** | **Selected:** one root-dispatch option bag plus model override; recipe durability remains net-new. |

The epic's “do not build a second orchestration engine” means **one shared dispatch seam and no copied research lifecycle machinery**. It does not mean fictional reuse of mechanics research does not have. This boundary is recorded in `docs/ai/decisions/2026-08-26-recipe-extraction-boundary.md`.

### Exact `dispatchAgentStage()` seam

The genuinely extractable surface is approximately 20 lines: an option bag that calls root `AgentRunner.run()` and the existing research `modelOverride()` parsing/forwarding. Specifically:

1. Root dispatch is achieved by omitting `parentSessionId`; no helper logic is required.
2. `onSessionCreated` remains a caller-supplied closure. Workflow binding must fail before model dispatch if the durable local session or attempt binding cannot be persisted; research retains its existing nonfatal callback behavior.
3. Research's `exhausted()` is called twice per **run**, uses `ResearchProjectRun`, and remains in `research_project_orchestrator.ts`. Moving it would provide zero reuse and sharing it would change research behavior, contradicting S2.
4. Provider/model parsing via `modelOverride()` is reusable.
5. Public `suppressTeacherEscalation` support is net-new in `agent_runner.ts`; do not repurpose internal `_isEscalation`.

The seam covers both research dispatch call sites. Research behavior is unchanged. S2 is not a broad architecture gate: S1b and S3a repository/transition work may proceed in parallel; only S3a's dispatch wiring waits for this small seam.

### S0 durability probe

S0 dispatches one root stage, persists its binding and completion, restarts the sandbox API, and proves whether terminal output is recoverable without a second prompt. It gates S3 only; S1b freezes the same identity under either outcome and proceeds in parallel.

- **Recoverable:** S3 uses synchronous `AgentRunner.run()` plus direct durable completion.
- **Not recoverable:** S2/S3 add an `AgentRunner`-owned async start API that returns durable local and SDK identities after binding. The recipe runner must not call low-level `opencodeClient.promptAsync()` or duplicate AgentRunner lifecycle code.

The probe gets its own decision note with the observed result. The plan does not pre-select an unproved runtime behavior.

## V1 contract

### Persistence and compatibility

Add only `schema_version` and `definition_json`. Format is derived: `definition_json IS NULL` means legacy prompt; non-null means workflow. Existing and future repository callers that omit workflow fields produce `schema_version = NULL, definition_json = NULL`; `steps_json` remains byte-identical and authoritative for legacy execution. Do not infer format from `steps_json` shape.

S1a exposes a neutral `legacy` classification only. It withholds `explicit_upgrade_required` until S1b supplies a real upgrade path, avoiding an alarming dead-end state for 10–15 production users. Workflow create/update validates before persistence. Runs snapshot canonical definition and input hashes; no recipe revision-history subsystem is added.

### Minimal schema and one-level fan-out

TypeScript plus imported test fixtures are the single source of truth; no duplicate docs JSON schema and no new validation dependency.

```ts
type ScalarType = 'string' | 'number' | 'boolean';
type ScalarFields = Record<string, ScalarType>;
type VerdictOutcomeV1 = 'pass' | 'fail' | 'repair';
type OutputContract = {
  fields: ScalarFields;
  items?: { keyField: string; fields: ScalarFields };
};
type RunInput = Record<string, string>;
```

The closed definition contains `schemaVersion: 1`, `entryStageId`, `stages`, run-wide cost/token/wall-time/stage-execution budgets, and named loop budgets. Stages are only `agent`, `gate`, `approval`, and `fanOut`. Bindings are closed references to run input, a declared stage-output scalar/keyed item, or the current fan-out item.

`itemKey: string | null` is the only scope identity. Root stages use null; fan-out children use a non-empty declared string key. Duplicate keys fail before claims; nested fan-out and sibling references fail validation; empty fan-out joins successfully with zero children. Binding resolution is “current item, else run root”—there is no `scopePath`, ancestor walk, or sibling-scope ambiguity rule. Logical stage identity is `(runId, stageId, itemKey, loopIteration)`; attempt identity adds `attemptId`.

Unknown fields, duplicate IDs, unreachable stages, missing targets, type mismatches, unavailable producers, unbounded back edges, invalid provider/model pairs, nested fan-out, duplicate/empty item keys, and uncapped loops fail with stable `{path, code, message}` diagnostics. No arbitrary expressions, recursive contracts, lineage/staleness, retry invalidation, or general graph language exists.

### Provider observation and session binding

Provider-separated author/reviewer stages require explicit atomic `{providerId, modelId}`. `differentProviderFromStageId` is valid only when both are explicit and provider IDs differ. Pinned stages set `suppressTeacherEscalation`.

A stage's durable binding is **only `AgentRunResult.sessionId`**. `onSessionCreated` may provision the row, but an attempt commits the returned result ID after `run()` resolves. If one dispatch invokes session creation more than once, returns a different session, or otherwise produces more than one session, the attempt fails closed. This prevents escalation from silently rebinding usage, completion, or audit evidence.

Observed routing comes solely from `agent_session_messages.info_json → providerID/modelID` for `role='assistant'`, joined through the bound `result.sessionId`. Require at least one assistant message; zero observed values, a mismatch, or mixed provider/model values fail closed. Mixed values are possible because mid-run cross-provider re-dispatch already exists (`opencode_stream_bridge.ts:1542-1544`). `agent_sessions.provider_id/model_id` and configured values are never accepted as observed evidence; there is no live-engine fallback in the product contract.

### Verdict, completion authorization, and typed flow

A verdict contains matching `runId`, `stageExecutionId`, `attemptId`, outcome `pass | fail | repair`, non-empty reasons, and typed evidence references. `blocked` is not a v1 verdict. Unsupported keys/outcomes, missing identity, malformed output, conflicting verdicts, and contract failures produce `invalid_verdict`; `onInvalid` is mandatory and success is impossible.

`AgentRunner.status === 'done'` is only dispatch completion, never workflow success. Output shape commit and, for gates, a valid verdict determine transitions.

`rhythm_complete_workflow_stage` calls a local API completion endpoint with bearer authentication **and** the engine-signed trusted call. The MCP handler forwards `currentTrustedSecurityCall()` / `TrustedSecurityContext`; the API verifies tool name and exact argument hash, calls server-side `requireKnownSession`, then requires the resolved durable session to equal the active attempt binding for `(runId, stageExecutionId, attemptId)`. No binding, another stage/session, stale/superseded attempt, or cancelled run is rejected before idempotency or commit. Thus a coder cannot post its own review verdict.

Inputs are materialized and hashed before dispatch. Completion validates output before immutable commit. Taint IDs propagate from declared inputs and observed external/tool content. Consequential stages enforce the server capability/approval floor; recipe authors may strengthen but not weaken it. Effective grants must prove containment; null legacy allowlists do not mean unrestricted.

### Approvals: scoped relaxation and explicit tradeoff

AJ accepted relaxation of cross-session and stale-taint redemption guards **only for rows explicitly discriminated as `approval_kind='workflow'` in the existing approval model**. This is a row discriminator, not a new security binding kind or parallel table. Session-kind approvals remain byte-for-byte unchanged because they protect email, messaging, calendar, PCO, PR creation, and every other outbound integration from injected-content replay.

Workflow approvals retain signature, nonce, status, exact action/payload digest, bound workflow run/stage/attempt, expiry, and atomic `consumedAt`. They use a configurable workflow TTL (environment/config field, validated positive duration; default 24 hours), not the session constant `APPROVAL_TTL_MS = 10 * 60 * 1000`. The accepted tradeoff is that a workflow approval may be redeemed after the originating session/taint turn changes; explicit workflow identity and payload binding replace those two guards, increasing replay exposure if workflow binding is wrong. Completion authorization and single-use consumption therefore fail closed. See `docs/ai/decisions/2026-08-26-recipe-workflow-approval-guards.md`.

To prevent double advancement, workflow approvals are explicitly distinguishable before `decideWithNonce`: they have no session continuation, decision does not set `continuation_state='queued'`, the controller does not call `AgentApprovalContinuationService`, and only the recipe runner atomically claims the approved transition. Session approvals retain existing continuation behavior unchanged.

### Durability, cancellation, flag-off, and audit

- Start persists and returns `{runId, status:'pending'}` before dispatch; it never holds the request for the workflow.
- Claims, attempts, completions, transitions, and approval consumption are atomic/idempotent. Capacity/profile failures create no attempt and requeue without consuming repair budget.
- Each loop instance is keyed by `(loopId, itemKey)` and has positive iteration/cost/token/wall-time caps. Usage sums message rows for the bound session. Run budgets are aggregate ceilings.
- Cancellation fences run and pending/active stages before SDK abort. Abort/cancellation must make blocking `AgentRunner.run()` settle and release its global slot through `_releaseSlot`/`finally` immediately rather than waiting for the normal deadline; tests assert active count returns to baseline and queued interactive work can acquire the slot. Late completion cannot resurrect the run.
- Turning the feature flag off rejects new starts and, at the next runner heartbeat/dispatch boundary, persistently transitions every in-flight run to terminal `workflow_disabled`, fences stages, aborts active sessions, and releases slots. Rows remain visible for monitoring; the flag never silently orphans work.
- Restart never replays committed work. Ambiguous consequential side effects become `blocked_reconciliation`; only an authenticated human-unblock action exists.
- Raw stage inputs/outputs are **sensitive-by-construction** workflow state: owner-scoped local reads only, never included in list DTOs/logs/run notes, retained until the owner deletes the run. The append-only audit ledger stores IDs, hashes, bounded redacted reasons, state transitions, routing/usage totals, and timestamps—never prompts, credentials, auth headers, environment values, tool arguments/results, or raw stage payloads. Deleting a run purges sensitive payload rows while retaining non-content integrity events for 30 days, then purges them. No general audit API ships in v1.

## Named S3 DTO contract

```ts
type RecipeWorkflowStageDtoV1 = {
  stageExecutionId: string;
  stageId: string;
  itemKey: string | null;
  attemptId: string | null;
  status: 'pending' | 'running' | 'blocked_approval' |
    'blocked_reconciliation' | 'succeeded' | 'failed' | 'cancelled';
  profileId: string | null;
  configuredProviderId: string | null;
  configuredModelId: string | null;
  observedProviderId: string | null;
  observedModelId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  outcome: VerdictOutcomeV1 | null;
};
type RecipeWorkflowRunDtoV1 = {
  version: 1;
  runId: string;
  recipeId: string;
  status: 'pending' | 'running' | 'blocked_approval' |
    'blocked_reconciliation' | 'succeeded' | 'failed' |
    'budget_exhausted' | 'workflow_disabled' | 'cancelled';
  stages: RecipeWorkflowStageDtoV1[];
  pendingApprovalId: string | null;
  createdAt: string;
  updatedAt: string;
};
```

There is no `dispatching` status or `terminalReceipt` v1 product field. The final `shippable_pr` stage output already contains the PR URL; S4 may assert richer fixture-only receipt details.

## Target workflow and roster

`planning → contrarian_review → adjust_plan → issue_writer → fanOut(issue) { acceptance_contract → coder → review → review_verdict_gate → [pass | coder_repair → review loop] → smoke → smoke_verdict_gate → [pass | failure_triage → smoke_repair → smoke loop] } → join(all) → approval → shippable_pr`

| Work | Profile | Provider rule |
|---|---|---|
| Planning/adjusted plan | `planning-agent` | Explicit OpenAI authoring override |
| Contrarian review | `planning-agent` | Explicit Anthropic Opus review override; observed values verified |
| Issue/acceptance contract | `issue-writer` | Explicit OpenAI authoring override |
| Code/repairs | `coding-agent` | Explicit OpenAI authoring override |
| Code review/verdict | `verification-gate` | Explicit Anthropic review override; observed values verified |
| Smoke | `smoke-test-writer` | Explicit OpenAI authoring override |
| Failure triage | `failure-triage` | Explicit OpenAI authoring override |

Both repair loops have all four caps and explicit exhausted targets. `shippable_pr` requires all item keys to pass, workflow approval consumption, and the smoke-tested head SHA.

## S4 dedicated-repository security preconditions

1. Provision a fine-grained PAT scoped **only** to `ajhochy/rhythm-workflow-e2e`, with the minimum contents/pull-request/check permissions required by the fixture. No production Rhythm permission is permitted.
2. Start the sandbox with `GH_TOKEN` and `GITHUB_TOKEN` explicitly overridden to that PAT; unset/replace ambient `gh` credentials so they are unreachable inside the sandbox. Missing override fails preflight before any Git command.
3. Verify private repo visibility, base `main`, branch/PR/check/close/delete rights, and required check `workflow-e2e` before dispatch. Never rely on a post-hoc `--repo` receipt check to prevent a wrong-repo push/comment/delete.
4. Every Git/`gh` command uses explicit `--repo ajhochy/rhythm-workflow-e2e` or a remote URL pinned to it. Audit/logs record no token values.
5. Success is a draft PR whose head SHA equals the smoke-tested SHA and whose `workflow-e2e` check is green. Then close it and delete its remote branch; cleanup failure fails S4.

## Authentication by caller

- **Flutter start/get/cancel/list:** loopback local-agent routes remain compatible with the shipping data source and require no Authorization header; they reject nonlocal/hosted execution by deployment/DB gate. Do not place blanket bearer middleware ahead of these routes.
- **MCP completion:** sends `Bearer RHYTHM_API_TOKEN` and the engine-signed trusted call. Bearer authenticates the client; trusted context plus server-side session-attempt binding authorizes the completion.
- **Hosted callers:** may persist definitions through normal hosted auth, but workflow start/completion returns `workflow_execution_unavailable` and creates nothing.

## File structure map

| File | Responsibility |
|---|---|
| `apps/api_server/src/config/env.ts` | Default-off flag and configurable workflow approval TTL. |
| `apps/api_server/src/contracts/recipe_workflow_contract.ts` | Sole strict v1 contract/validator. |
| `apps/api_server/src/repositories/agent_cookbook_repository.ts` | Additive schema/definition persistence and legacy defaults. |
| `apps/api_server/src/database/migrations.ts` | SQLite cookbook/workflow tables and idempotent defaults. |
| `apps/api_server/src/database/postgres_bootstrap.ts` | Definition parity only; no hosted execution. |
| `apps/api_server/src/controllers/agentCookbookController.ts` | Byte-compatible legacy execution and workflow CRUD delegation. |
| `apps/api_server/src/services/generators/recipe_generator.ts` | Keep generated/refined rows legacy; concurrent-stream collision. |
| `apps/api_server/src/services/org_proposal_appliers_wiring.ts` | Ensure proposal-applied cookbook rows cannot bypass legacy classification. |
| `apps/api_server/src/services/dispatch_agent_stage.ts` | Minimal root option bag plus model override. |
| `apps/api_server/src/services/research_project_orchestrator.ts` | Calls seam at both dispatches; all research lifecycle stays unchanged. |
| `apps/api_server/src/services/agent_runner.ts` | Public escalation suppression; conditional async start; cancellation settlement/slot release. **Highest-fan-in service: impact analysis required before edit.** |
| `apps/api_server/src/repositories/recipe_workflow_repository.ts` | Runs, claims, attempts, completion, transitions, workflow approval links, payload retention, audit. |
| `apps/api_server/src/services/recipe_workflow_runner.ts` | Transitions, one-level fan-out, budgets, cancellation, reconciliation. |
| `apps/api_server/src/services/external_content_security_service.ts` | Kind-scoped workflow redemption guards/TTL; session path unchanged. |
| `apps/api_server/src/repositories/agent_approvals_repository.ts` | Workflow-kind decision without session continuation queueing. |
| `apps/api_server/src/controllers/agentWorkflowController.ts` | Start/get/cancel/unblock and trusted completion authorization. |
| `apps/api_server/src/routes/agentWorkflowRoutes.ts` | Caller-specific route middleware/locality. |
| `apps/mcp_server/src/security/external_content_boundary.ts` | Trusted call/context forwarding precedent for completion. |
| `apps/mcp_server/src/tools/agentWorkflow.ts` | Completion tool. |
| `apps/mcp_server/src/index.ts` | Tool registration; PR reports approximate tool count. |
| `apps/api_server/src/__tests__/contract/recipe_workflow_*.test.ts` | S0–S3 contracts. |
| `apps/api_server/src/__tests__/recipe_workflow_live_e2e.test.ts` | Env-gated dedicated-repo proof. |
| `apps/desktop_flutter/lib/features/agent_cookbook/models/*.dart` | Definition and run DTOs. |
| `apps/desktop_flutter/lib/features/agent_cookbook/data/agent_cookbook_data_source.dart` | Local caller contract without bearer. |
| `apps/desktop_flutter/lib/features/agent_cookbook/widgets/recipe_steps_editor.dart` | Six vertical editor controls. |
| `apps/desktop_flutter/lib/features/agent_cookbook/widgets/recipe_flow_visualization.dart` | Generated read-only flow. |
| `apps/desktop_flutter/lib/features/agent_cookbook/views/agent_cookbook_view.dart` | Create/edit/run/monitor/approval UX. |
| `apps/desktop_flutter/test/features/agent_cookbook/recipe_workflow_editor_test.dart` | Real-view control, diagnostics, and monitoring tests. |

## Delivery slices / issue table

| Slice | Likely files | Falsifiable acceptance criteria | Dependencies | Required validation |
|---|---|---|---|---|
| **S0 — Restart recovery probe** | Focused live contract; decision note | One root dispatch/completion survives sandbox API restart without a second prompt; note selects sync or AgentRunner-owned async mode. | None; gates S3 only. | Build fork/API; sandbox `up/status/down`; serial env-gated probe; exact run note. |
| **S1a — Add cookbook columns/default-off classification** | env; cookbook repo/controller; migrations/bootstrap; `recipe_generator.ts`; proposal wiring | Existing/generated/proposal-applied rows have null definition/schema and byte-identical legacy behavior; both legacy compilers remain compatible; no `explicit_upgrade_required` is exposed; structural defaults are idempotent in SQLite/Postgres; flag defaults off. | None. Coordinate `recipe_generator.ts` collision. | `tsc --noEmit`; cookbook/#740/#851/generator/proposal/migration/Postgres parity tests; malformed legacy fixtures. |
| **S1b — Freeze minimal validator** | contract; fixtures; tests | Closed scalar/keyed contract, `itemKey`, one fan-out, all join, provider rules, targets and four caps validate; nested fan-out, duplicates, bad bindings and every listed invalid shape return stable path/code. | None; runs parallel with S0/S1a. | `tsc --noEmit`; one focused test per validator rule. |
| **S2 — Extract minimal dispatch seam** | dispatch seam; research orchestrator; `agent_runner.ts` | Both research call sites use ~20-line option/model seam; `exhausted()` stays research-local; pinned dispatch cannot escalate; exactly one session/result binding; all research behavior remains unchanged. | None; S3 dispatch wiring only waits for seam. | GitNexus impact on AgentRunner/orchestrator; #1292–#1295 plus AgentRunner escalation/session-count coverage; `tsc --noEmit`; compare detect-changes. |
| **S3a — Repository, runner, transitions, budgets, cancellation** | workflow repo/runner, DB, controller/routes, DTO tests | Nonconsequential workflows start pending; unique claims/attempts/completions; one-level fan-out/all join; closed verdict transitions; observed provider requires nonempty uniform assistant metadata; all caps; restart; flag-off terminalization; cancellation settles run and releases global slot; DTO exactly matches plan. | S0 mode + S1b; dispatch portion uses S2. | Serial transition/race/provider/fan-out/budget/restart/flag/cancel/slot/DTO tests; `npm test`; `tsc --noEmit`; sandbox lifecycle run note. |
| **S3b — Approval, taint, capability, completion authorization** | workflow controller/MCP tool; security service; approval repo; policy tests | Consequential stages cannot run in S3a; completion requires trusted caller session bound to active attempt; no/mismatched binding fails; workflow-kind only bypasses cross-session/stale-taint; session approval behavior is byte-identical; workflow TTL configurable; no continuation double-advance; policy/capability floor and sensitive ledger policy hold. | S3a + S1b. | Forgery/coder-self-verdict/unknown-session/replay/expiry/mixed-kind/session-regression/double-advance/taint/grant/retention tests; live trusted-call behavioral test in sandbox. |
| **S4 — Dedicated-repo E2E** | live E2E; fixture profiles/workflow; run note | Security preconditions pass before Git; exact workflow traverses real API/engine; deterministic coder/smoke repair; fail-closed caps/restart/cancel/approval; draft PR only in dedicated repo, tested SHA/check match, cleanup succeeds. | S3b. | Preflight fine-grained PAT and provider/model metadata; sandbox only; `RHYTHM_LIVE_E2E=1 npx vitest run src/__tests__/recipe_workflow_live_e2e.test.ts --no-file-parallelism`; exact receipt/cleanup note. |
| **S5 — Flutter editor/monitor** | Flutter models/data/view/widgets/tests | Six controls below work; no raw JSON/drag canvas/new dependency; inline diagnostics; neutral legacy state remains runnable; generated flow; real view starts/monitors DTO and approval across restart. | S1b + stable S3 DTO. Visualization demo may use S4 fixture but editor is not gated on S4. | format; analyze; feature tests; macOS manual smoke create/edit/view/run/restart/approve/reject/terminal URL. |

### S5 per-control acceptance

| Control from #1485 | Acceptance criterion |
|---|---|
| Agent dropdown | Lists only effective permitted profiles; required selection serializes `profileId`. |
| Optional provider/model override | Provider selection filters models; pair is atomic; clearing removes both; server diagnostics render inline. |
| Inputs selected from prior steps | Only run root or current-item available producers appear; incompatible/unavailable outputs cannot be saved. |
| Gate/verdict configuration | Offers only `pass/fail/repair`, declared evidence, and required `onInvalid`; no `blocked`. |
| On-fail target | Lists reachable valid stage IDs and persists the selected target; missing target blocks save. |
| Maximum iterations and relevant caps | Positive iteration, cost, token, and wall-time controls are all required for loops and preserve server values on edit. |

## Dependencies and remaining blockers

1. S0 gates S3 dispatch mode only; S1b runs in parallel.
2. S1a is independently deployable but exposes only neutral legacy classification and enables no execution.
3. S2 is a small seam; only S3a dispatch wiring waits for it.
4. S3a must land before S3b; consequential stages remain disabled until S3b passes.
5. S4 waits for S3b and its security preconditions. S5 needs S1b plus the stable S3 DTO, not S4.

**Remaining product blockers:** none; AJ settled extraction, approval scope, S4 credentials, and one-level fan-out. **Remaining factual/security preconditions:** S0's observed recovery mode; collision coordination for `recipe_generator.ts`; dedicated-repo fine-grained PAT/check/permissions; selected OpenAI/Anthropic models and assistant `info_json` observability. Default-on rollout remains outside this epic and requires later AJ review/manual smoke.

## Requirement coverage

| Requirement | Slice/proof |
|---|---|
| Legacy compatibility/default off | S1a byte fixtures, generator/proposal tests, SQLite/Postgres parity. |
| Minimal schema and one-level fan-out | S1b closed validator fixtures. |
| One shared seam/no research rewrite | S2 research + AgentRunner contracts. |
| Durable runner/cancellation/restart/budgets | S3a serial contracts and sandbox lifecycle. |
| Enforced completion/approvals/capability | S3b signed-context, bound-session, kind-regression, replay tests. |
| Exact workflow/dedicated repo | S4 real API/engine and security preflight. |
| Shipping editor and six controls | S5 real-view tests and macOS smoke. |

## Prior contrarian repairs retained

| Finding | Repaired sections |
|---|---|
| B1–B3 | Design; S0; completion/durability; S2/S3 |
| H1–H3 | Provider observation; one-level fan-out; capacity |
| H4–H5 | Approval semantics; taint/capability; S3b |
| H6 | S4 real-boundary fixture |
| Y1–Y5 | Minimal values, TS source, no lineage, named input, reconciliation-only unblock |

## Contrarian repairs incorporated (PR #1490 reopened review)

| Finding | Repaired section |
|---|---|
| F1 extraction meaning | Settled architecture; extraction decision record |
| F2 real seam size/budget predicate | Exact `dispatchAgentStage()` seam; S2 |
| F3 AgentRunner fan-in/escalation | File map; S2 validation |
| F4 escalation returns teacher session | Provider observation/session binding; S2/S3a |
| F5 authoritative observed provider | Provider observation/session binding; S3a |
| F6 scoped approval relaxation/TTL/tradeoff | Approvals; file map; approval decision record; S3b |
| F7 continuation double-advance | Approvals; S3b |
| F8 completion authorization | Verdict/completion authorization; caller auth; S3b |
| F9 remove `blocked` verdict | Minimal schema; verdict; S5 controls |
| F10 cancellation slot leak | Durability/cancellation; AgentRunner file map; S3a |
| F11 dedicated-repo credential prevention | S4 security preconditions |
| F12 generator/applier classification | Baseline; file map; S1a collision/criteria |
| F13 alarming premature migration state | Persistence/compatibility; S1a |
| F14 caller-specific authentication | Authentication by caller; file map; S3b/S5 |
| F15 sensitive ledger/retention | Durability/audit; S3b |
| F16 flag-off in-flight behavior | Durability/flag-off; S3a |
| F17a derive format | Persistence/compatibility |
| F17b remove nested scope | Minimal schema/one-level fan-out; DTO |
| F17c remove `blocked` | Verdict contract |
| F17d remove `terminalReceipt` | DTO contract |
| F17h S0 gates S3 only | S0; dependencies |
| Split S3 | S3a/S3b issue rows |
| S5 false S4 dependency | S5 issue row; dependencies |
| F18 citations/baseline | Header; verified source findings |
| Six editor controls | S5 per-control acceptance |

## Doubt review

The plan is wrong if S0 cannot recover under either AgentRunner-owned mode, assistant `info_json` is not durable enough to prove one observed provider/model, trusted-call session identity cannot be bound to a stage attempt, cancellation cannot unwind `run()` promptly, or a repository-scoped PAT cannot perform the isolated fixture. The cheapest probes are S0, one pinned-provider message query, one forged/valid completion pair, one active-slot cancellation test, and S4 preflight. Do not compensate with transcript scraping, configured-provider equivalence, global approval relaxation, manual slot counters, side-effect replay, or production-repo testing.

## Plan self-review

- Every reopened finding maps to a repaired section and falsifiable slice criterion.
- The target workflow and fail-closed posture remain intact.
- No generic engine, research migration, nested fan-out, `blocked` verdict, raw JSON editor, general resume, or production-repo E2E remains.
- No AJ product decision remains open; only runtime/provisioning facts and the concurrent-file collision require resolution before their named slices.
