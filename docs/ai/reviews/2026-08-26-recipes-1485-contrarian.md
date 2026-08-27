---
date: 2026-08-26
repo: Rhythm
epic: 1485
reviews: docs/ai/current-plan-recipes-1485.md
author_model: openai/gpt-5.6-sol (plan)
reviewer_model: anthropic/claude-opus-5 (this review)
status: accept-with-required-repairs
tags: [review, contrarian, rhythm]
---

# Contrarian review — Epic #1485 recipe workflow plan

Cross-provider adversarial review. The plan was authored on OpenAI; this review runs
on Anthropic. Every claim below is checked against current code on
`fix/bridge-stream-reliability`. Docs-only; no `apps/` file was modified.

## What the plan gets right (verified, not conceded)

Stated first so the criticism below is not mistaken for a blanket rejection.

- **Baseline claim about the cookbook is accurate.** `_compileStepsToPrompt`
  (`agentCookbookController.ts:169-196`) returns raw `stepsJson` from its `catch`,
  and `runRecipe` (:119-165) compiles one string and calls `AgentRunner.run()` once.
  Malformed JSON really is passed through as prompt text.
- **Root/sibling dispatch works — Q4 answers YES.** `MAX_DELEGATION_DEPTH = 2` is
  enforced *only* in `agent_delegation_service.ts:149-152` and `:272-275`.
  `AgentRunner.run()` performs no depth check; it stamps what it is given
  (`agent_runner.ts:1007-1008` → `agent_sessions_repository.insert:373-374`). "Root"
  is simply `parent_session_id IS NULL, delegation_depth = 0`. There is no ownership
  or auth gate inside `run()` — background callers (`agentSchedulerService.ts:26`,
  `skill_refiner.ts:142`) already create root sessions for arbitrary `ownerUserId`.
  The plan's core dispatch invariant is sound.
- **Cancellation divergence is correctly characterised.** `cancelProjectPass`
  (`agent_research_repository.ts:696-707`) does `await abort(job.agentSessionId)`
  *then* writes `cancelled`. The plan's "aborts before persisting" claim is true and
  its persist-first inversion is the right fix.
- **Postgres parity for cookbook columns is required, and the plan requires it.**
  `agent_cookbook` is bootstrapped in Postgres (`postgres_bootstrap.ts:1128-1142`,
  `:1596`) as well as SQLite (`migrations.ts:2111-2124`, `:3527`).
- **Default-off flag has precedent.** `env.researchProjectsEnabled` /
  `requireProjectsEnabled()` (`agent_research_repository.ts:205-206`).

Now the attack.

---

## BLOCKERS

### B1 — `DurableStageEngine` is a second orchestration engine wearing an extraction's name

**Plan section:** "Chosen architecture and extraction boundary" (Option B, items 1–7);
slice **S2**; gate "S2 → S3: this is the anti-second-engine gate".

**Claim under test:** the engine is a minimal *extraction* of mechanics already in
`research_project_orchestrator.ts`.

**Evidence — I audited all seven claimed capabilities against the real 317-line file.
Two exist. Five do not.**

| Plan says engine owns | Reality in `research_project_orchestrator.ts` |
|---|---|
| 1. Coalesced `start()` + **durable stage claims** | Coalescing **EXISTS** (`inFlight` Map, `:64`, `start():71-80`) — ~10 lines. Durable claims **DO NOT EXIST**: `createProjectPassJob` (`agent_research_repository.ts:534-570`) is a plain `INSERT` with `randomUUID()`; there is **no unique constraint** on `(project_run_id, pass_ordinal)`. Dedup is in-process only: `jobs.find(c => c.passOrdinal === ordinal)` (`:106`). |
| 2. Stable logical stage + attempt identity | **DOES NOT EXIST.** Identity is an integer `passOrdinal` plus magic ordinals `1000`/`1001` (`:180`, `:198`). Attempts do not exist; retry mutates the same row. |
| 3. Root dispatch w/ profile + model override | **EXISTS, but as omission not machinery** — `this.runner.run({...})` (`:130-143`) simply never passes `parentSessionId`. Extractable surface ≈ 15 lines plus `modelOverride()` (`:34-39`). |
| 4. Pre-dispatch **and** post-result budget eval | **PARTIAL, WRONG SHAPE.** `exhausted()` (`:19-28`) is called exactly twice: once before the loop (`:88`), once after it (`:165`). Never per dispatch. The plan's own divergence table concedes this ("checked around the whole run"). |
| 5. Completion validation callback, transition selection, append-only audit callback | **NONE EXIST.** Completion is the inline expression `result.status === 'done' && result.result.trim()` (`:151`). "Transitions" are a `for` loop plus two `if` blocks (`:175`, `:189`). Persistence is mutating `updateProjectPassJob`/`updateProjectRunState` — there is no ledger. |
| 6. Persist-first cancellation fencing | **DOES NOT EXIST AND IS INVERTED** (see `cancelProjectPass` above). Inside the orchestrator cancellation is only a post-hoc re-read + `continue` (`:147-149`). |
| 7. Restart reconciliation that reattaches sessions | **DOES NOT EXIST.** `reconcileInterruptedStarts` (`:313-316`) lists interrupted runs and calls `start()`, which skips `done`/`error` and **re-dispatches everything else from scratch**. No session is reattached. |

**The finding.** The genuinely extractable surface is roughly **40 lines**: an
in-memory promise map, an `AgentRunner.run()` option bag, a `"provider/model"` string
split, and a four-field budget predicate. Everything else the plan assigns to the
"generic engine" is net-new mechanics that research neither has nor needs.

S2 therefore does not extract research's mechanics onto a shared engine. It
**replaces research's persistence and control model with a recipe-shaped one** and
relabels research an adapter. That is the second engine — having eaten the first —
and it wagers shipped, contract-tested behaviour (#1292–#1295) for near-zero reuse
payoff. The plan's own S2 acceptance list ("All existing research run/job statuses,
critic/synthesis provenance, cancellation, retry, budget, scheduled idempotency, and
restart behavior remain contract-compatible") is a long regression-risk inventory
disguised as an acceptance criterion.

**Smallest repair — invert the extraction:**

1. Extract exactly one shared module, `dispatchAgentStage()`: the root
   `AgentRunner.run()` call, the `modelOverride` parse, the `onSessionCreated`
   session-binding callback, and the `exhausted()` budget predicate. Repoint
   `ResearchProjectOrchestrator` at it with **zero behaviour change** — its `for`
   loop, statuses, and prompts stay.
2. All net-new mechanics (DB claims, attempt identity, append-only audit, cancel
   fences, reconciliation) live in the recipe runner, where they are actually
   required.
3. Restate the epic's anti-second-engine rule as the *provable* form: **one shared
   dispatch seam, and no copy of the lifecycle loop / `inFlight` map / budget
   predicate / session callback / interrupted-run scan in recipe code.** That is the
   plan's own §"extraction is complete only when…" sentence, minus the research
   migration.

S2 shrinks from a multi-day rewrite to roughly half a day and stops being a
research-regression vector. **This reinterprets AJ's epic language and therefore needs
AJ's ratification** (retained decision #3 below).

---

### B2 — The durability premise is unverified, and the probe is scheduled *after* the two slices that depend on it

**Plan section:** "Durable identity, idempotency, resume, cancellation, and audit";
"Doubt review"; dependency gates 1–2.

**Evidence:**

- `AgentRunner.run()` is **blocking**: `export async function run(opts): Promise<AgentRunResult>`
  (`agent_runner.ts:760`) awaits `_runOnce` (:785) which awaits `opencodeClient.prompt`
  (:1433). A stage's outcome exists only as an in-process promise.
- `AgentRunResult` (`:440-449`) is `{sessionId, result, status, error?, errorCode?,
  failureCategory?}` — **no usage, no durable receipt**.
- After a crash the only reconciliation is `OpencodeStreamBridge.reconcileSessionStatuses`
  (`opencode_stream_bridge.ts:677`), which coerces `working`/`starting` rows to `idle`.
  **Nothing recovers the terminal result of a synchronous `run()` whose process died
  mid-flight.** `AsyncDelegationCompletionService.recoverAfterRestart`
  (`async_delegation_completion_service.ts:43`) covers only async *delegation children*,
  keyed on parent/child **session ids** — not workflow stages.

The plan's own doubt review names this exact risk — then schedules the probe as "an S2
spike test", i.e. **after S1 has frozen a schema whose `blocked_reconciliation`
terminal, side-effect receipts, and idempotency keys exist precisely to answer it.**

**Smallest repair — make the probe S0, a precondition of S1.** Two outcomes, both
schema-shaping:

- (a) A stage's terminal state *is* recoverable post-restart from `agent_sessions` plus
  the completion write → S1 freezes as designed.
- (b) It is not → the runner must dispatch stages **asynchronously**. The engine already
  supports this (`opencodeClient.promptAsync`, used at
  `agent_approval_continuation_service.ts:111-117`), and completion becomes
  session-idle + a durable completion row. That changes the stage-attempt schema and
  cannot land after a freeze.

---

### B3 — The completion boundary the plan claims to copy does not exist

**Plan section:** file-map row `apps/mcp_server/src/tools/agentWorkflow.ts`; divergence
row "Versioned `rhythm_complete_workflow_stage` using the **same dual MCP/API
validation pattern**"; S3 acceptance "identical completions are idempotent and
conflicting completions fail closed".

**Evidence:** `rhythm_complete_research_pass`
(`apps/mcp_server/src/tools/agentResearch.ts:224-277`) validates Zod args, calls
`authorizeOutboundAction`, returns `{accepted:true}` — **it writes nothing.** There is
**no HTTP route.** The real write is **transcript scraping**:
`specialist_research_indexer.ts:242-250` matches tool-call frames where
`tool === 'rhythm_complete_research_pass' && state.status === 'completed'`, re-parses via
`parseResearchPassCompletionPartially` (`:202-240`), persists in `persistCompletion`
(`:256+`), entrypoint `indexResearchSession` (`:321`), invoked from
`opencode_stream_bridge.ts:1902` on session idle.

Three consequences the plan does not handle:

1. **Completion is observed only when the session goes idle AND the in-process bridge is
   alive.** A crash between the model calling the tool and the indexer running loses the
   completion entirely — the plan's "external side effect with no receipt is
   `blocked_reconciliation`" would fire on work that actually succeeded.
2. **"Conflicting duplicates fail and append an integrity event" contradicts the existing
   mechanism**, which is `stableId(...)` + `INSERT ... ON CONFLICT(id) DO UPDATE`
   (`:252-254`, `:265-282`) — **last-write-wins**, not conflict-detecting.
3. **"Dual MCP/API validation pattern" describes a pattern that is not there.** What
   exists is Zod-at-the-tool plus a hand-rolled re-parse at the indexer — duplicated
   validation over a single scraped write path.

**Smallest repair:** specify the completion write as a **real authenticated HTTP endpoint
on the local agent server**, called directly by the MCP tool, so the write is durable at
tool-call time and independent of the stream bridge. Unique key
`(runId, stageExecutionId, attemptId)` with an explicit conflict branch. Add one
file-map row (`routes/agentWorkflowRoutes.ts` + controller) and one sentence in
§"Durable identity…". Do **not** model it on the research indexer.

---

## HIGH

### H1 — Teacher escalation silently swaps the provider mid-stage, defeating the cross-provider guarantee, the audit trail, and cost accounting

**Plan section:** "Versioned fail-closed verdict v1" → cross-provider paragraph;
coverage-matrix row "Cross-provider contrarian review"; divergence row
"`differentProviderFromStageId` validation and runtime check".

**Evidence:** `shouldEscalate` (`agent_runner.ts:657-666`) → `escalateAndCapture`
(`:698+`) re-runs **the same opts with `modelOverride` forced to the teacher model** on
any `teacherRetryable` error, gated only by `env.agentTeacherEscalationEnabled`. The
returned `AgentRunResult` (`:440-449`) carries no indication of which model produced it.

So a review stage pinned to provider B can silently execute on the teacher provider —
possibly the *same* provider as the author stage — after the plan's pre-dispatch check
has already passed. The epic explicitly forbids this: "no silent provider fallback
satisfies this constraint." Escalation also doubles a stage's cost invisibly.

**Smallest repair:** (a) evaluate provider separation **post-hoc against the observed
provider** recorded on the session's message rows, and fail the stage closed on
mismatch; (b) suppress escalation for provider-pinned stages (`_isEscalation: true` is
already the recursion guard at `:663`, or add an explicit opt).

### H2 — "Resolved provider" is nondeterministic without an explicit override

**Plan section:** same paragraph — "fail before dispatch if the resolved provider equals
the named author stage".

**Evidence:** `resolveRunModel` (`agent_runner.ts:499-548`) falls back to the
**most-recently-used** model (`:534`, log line "using most-recently-used model") and then
to `DEFAULT_PROVIDER/DEFAULT_MODEL` (`:548`). Validation-time resolution therefore does
not equal dispatch-time resolution — the same recipe can satisfy the constraint on one
run and violate it on the next.

**Smallest repair:** one validator rule — a stage carrying `differentProviderFromStageId`
requires an explicit `modelOverride`, **and so does the stage it names**. Removes an
entire class of flake for one line of validation.

### H3 — Fan-out concurrency ignores AgentRunner's global 8-slot cap; capacity errors will be misread as stage failures and burn repair-loop iterations

**Plan section:** "Branches, bounded loops, and fan-out" (`maxConcurrency`); S3
acceptance "join policy is deterministic".

**Evidence:** `MAX_CONCURRENT_AGENT_RUNS` defaults to **8**
(`agent_runner.ts:61`, doc comment `:12`), enforced by an in-process gate `_acquireSlot`
(`:455`). On exhaustion `run()` returns `{status:'error', errorCode:'capacity'}`
(`:834-842`) **without dispatching anything**. The desktop app's interactive sessions
share this pool.

A five-issue fan-out during ordinary desktop use will therefore mark issues failed that
were never attempted, take their `onFail` edge, and consume repair-loop iterations
against a non-LLM condition.

**Smallest repair:** two rules in the fan-out section. (1) effective `maxConcurrency` is
bounded by the runner's remaining slots; (2) `errorCode === 'capacity'` and
`'profile_unavailable'` are **retryable dispatch failures** that do not consume a loop
iteration and do not take `onFail` — they re-queue.

### H4 — Approval stages cannot reuse the continuation service, and reusing the approval row without TTL enforcement fails open

**Plan section:** "Durable identity…" final bullet; file-map row
`agent_approval_continuation_service.ts` ("Wake the durable workflow stage/run after an
approved or rejected gate").

**Evidence:** `AgentApprovalContinuationService` resumes an **existing engine session**
by prompting it (`agent_approval_continuation_service.ts:111-117`, after
`streamBridge.streamSession` `:96-97`) and fires only when that session is `idle`
(`:64-67`). A workflow `ApprovalStage` is a state-machine node, not a session — there is
nothing to continue. The plan's file-map row assigns workflow-waking to a
security-critical path that structurally cannot do it.

Separately: `expiresAt` and `consumedAt` are enforced **at redemption** in
`external_content_security_service.ts:496` (`APPROVAL_TTL_MS`) and `:558-577` — **not** in
`agent_approvals_repository.decideWithNonce` (`:158-189`). A workflow gate that reads
`status === 'approved'` honours neither TTL nor single-use. That is a fail-open on a gate
whose whole purpose is guarding consequential actions.

**Smallest repair:** workflow approvals consume `agent_approvals_repository`
(`decideWithNonce` + the signature verification already at
`agent_approvals_controller.ts:173-183`) plus a **workflow-owned** wake. Delete the
continuation-service row from the file map. Add two explicit runner checks:
`expires_at <= now → expired` target, `consumed_at IS NOT NULL → invalid`.

### H5 — Stage outputs carry no taint, so a PR-creating approval gate sits downstream of unlabelled external content

**Plan section:** "Typed stage data flow" — the only security-adjacent statement is
"Downstream prompts receive only declared bound inputs … not implicit prior transcript
history." That constrains the *channel*, not the *trust level*.

**Evidence that the repo already models exactly this and the plan ignores it:**
`markTainted` (`external_content_security_service.ts:380-446`) mints a `taintId`; approval
rows carry `taintId`, `taintedTurnId`, `boundAgent`, `payloadDigest`
(`agent_approvals_repository.ts:13-33`), populated at
`external_content_security_service.ts:492-495`.

The target workflow deliberately pipes model-authored prose from stages that read
external and tool content — contrarian review, smoke output, failure triage — into
downstream prompts and then into a consequential approval that creates a PR. Prompt
injection through a prior stage's output is a first-class path here, and stage-selected
profiles mean a compromised upstream output can steer which capabilities the next stage
runs with.

**Smallest repair:** one schema field and two sentences. Every committed stage output
records `taintIds: string[]`, inherited from its session's taints plus its input
bindings. An `ApprovalStage` whose evidence bindings resolve to any tainted output must
mint its approval through the existing tainted path
(`taintId`/`boundAgent`/`payloadDigest`), not a plain approval. Add "stage-selected
profile/tool sets are validated against a server-side allowlist; a stage cannot name a
profile with capabilities the run's initiator lacks."

### H6 — S4's forced-repair criterion is not falsifiable against live models

**Plan section:** S4 acceptance — "Test deliberately forces one review repair and one
smoke repair, then observes success", alongside "No mocks at the workflow/engine/API
boundary."

Forcing an LLM to emit `fail` on attempt 1 and `pass` on attempt 2 is not deterministic.
As written, S4 is a permanently flaky gate on the epic's headline acceptance criterion.

**Smallest repair:** force the loop with a **fixture agent profile** that deterministically
emits `outcome: 'fail'` for a given `stageExecutionId` on its first attempt and `pass`
after. It is still a real session through the real engine, so the no-mock rule holds, but
the branch is deterministic.

---

## MEDIUM

- **M1 — `stageOutput` binding cannot see run-level outputs from inside a fan-out scope.**
  §"Typed stage data flow" last bullet says resolution finds the latest committed output
  "**in the same fan-out scope**". The plan's own fixture (§"Target workflow fixture")
  has `coder` inside `fanOut(issue)` binding "adjusted-plan references" and `review`
  binding "the plan and acceptance contract" — `adjust_plan` is produced at run level,
  outside the scope. *Repair:* "resolves the nearest committed output walking the scope
  path upward to the run root; ambiguity across sibling scopes is a validation error."

- **M2 — Loop budgets are declared run-globally but consumed per fan-out scope.**
  §v1 shape `loops: Record<string, LoopLimits>`. With N issue scopes running the same
  `coder_repair` loop, a single `maxCostUsd` is either per-scope or a shared pool. Shared
  means issue #1 starves issue #5 and the join outcome depends on scheduling order —
  contradicting S3's "join policy is deterministic". *Repair:* one sentence — "loop limits
  are per loop **instance** (`loopId` + `scopePath`); run-level `budgets` is the only
  aggregate ceiling."

- **M3 — Budget accounting has no named source, and `AgentRunResult` supplies none.**
  §"Branches, bounded loops…" says caps are checked "after usage reconciliation" but never
  says from where. Usage exists only as per-message rows written by the stream bridge
  (`opencode_stream_bridge.ts:1522-1534` → `agent_session_messages.tokens_json`/`cost`).
  Research aggregates them with an explicit join
  (`agent_research_repository.ts:450-460`, `listRunUsageRows:489-501`). *Repair:* name it —
  "stage/loop/run usage is aggregated from `agent_session_messages` joined via the
  attempt's `agentSessionId`, mirroring `listRunUsageRows`."

- **M4 — Wall-clock caps cannot preempt an in-flight blocking stage.** `run()` owns its own
  deadline policy (`_createRunDeadlinePolicy` `agent_runner.ts:117`, `_withinRunDeadline`
  `:135`, abort at `:1620`). *Repair:* state that wall-clock caps are evaluated at dispatch
  boundaries only, and intra-stage timeout is delegated to the runner's deadline policy.
  Prevents a build-time invention.

- **M5 — Workflow start must not copy the legacy blocking-HTTP shape.** `runRecipe`
  (`agentCookbookController.ts:119-165`) **awaits the entire `AgentRunner.run()`** and only
  then sends `202`. A workflow run with fan-out and repair loops cannot hold an HTTP
  request. The plan never says otherwise. *Repair:* one line in S3 acceptance —
  "`POST /agent-cookbook/:id/workflow-runs` persists the run and returns
  `{runId, status:'pending'}` before dispatching."

- **M6 — Execution locality is unspecified; recipes live in two stores, only one of which
  has an engine.** Desktop CRUD targets `AppConstants.agentLocalBaseUrl`
  (`agent_cookbook_data_source.dart:10`) = the local SQLite server; mobile hits production
  via the `req.mobileDevice` branches (`agentCookbookController.ts:105-127`), and
  `agent_cookbook` is bootstrapped in Postgres. Production has no local opencode engine.
  *Repair:* definitions exist in both stores (hence the Postgres parity the plan already
  requires), but workflow **runs execute only on the local agent server**; production
  returns "workflow execution unavailable" rather than creating an unexecutable run row.

- **M7 — Dependency-derived invalidation is named but undefined.** §"Typed stage data flow":
  "A dependency retry creates a new lineage and marks only dependent, not unrelated,
  committed outputs stale." Nothing in current code does this (research marks only
  critic/synthesis stale, implicitly). This is the plan's largest undefined algorithm and
  exactly the kind of semantics that gets invented mid-build. *Repair:* define it as the
  static reachability closure over binding edges, computed at validation time and stored
  per stage — **or cut it from v1** (see Y3, which removes this finding entirely).

---

## LOW / YAGNI — power not required to prove the target recipe

- **Y1 — The recursive `ValueContract` system is a JSON-Schema reimplementation.** The
  fixture needs a plan reference (string), an issue collection with a stable key, a closed
  verdict enum, and a PR receipt object. Nested `object.fields` + `array.item` recursion +
  `keyField` is strictly more power. *Repair:* v1 output contracts =
  `Record<string, 'string'|'number'|'boolean'>` plus one optional
  `items: { keyField: string; fields: Record<string, ScalarType> }`. Drops the recursive
  validator and its error-path machinery. (This also resolves AJ decision #3 by default.)
- **Y2 — `docs/ai/contracts/recipe-workflow-v1.json` duplicates
  `recipe_workflow_contract.ts`.** Two hand-maintained sources of truth for one schema.
  *Repair:* keep the TS types plus a fixtures file consumed by tests; drop the parallel JSON.
- **Y3 — Retry / lineage / staleness is not required by the target recipe.** The fixture
  reaches `runFailed` or `budget_exhausted` on exhaustion; it never retries a stage and
  invalidates downstream. *Repair:* cut lineage and staleness from S1/S3. Keep append-only
  attempts (loops need them anyway). Removes M7.
- **Y4 — `inputContract`** — the target run takes one goal string. `Record<string,'string'>`
  in v1.
- **Y5 — a general `resume` endpoint.** Boot-time reconciliation already re-enters runs
  (mirroring `reconcileInterruptedStarts`, `research_project_orchestrator.ts:313-316`).
  *Repair:* scope the endpoint to unblocking a `blocked_reconciliation` run, not general
  resume.

---

## Slice sequencing (Q6): the five slices are not independently shippable as ordered

S1 freezes semantics that B2's probe must answer; S2 is a research-regression risk for
near-zero payoff (B1). Corrected sequence — same slice count, smaller S2, one genuinely
day-one-shippable slice:

| Slice | Change from plan |
|---|---|
| **S0 (new, ~½ day)** | Restart-recovery probe (B2). Dispatch one root stage, persist session + completion row, restart the API process, assert the terminal outcome is recoverable without re-prompting. Output: a decision note choosing sync `run()` vs async `promptAsync` dispatch. **Gates S1.** |
| **S1a** | Additive cookbook columns + legacy classification only. `recipe_format`/`schema_version`/`definition_json`, every row → `legacy_prompt`, byte-identical `steps_json`, `explicit_upgrade_required` surfaced, SQLite + Postgres parity, `env.recipeWorkflowsEnabled` default-off. **Zero dependency on the rest of the epic — genuinely shippable immediately.** |
| **S1b** | The v1 validator, after S0. No execution. |
| **S2 (shrunk)** | Extract `dispatchAgentStage()` only; repoint research at it with zero behaviour change (B1). Proven by the unchanged #1292–#1295 contracts. |
| **S3** | Recipe runner — unchanged scope, plus the completion HTTP endpoint (B3). |
| **S4** | Unchanged, plus the deterministic repair fixture (H6). |
| **S5** | Unchanged. |

---

## Q9 — Flutter deferral: correct, with one gap

S5 is properly gated on S1 schema + S3 run DTO, uses vertical cards with move up/down
buttons, explicitly excludes a canvas, and carries a falsifiable no-scope-creep criterion
("dependency list unchanged"). No drag-and-drop creep. **One gap:** S5's acceptance
requires "Run monitoring exposes durable stage/terminal status and approval pause", but no
run/stage DTO is ever specified. *Repair (low):* add the run/stage DTO shape to S3's
deliverables so S5 has a named contract to build against.

---

## Retained AJ decisions (3 of the plan's 12)

Discarded because the code or a safe default already answers them: **#1** legacy policy
(the epic's own text mandates it), **#2** revision history (snapshot + hash; YAGNI),
**#3** contract type system (resolved by Y1), **#4** provider separation (resolved by
H1+H2; same-provider fallback would violate the epic), **#5** fan-out policy (`all`;
`allowPartial` already in schema for later), **#6** approval policy (server floor is the
only safe default given H5), **#7** ambiguous side effects (the epic already mandates
fail-closed), **#10** branch topology (isolated per issue; `isolateWorktree` /
`worktreeName` already exist in `AgentRunOptions`, `agent_runner.ts:290-438`), **#12**
rollout (default-off flag, precedent `env.researchProjectsEnabled`).

**Genuinely blocking:**

1. **S4 destination and the definition of "shippable PR"** (plan #8 + #11, merged). A real
   PR needs a real disposable repo, base branch, required-check names, and a cleanup
   policy — none defaultable, and S4 cannot claim success without them. If declined,
   redefine the S4 terminal as a local PR-candidate receipt (branch + head SHA + no remote
   PR) and change the acceptance criterion to match.
2. **Two authenticated providers, and the profile names for all nine target stages**
   (plan #9, narrowed). Not a preference: with one authenticated provider the
   cross-provider stage cannot dispatch and the target workflow is unprovable.
3. **Ratify the inverted extraction boundary (B1).** The plan reads "do not build a second
   engine" as "migrate research onto the new engine"; this review reads it as "share the
   dispatch seam, forbid duplicated lifecycle code in recipe code." This materially changes
   S2's size and risk, and it is AJ's epic language, so AJ decides.

---

## Verdict

**ACCEPT WITH REQUIRED REPAIRS.**

The schema design, migration strategy, verdict contract, fan-out model, journey table,
and coverage matrix are sound and survive intact — this is not a replan from zero. But
three blockers must be repaired *before* any implementation dispatch: the extraction
boundary is inverted (B1, needs AJ ratification), the durability probe is sequenced after
the slices that depend on it (B2), and the completion boundary the plan claims to copy
does not exist (B3). H1–H6 are precise, evidence-backed, and individually small. Y1–Y5
should be cut on the way in rather than removed later.
