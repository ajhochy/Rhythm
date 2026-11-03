---
date: 2026-10-08
repo: Rhythm
status: proposed-not-implemented
supersedes: 2026-10-08-coordinator-simplification-and-poc.md
tags: [plan, rhythm, coordinator, repair-first]
---

# Coordinator: repair the existing coding path, then decide what to simplify

## 1. Decision and authorization

Repair the existing persistent Coordinator → Workflow Orchestrator → Coding Agent path. Use one real coding task to decide whether its remaining complexity is justified. Do not require a replacement control layer, a universal attempt model, or a rollout framework before that experiment.

This supersedes the implementation recommendation in [the original October 8 plan](2026-10-08-coordinator-simplification-and-poc.md); that file remains historical and unchanged. The inputs are that plan, [Fable's complete review](/Users/ajhochhalter/Documents/Codex/2026-10-06/task-2/fable-coordinator-review-2026-10-08.md), the independent source review, and AJ's subsequent request for this revision. Neither review is implementation or runtime proof.

**Authorization for this planning session:** read-only investigation and documentation edits. No production/test-code changes, paid model experiments, test execution, service startup/restart, installation, commits, pushes, or integration-task changes. All implementation and experiment commands below describe future work, not actions already performed.

**User outcome:** ask for a small coding change conversationally, authorize its concrete scope, see the actual worker change and test the code, and receive a verified result in the same desktop chat. That conversation remains usable after further messages and a restart. Phone parity follows desktop acceptance. Cross-day continuity remains a product requirement with a later explicit gate.

**Clarification carried forward:** AJ already chose a real coding task and desktop first, followed by the same conversation on phone. The present request explicitly chooses repair-first and asks for reasoned implementation defaults. No repeat interview is needed. Conditional human decisions are listed in section 15.

**Design tension:** retaining recovery/authorization evidence without maintaining duplicate workflow state; proving a useful coding loop without quietly granting broad shell authority; reducing required changes without treating a successful demo as full release qualification.

## 2. Baseline and evidence boundary

| Item | Verified during planning | How it affects implementation |
| --- | --- | --- |
| Shared primary checkout | `/Users/ajhochhalter/Documents/Rhythm`, branch `mega/2026-09-29-consolidation`, HEAD `1870574248c4f48883fd828263615cff6e9e5871`; 34 pre-existing changed/untracked paths at the pre-write snapshot, including unrelated memory source/tests and planning/run documents | Documentation destination only. Never treat its source as the current Coordinator baseline or overwrite its dirty work. |
| Original review reference | `/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007`, HEAD `a2cfd75e6cf3d9fe261e99a56ae1390ca41f970b`; dirty files observed were proof PNGs, including one under `docs/ai/runs/evidence/` | Useful source reference, not automatically the implementation base. Most earlier line references name this snapshot. |
| Integrated repair | `ac056260843a0bfbb99d4c0fef80e052450db81f`, parent `3f5f4e9c69f79dd3941ce9a10092e74c785604ce` | Integrates scoped Dayflow admission and automatic permission reply repairs. Preserve those changes. |
| Companion correction | `8c003765241e25c0b18b15888363fd612d1c6fce`, parent `ac056260`; changes one receiving-session test fixture and two documents, no production code | The reported “underway” correction is now committed. Do not duplicate it. |
| Remote PR | Read-only `gh pr view 1598` reported an open draft to `main`, head `8c003765`, updated `2026-10-08T23:30:56Z` | This is a timestamped observation, not a permanent pin. Re-read the eventual frozen head before implementation. |
| Installed desktop | Earlier October 8 audit identifies a signed candidate associated with `237f54db`; no fresh installed-build or running-process inspection in this planning session | No claim that the installed app contains the later repairs. Use an owned isolated desktop candidate for the experiment. |
| Integration verification | Committed records report scripted real API/engine/scheduler checks for `ac056260`, and 48 focused tests plus typecheck for the companion correction | Historical receipts, not tests rerun here and not actual-model Coordinator proof. The correction record documents prior full-suite/CI failures; exact-final-head CI was not qualified here. |

The integration task `01a11dc0-306c-7372-abbf-0c4e8ec25010` retains its ownership. Planning read Git objects and remote PR metadata, not that task's working files. Do not message, steer, edit, restart, or borrow its sandbox. Depend on its eventual frozen result and receipts.

The three selected production files for Dayflow/automatic permission replies are identical between the reviewed repair candidate and the integrated repair. Core async delegation/completion, the Coordinator repository/contract, and native terminal checks also retain the source findings discussed below. **However, PR #1598 does not include all of PR #1610:** fixed-session-model proposal selection, evidence-first parser improvements, some tool-discovery wording, provider/profile changes, and the real-model harness were deliberately excluded. Do not import that branch wholesale or carry its proposal proof forward as if the compositions matched.

Implementation default: branch from `main` after the necessary integration lands. If AJ wants implementation before that merge, an explicitly authorized stack on the exact frozen PR #1598 head is required by the repository's branch policy. Planning and disposable fixture design can proceed without that decision. No new worktree is required merely to write these documents.

Default experiment host: an isolated Electron candidate because the reviewed Coordinator UI is in `apps/web` and the relevant observations concern Electron. This selects a test host; it does not declare Flutter retired or authorize replacing the installed application. Preflight must demonstrate the actual host's isolated API connection and genuine human approval path.

## 3. Diagnosis and scope

| Finding | Evidence and correction to earlier reasoning | Planned response |
| --- | --- | --- |
| Plan-mode inheritance blocks worker shell tests | `server.ts` requires the root to be `plan`; `agent_delegation_service.ts` inherits that mode; `opencode_client_service.ts` denies bash. A profile switch alone cannot override those checks. | Add a fixed, approved coding-child exception at the existing delegation boundary. Root and manager keep plan mode. |
| Reservation already exists | `reserveGoalDelegationAuthorized` reserves and consumes approval atomically. | Preserve it. Repair SDK correlation and normalize the journal; do not replace admission with a second attempt service. |
| SDK creation precedes durable child/outbox linkage | The current sequence is SDK create → local child → async row. The non-null async child ID is a local ID, so Fable's claim that the schema inherently prevents earlier reservation was incorrect. | Commit allocation intent before SDK creation; persist exact returned bindings before any prompt. Hold genuinely unknown allocation outcomes. |
| Async idle is treated as completion | `onChildIdle` currently takes latest output and marks completed. Native reconciliation has materially stronger checks. | Reuse the checks and supply their missing identity/lifecycle inputs in the existing completion service. An event is a trigger, never sufficient evidence. |
| Recovery only starts from `waking` rows | `listWakingParentIds` excludes both `dispatched` and completed-but-unclaimed work. | Extend the existing bounded recovery entry point, including completed-but-undelivered results. |
| Journal capacity conflicts with a permanent conversation | `MAX_COORDINATOR_CONVERSATION_COMMANDS` is 100; the blob retains normal-message and dispatch records needed by callbacks. | Move existing command records to rows with a unique key; preserve historical evidence and eliminate the lifetime input cap. |
| Hash verification is not test verification | `verifyLocalArtifact` compares bytes to an expected hash; existing production criteria resolution is primarily memory/native-job oriented. | Add one coding receipt variant backed by a trusted local evaluator. Reuse receipt conventions, not the selected-note recipe. |
| Optional context and retained-history checks are entangled | Some optional reads degrade, but full mandatory-source qualification and manifest equality can still veto unrelated work. Lack of a goal citation does not prove lack of prior exposure. | Apply operation-specific prerequisites while retaining actual-exposure revocation checks. Preserve the integrated zero-history fix. |
| Some rollout assumptions are unproven | Fable's reported one-database fixture population is not a deployment census. Existing budget holds also exist despite its “nothing enforces” claim. | Inventory only affected records; retain useful budget controls; no speculative fleet machinery or destructive fixture cleanup. |

**Preserve:** ordinary chat/session storage, current work/goal identity, signed human approvals, manager/profile/depth restrictions, async delivery claims and dedupe, native task behavior outside this slice, engine-error truthfulness, current permission-directory/acknowledgement repairs, source-access checks, cancellation, and local-only execution.

**Do not build:** a new engine, scheduler, broker, event bus, generic workflow/grant/evaluator framework, a second grant ledger, universal async/native lifecycle, permanent direct-worker lane, generic rollout service, or new dashboard. Do not fix the unrelated memory router or integration CI failures under this plan.

## 4. One owner for each fact

| Fact | Owner | Boundary |
| --- | --- | --- |
| Root conversation and user transcript | Existing `agent_sessions` / `agent_session_messages` | Keep stable local root identity and existing phone binding. Do not use a root-wide outcome as a per-task result. |
| Objective and user control | Existing Coordinator goal and, where already linked, `agent_workstreams` | Keep pause/cancel and verified outcome; derive runtime display from associated execution records. Do not introduce another goal ledger. |
| Approved authority | Existing `agent_approvals.bound_payload_json`, decision and digest | Immutable terms; existing signed human decision and CAS consumption. Never reinterpret a summary approval as a coding grant. |
| Admission and exact correlation | Normalized existing Coordinator command journal | Which approved operation reserved which manager/worker and exact prompt. No duplicate running/completed/delivered state machine. |
| Async execution observation and delivery | Existing `agent_async_delegations` | Preserve ordinary async semantics. Add bounded terminal/result evidence for the admitted coding path only. |
| Local ↔ engine session mapping | Existing durable `agent_sessions.sdk_session_id` | In-memory map is a cache, never the restart authority. |
| Verification | Versioned coding receipt attached to the admitted top-level result | Exact immutable artifact, evaluator and actual check outcomes. Does not authorize work. |
| Result visible in chat | Canonical server-authored transcript entry with unique result key | Durable availability plus desktop render/reopen prove the result returned. Transport acknowledgement is a separate fact. |

Legacy native bridge jobs retain their current authority. A newly admitted ordinary async coding operation must not create a bridge-job copy merely to use its verifier or result UI. Reuse native validation code where possible without pretending its job-specific context already exists on an async row.

## 5. Narrow coding execution grant

### 5.1 Fixed payload and approval

Generalize the current digest-bound bounded-proposal/card mechanism with one fixed payload kind, `coordinator_coding_execution_v1`. Proposed fields below are a contract, not an implemented schema:

| Group | Required terms |
| --- | --- |
| Identity | owner user, project, root local/SDK identity, goal ID and relevant goal revision, objective |
| Workspace | server-owned workspace ID and generation, canonical root, starting artifact digest/base revision, explicit readable/writable relative paths |
| Chain | fixed manager and coding-worker profile IDs, relevant policy fingerprints, configured model/provider identities, allowed delegation edge |
| Effects | allowed edit/write paths; server-resolved command IDs and cwd; no commit/push/deploy/package installation; no further workers or unrelated MCP effects |
| Limits | one manager attempt, one worker attempt, one concurrent worker, zero automatic retries, at most one manager completion wake, no root completion-model wake |
| Time and usage | absolute grant expiry set to proposal time plus 15 minutes and displayed before signing; 600-second task wall window, worker maximum 300 seconds within that window; proposed aggregate soft allowance 30,000 normalized input/output tokens across subsequent manager, worker and the one manager callback |
| Acceptance | evaluator ID/version/hash, explicit functional criteria, immutable artifact capture method |
| Binding | signed payload version/digest, proposal time and absolute expiry; human decision ID and authenticated decision timestamp are attached decision evidence, not pre-existing proposal fields; cancellation/revocation checked against current control state |

The limits are planning defaults, **not current spend authorization**. Preflight displays them and the actual models before the human approves. If their context sizes make the allowance infeasible, revise the card explicitly; never silently expand it. Proposal generation and ordinary root conversation already run under foreground authority: report that usage separately, never retroactively charge it to a later grant. Normalize execution usage with provider-reported cache/reasoning components included exactly once, retain raw evidence, and label the allowance soft unless actual native enforcement is proven. Unknown or exhausted execution usage prevents further grant-funded inference but not authorized deterministic result delivery.

Persist `taskStartedAt` immediately before the manager's first prompt attempt; its deadline is the earlier of `taskStartedAt + 600 seconds` and signed grant expiry. Persist the worker start before its first prompt; its deadline is the earliest of worker start plus 300 seconds, task deadline and grant expiry. Unknown transport does not restart any clock. Approval near expiry does not extend signed terms: propose fresh terms if more time is needed.

Server derives all authority-bearing fields. The model may propose an objective and explanation, but cannot supply arbitrary filesystem roots, permission rules, caller IDs, callback destinations, signatures, or trusted evaluator results. Bind approval to relevant goal/workspace/profile terms, not to every change in conversation-wide `controlRevision`. An unrelated message or second goal does not revoke unchanged authority.

The existing human card/signing path must show the permitted work, commands, limits and exclusions intelligibly. Atomically consume its initial approval and reserve the manager operation. Replays return the same operation. Manager-to-worker admission consumes the one worker slot under that already-approved chain, not a second fabricated human decision. A changed objective, wider files/effects, replacement workspace generation, changed relevant profile/model policy, expiry, or cancellation requires hold and, where work is still desired, newly approved terms.

### 5.2 Root, manager and worker permissions

1. **Root stays in plan mode.** It receives no new edit/bash capability. Typed capture/propose/start/status/cancel tools carry the work intent through existing routes. Add a missing typed capture operation rather than accumulating more natural-language verbs. This does not require replacing the entire conversation transport.
2. **Manager stays in plan mode.** It may inspect the fixture within scope and request exactly the approved Coding Agent. Preserve current manager eligibility, enabled/unlocked profiles, `allowedDelegatesJson`, ownership and depth checks. Bind its local/SDK identities to the approved operation before its first prompt.
3. **Worker alone uses `default` with explicit scoped rules; never `bypassPermissions`.** This is a server-only exception resolved from the authenticated calling manager and durable operation binding. An approval ID passed in model arguments is not sufficient. Ordinary delegation retains existing mode inheritance.
4. **All escape routes must honor the same slot and scope.** The worker cannot create descendants. For the fixture, the manager cannot use an alternative delegation tool, native task, shell-spawned agent or unrelated MCP tool to evade the one-worker restriction. Hardline command/tool denies remain ahead of grant approval. Unknown commands are held, not broadened automatically.

POC transport default is the supported named-profile async delegation edge (`rhythm_delegate_async`) from the async Workflow Orchestrator manager to its worker. Source explicitly supports that manager capability, but this planning session did not inspect the currently installed manager's effective instruction/profile. R0 must record the real profile and transport. If the actual agreed workflow requires a native `task` worker, resolve that bounded difference before implementation: use its existing authenticated task-admission boundary and exact child membership, or explicitly record that the fixture exercises the supported async-manager lane. Never claim unchanged native-chain proof from an async fixture. Do not implement both transports speculatively.

The existing `FiniteExecutionPermissionRules` validator deliberately denies all bash and rejects interactive workers. Preserve that selected-note contract. Reuse its server-derived scope pattern, but add a distinctly named coding-grant validation branch at the existing client/delegation boundary. Do not weaken the finite validator globally. The existing `CodingWorkflowDispatchInput` is identity/correlation-only; it must not silently become permission authority for ordinary callers.

### 5.3 Enforcement and revocation

Intersect approved terms with current profile policy; an approval cannot override a newly locked profile or hardline deny. Check owner/project access, exact root/manager/worker binding, workspace generation/realpath, policy fingerprints, expiry, cancellation and capacity after awaited allocation/subscription and immediately before prompt/provider exposure. Every protected file/tool/command operation must reach a grant-aware permission decision: use engine `ask` for permitted candidate operations, deny outside-scope operations, and resolve the ask server-side only after the current grant check. Do not install unconditional engine `allow` rules or persistent “always allow” decisions that bypass expiry/revocation. Reuse one-operation acknowledgements; preflight must prove any engine/session permission cache cannot retain an expired grant. If that hook is missing, it is a specific R2 enforcement gap, not a permission to claim per-operation revocation from prompt checks alone. Preserve the integrated engine permission routing and acknowledgement behavior; parentage alone does not grant automatic approval.

Expiry or revoked execution authority blocks new prompts, worker admissions, manager callbacks and tool approvals, and requests cancellation of already-running owned work. Do not claim an already-started command was prevented or stopped until observed. Pause blocks new admissions/continuations; cancellation additionally aborts the proven owned tree. The root's ordinary conversational authority remains separate.

**Isolation limit:** a matching shell command can execute repository code. Engine path/command rules are not proof of OS filesystem/network confinement. The fixture uses disposable synthetic data and a trusted launcher; no production paths or credentials enter its writable workspace. Record exactly which path/tool restrictions are enforced. “No network/out-of-tree effects” is an intended exclusion, not a certified guarantee unless an existing process-isolation boundary is demonstrated. Do not build a general container platform for this proof. If strict OS confinement is required for approval, stop paid preflight until a bounded existing launcher can enforce it; never hide that gap behind a prompt.

## 6. Repair the command journal without losing history

Add one table for the existing journal, provisionally `coordinator_conversation_commands`, unique on `(root_session_id, command_key)`. Reuse repository transaction helpers. This normalizes existing evidence; it is not a new attempt engine.

Minimum common fields: root/owner/project binding, command key/kind, intent hash, creation/update time, and the existing replay result needed by each command. Delegation entries additionally reference the goal/relevant revision, approval/digest, role (`manager` or `worker`), parent operation, attempt ordinal, server-selected target/policy, allocation intent, local/SDK child IDs, async delegation ID, exact dispatch/user-message IDs, engine identity, canonical cwd, acceptance (`pending`, `accepted`, `rejected`, `unknown`) and bounded hold reason. Store existing dispatch authority once or by immutable reference, not as mutable copies everywhere.

The initial manager turn and its possible one completion callback have distinct immutable prompt anchors. Keep the initial anchor; reference the callback's separate provenance through existing `agent_turn_dispatches` rather than overwriting the initial user-message ID. Durably reserve the one callback slot before exposure; unknown acceptance retains that slot. This is a bounded association with existing dispatch records, not another turn ledger.

Manager and worker slot reservation must be serialized in the same database transaction as the relevant authorization/capacity check. Unique keys prevent duplicate reservations; an unknown attempt retains its slot. One accepted manager/worker is the first-proof limit, so no generic retry-capacity engine is needed. Any future retry must be separately designed under approved remaining capacity.

Import existing blob entries idempotently per root, validate duplicate hashes/bindings, and compare counts and dispatch references before switching that root's writer. Use a storage migration marker only where needed to choose the single reader/writer. After switching, do not dual-write the blob. Preserve it as inert compatibility evidence until safe removal; contradictory entries put the root on a visible hold. Do not trim dispatch or approval receipts to make the cap disappear.

Normal message retries still need durable idempotency. Reuse canonical message/request identities where already sufficient; otherwise preserve their normalized journal rows. Status reads should not consume a lifetime command allowance. Remove the 100-entry parser/admission limit for migrated roots, retain bounded page sizes/output, and query old callback evidence by indexed key rather than scanning the latest page.

The scoped coding reservation can initially be proven against the current journal within its limit. If normalization becomes larger than the grant/correlation patch, do not hold the first controlled functional experiment hostage to it. However, long-lived-chat acceptance cannot pass until the real normalized path and more-than-100-command check pass. Avoid implementing two permanent reservation APIs to support this sequencing option.

## 7. Allocation, dispatch and recovery contract

Keep `agent_async_delegations`' existing child constraints and runtime statuses. Pre-child reservation belongs in the Coordinator journal. Reuse `onPrepared`, `validate`, `isCurrent` and `onOutcome` concepts from the current dispatch seam without requiring a selected-note bridge job.

| Boundary | Durable action before/after the external step | Recovery rule |
| --- | --- | --- |
| Start/approval | Transaction consumes required approval and reserves the unique operation/slot | Replaying the same key returns it; no second approval consumption. Proven not-yet-started work may continue only while authority is current. |
| Before SDK allocation | Persist allocation intent and proposed policy/workspace association before calling create | A reservation with no allocation intent may continue. Once intent exists, absence of an SDK ID is not proof the create did not happen. |
| SDK allocation response | In one local transaction, persist exact returned SDK/local child mapping, async row and operation association | Returned IDs may be linked only through the exact in-process reservation. No model prompt before this succeeds. |
| Crash/timeout before durable allocation binding | Leave operation/slot unknown | Current create API has no proven caller-selected durable allocation key. Do not adopt by title/latest child/time proximity or create another child. Reconcile only with authoritative identity; otherwise show a hold for bounded human resolution. |
| Before prompt | Persist dispatch ID, exact SDK user-message anchor, child identity and required engine/lifecycle binding; revalidate final authority | No provider exposure if persistence or revalidation fails. Existing async `dispatched` naming does not prove accepted execution; acceptance evidence is explicit. |
| Prompt acknowledgement | Record accepted, definitely rejected, or unknown outcome | Reconcile unknown by exact dispatch/message identity. No timeout retry with a new prompt/child. For this POC, a definitely rejected prompt ends that execution attempt; no automatic reissue. A new coding attempt requires newly approved terms. Recovery may finish preparation proven never to have issued a prompt, using its existing reservation/anchor, without reallocating an uncertain child. |
| Terminal observation | Persist qualified terminal/error/usage evidence on the async record | Events and recovery use the same qualification function. No last-prose/idle shortcut. |
| Verification/result | Persist trusted result and delivery eligibility atomically | Recovery resumes the deterministic evaluator/result step, never the coding task. Already captured artifact/evaluator identities must match. |
| Root transcript commit | Atomically insert/upsert the unique canonical result and record its message identity | Crash after commit but before notification finds the existing entry. Replay may refresh that entry, not append another or buy another model turn. |

Do not promise exactly-once SDK creation. The attainable contract is durable at-most-one admitted operation, no blind replay after uncertainty, exact correlation where supported, and positive recovery for known accepted work. A system that holds every restart indefinitely does not pass.

Extend the **existing** bounded startup/maintenance recovery entry point with cursor pagination. Inspect unresolved Coordinator allocation/dispatch evidence, linked dispatched rows, completed rows awaiting verification/delivery, and existing waking claims. No new timer or broker. Do not globally fail, rerun or cancel historical dispatched rows merely because they are old. For rows lacking sufficient identity, surface a scoped hold and retain existing compatible readers.

## 8. Completion, cancellation and same-chat delivery

### Terminal qualification

Repair `AsyncDelegationCompletionService.onChildIdle` for admitted coding operations. Share pure selection/validation logic with native reconciliation where useful; leave native job-specific authorization and accounting intact. The async caller must provide trustworthy inputs: exact accepted user-message anchor, matching assistant steps, completed timestamps, terminal finish/error, current engine/lifecycle information, no unresolved permission/question, and complete relevant message pagination. Idle without a matching completed turn remains pending.

The top-level manager returning prose is not sufficient if its reserved worker is active, unknown, or failed. Its declared child membership comes from server admission records, not model text. Qualify the worker first; allow at most the one authorized worker→manager completion wake. A manager result may be terminal while verification remains failed/unverified. Report those separately. Account for the manager's continuation and all admitted worker usage; preserve unknown totals instead of inventing zero.

Top-level execution can close only when its worker is closed and no admitted manager turn remains outstanding. Do not mistake the initial “I delegated it” turn for final manager synthesis. If budget/expiry prevents admitting the callback, record it as not admitted and return qualified worker/evaluator evidence through the deterministic root result, explicitly stating that synthesis was skipped. A callback whose acceptance is unknown must remain unresolved, not be relabelled not admitted.

An engine boot change is a revalidation trigger, not automatic success or permanent failure. Use supported durable session/turn/lifecycle evidence to re-establish the exact binding; where that is unavailable hold. The first paid restart case restarts only the owned API with the engine preserved, if the launcher supports that operation. Engine restart qualification is a separate later gate.

### Result transport

Use one server-authored result in the canonical root transcript for the top-level operation. Proposed minimal async additions are nullable terminal/result receipt JSON, a result message ID, and a fixed delivery discriminator for this Coordinator result mode. Ordinary/nested async rows continue their immediate-parent callback behavior. Do not mark worker→manager delivery as delivery to AJ.

The result contains task/attempt identity, changed-file links, captured artifact digest, evaluator/check results, execution and verification outcomes, known/unknown usage and limitations. It must be useful without root-model synthesis. Extend the existing transcript representation only as needed for a `work_result`; do not impersonate an SDK assistant message or invent an engine message ID.

Reuse existing serialization/claiming. Give the local transcript event a unique key derived from the admitted top-level operation; use an existing equivalent identity if available, otherwise a nullable indexed local-event key. Persist transcript+result association in the same local transaction and reuse relay publication. Current read authorization controls content visibility. Revoked access may withhold protected content; it does not authorize a different recipient or lost-data workaround.

Exclude deterministic root results from ordinary billable callback batches. Unrelated completions may still coalesce under their existing rules, but cannot acquire this operation's approval or privileged overlay. Busy/offline root: preserve pending delivery and make the durable entry available after the foreground turn/reconnect through existing UI serialization. No extra result on reopen. Model synthesis is deferred in the POC; it must not be needed to report success/failure.

### Cancellation

Persist cancellation before requesting abort, using the current status service. Stop new worker admissions, prompts, tool approvals and callback inference. Abort only the proven owned manager/worker tree; an unknown allocation is not permission to kill all sessions. Preserve requested/stopping/stopped-or-unknown facts. Late terminal events may update usage, artifact evidence and the one cancellation result, but cannot reopen the goal, consume another slot, or start a replacement. Do not change a cancellation control outcome to `notified` just to record transcript delivery.

The deterministic writer needs an eligibility query based on its fixed delivery mode, available result receipt and missing `result_message_id`, including cancelled/failed outcomes; it cannot rely only on the legacy `status='completed'` claim. Reuse parent serialization and the unique transcript-key transaction to write and link that result while preserving cancellation status. Late observations update the same result entry. Ordinary callback claims/status transitions remain unchanged.

## 9. Trusted coding verification

Reuse existing receipt conventions with one coding-specific result variant. Only a server-owned evaluator integration or authenticated human review can attach accepted evidence. A worker tool argument, prose, edited test file, arbitrary shell exit code, or bare artifact hash cannot confer verified success.

Receipt content: root/goal/operation and delegation IDs; workspace ID/generation and base identity; immutable captured-artifact digest; evaluator ID/version and exact evaluator/runner hash; server-selected command/cwd and runtime version; exit status and individual check outcomes; timestamps; verdict (`passed`, `failed`, `unverified`, `stale`); current-artifact comparison; bounded output or private evidence reference. Verification authority cannot sign approvals or start work.

After the owned writer stops, the trusted harness captures all allowed source and test bytes, including tracked modifications and untracked files. A Git HEAD/tree alone is insufficient unless a trusted snapshot explicitly includes those bytes. Reject escaping symlinks; use deterministic relative-path/content/mode hashing; exclude only declared non-input artifacts. Check for concurrent mutation during capture and evaluation. Run the protected evaluator on the immutable copy, not a moving worktree. The evaluator and runner are outside both descendants' writable scope, and their hashes are rechecked.

On success, the result says which captured artifact passed. Recompare relevant current bytes before labelling the current workspace verified; later changes make current verification stale, while preserving the historical passed snapshot. Update the same logical result where appropriate. If evaluator execution is unavailable, return a useful unverified result with the reason. Do not rerun the coding agent to hide a verification infrastructure error.

A child running its own tests is still required to exercise the execution grant. Those tests are helpful evidence, not the independent acceptance authority. Running repository code also invokes the isolation limitation in section 5.3.

## 10. Context/privacy contract and negative cases

Use the integrated Dayflow zero-history and permission fixes as prerequisites. Do not reproduce their patches in this lane. Inspect the eventual frozen source before changing any overlapping admission function.

For the coding operation, required inputs are current identity/access, approved work scope, workspace, relevant policies, operation state and acceptance criteria. Unrelated calendar/Dayflow/dashboard completeness is not a prerequisite. Scope and bound each optional read independently; expose unavailable/partial/stale states without treating them as authoritative empty data. Optional context failure must not block a fresh unrelated fixture task.

Distinguish **not currently needed** from **previously exposed**. Retained SDK history, tool exposure and provider-overlay exposure remain subject to their current authorization/revocation rules. A goal without a Dayflow citation does not erase those dependencies. If old content is no longer authorized, rebuild safe context using a supported history path or hold the dependent turn; do not pass stale hidden history just because the new task is unrelated. Root and each descendant require their own binding checks. Never clone a root's private history wholesale into a fresh coding child.

Required focused negatives, mostly deterministic before the paid run:

| Trigger | Observable required outcome |
| --- | --- |
| Foreign owner/project, substituted root/manager/SDK identity or ambiguous duplicate binding | No protected prompt, tool execution, result content or adopted session; non-disclosing error/hold. |
| Changed objective/files/commands/evaluator or replayed/expired approval | No new execution under old terms; same-key replay returns existing state, altered-key intent conflicts. |
| Profile revoked/locked, workspace replaced or cancellation during an awaited allocation/subscription | Final admission blocks exposure; any existing child is accounted for and safely held/stopped. |
| A second goal or unrelated status message | First goal's unchanged approval remains usable; no cross-goal result, slot or usage association. |
| Extra worker request, native-task escape or further worker delegation | Denied before extra execution; root/manager retain plan restrictions. |
| Fresh no-exposure sessions with missing Dayflow/calendar or oversized optional dashboard | Coding proposal/admission proceeds with explicit availability limits. |
| Previously exposed revoked content, including uncited retained/tool content | Content is withheld/safely rebuilt or the affected turn held before provider exposure. |
| Malformed exposure marker, unknown receiving identity, relevant changes after an await | Fail closed according to the existing receiving-history rules; the proven zero-history case remains allowed. |
| Premature idle, incomplete/wrong assistant turn, engine identity uncertainty | No completed/verified result. |
| Modified evaluator, failed checks, stale artifact, or forged model “passed” field | No verified-success label; truthful failed/unverified/stale result. |
| Cancel/expiry/timeout/unknown usage followed by late events | No unauthorized continuation or extra worker; one accurate result and retained accounting. |

These are tests of observable boundaries, not requests for a new security framework. Do not remove established negative tests to make the first fixture pass.

## 11. Ordered implementation units

These are local issue-ready units, not remote issues or authorization to implement. Parent owns integration and reviews every diff. Use sequential ownership for `server.ts`, delegation, stream bridge and shared approval/admission files. Parallel work is limited to disjoint fixture/evaluator or document/test preparation.

Source paths in this table are relative to `apps/api_server/src` unless prefixed otherwise. New paths are labelled proposed. Before editing any symbol, perform the repository-required GitNexus impact analysis and disclose HIGH/CRITICAL risk; before a future commit, run its change-scope check.

| Order | Unit / deliverable | Likely components | Acceptance and dependency |
| --- | --- | --- | --- |
| R0 | Freeze source/host/models/manager edge; prepare fixture and write the failing end-to-end contract | Existing integration receipts, `tools/dev/sandbox.sh`, `apps/web` Coordinator host; proposed `__tests__/live_coordinator_coding_repair_poc.test.ts` and protected fixture/evaluator | Exact candidate manifest; model/profile inventory; usable isolated human card; actual manager worker-transport decision. RED failures identify real missing behavior. No paid run on an unknown composition. Depends on frozen integration handoff, not changes in its worktree. |
| R1 | Preserve and normalize reservation/command evidence | `repositories/coordinator_conversations_repository.ts`, `contracts/coordinator_conversation_contract.ts`, migrations and applicable Postgres bootstrap | Atomic approval/reservation unchanged; duplicate/racing keys do not create work; import/replay consistency; callback lookup survives pagination; 120 commands accepted. Can overlap read-only R0 design. No shared async status rebuild. |
| R2 | Typed coding proposal and scoped manager→worker grant | `services/coordinator_conversation_service.ts`, `coordinator_conversation_model_status_service.ts`, `chat_bounded_workflow.ts`, `external_content_security_service.ts`, `server.ts`, `agent_delegation_service.ts`, `opencode_client_service.ts`, grant-aware permission seam in `opencode_stream_bridge.ts`; existing MCP/routes and approval card | One real human decision; root/manager still plan; exact worker can edit/run permitted fixture check; alteration/expiry/revocation/extra-child negatives. Depends on R0 and reservation contract. Add capture only where missing. Preserve integrated permission changes. |
| R3 | Exact allocation/dispatch correlation and safe terminal recovery | Delegation service, session/async repositories, `async_delegation_completion_service.ts`, shared selection logic from `persistent_workstream_coordinator.ts`, current maintenance wiring | Allocation unknown never duplicates; exact prepared message persisted before prompt; premature idle rejected; dispatched/completed/waking recovery; no native-lane regression. Depends on R1 contract and R2 authority. |
| R4 | Trusted evaluator and one deterministic root result | `workstream_artifact_verifier.ts`, completion service, `agent_session_messages_repository.ts`, existing goal/workstream result mapping, canonical web transcript/card; proposed local evaluator adapter only if no suitable seam exists | Immutable artifact includes dirty/untracked bytes; only trusted evidence verifies; protected evaluator unchanged; one canonical result, busy-root/reconnect/restart dedupe, no root-model spend. Depends on R3. Do not route through a fake native bridge job. |
| R5 | Run the bounded real manager-chain experiment and close durability gaps | Proposed live test, fixture/evaluator, current desktop candidate, existing relevant contract suites and run log | Section 12 pass/fail evidence; one actual-model task; economical restart/replay/history checks. The initial functional run may precede journal normalization if capped input is safely avoided, but full limited-POC acceptance requires R1. |
| R6, conditional | Compare direct authorized worker, then choose a narrow simplification | Same dispatcher/grant/evaluator/harness, temporary test-only target selection | Only on section 13 trigger. No permanent second lane or universal architecture. Record keep/repair/simplify/inconclusive decision. |

Minimal operation-specific context adjustments belong to R2/R3 only when R0 reproduces a blocker or a retained-history negative fails. Broader context redesign is deferred. Relevant fixed-model selection/capture deficiencies excluded from the integration are repaired only if observed on this path; do not cherry-pick the excluded candidate wholesale.

Run focused meaningful tests per changed boundary, then the required combined checks once the candidate freezes. Reuse existing fixtures/contract suites, notably async permission/delegation, Coordinator conversation/bounded approvals, Dayflow receiving/history, and completion recovery. Validate real behavior through the sandbox, not mocked “function called” assertions. Two focused repair attempts per repeated failed criterion is the investigation budget before documenting the blocker and architecture decision; it is not permission to weaken acceptance or retry a paid task automatically.

## 12. Concrete fixture and experiment

### Fixture

Disposable TypeScript task-list repository, with dependencies/toolchain prepared before execution and no install/network step in the task. Seed `selectTasks(tasks, status?)` without filtering. Approved change: implement optional `"open" | "done"` filtering; preserve original order and unfiltered results; return `[]` when nothing matches; reject an unsupported runtime status; do not mutate the input list/items. Bind the initial fixture bytes and allowed files (`src/selectTasks.ts` and optional worker-owned tests) in the proposal.

The trusted parent-owned evaluator lives outside descendant-writable paths. It contains independently written cases for both statuses, omitted status, empty input/no match, ordering, unsupported runtime values and input preservation. A fixed server-owned test command runs it against the immutable capture. The worker separately runs the approved local test command through its actual engine permission path. Record both outcomes; evaluator success cannot substitute for proving the worker could execute tests.

Use actual configured models for Coordinator, Workflow Orchestrator and Coding Agent. Freeze IDs/profile fingerprints. No scripted manager or silent substitute model satisfies the real test. Scripts are appropriate only for deterministic transport/fault cases, labelled accordingly. Manager must delegate; root/manager implementing the change themselves fails the chain criterion.

### Procedure

1. R0 freezes candidate source/API/MCP/engine and desktop artifact, fixture/evaluator digests, model inventory, profiles, chosen worker transport and isolated human approval path. First drive deterministic boundary negatives using real repositories/routes and the real sandbox engine where the boundary requires it. No paid experiment until authority/identity/verification essentials are in place.
2. In the actual desktop Coordinator, ask normally: “Please add an optional status filter to this task list, preserve its current behavior when no filter is given, and test it.” The server resolves the approved fixture, proposes exact terms, and a real human approves in that chat. No hidden goal seeding or harness-signed human decision.
3. Observe one admitted manager and one worker through the declared edge, their exact local/SDK/dispatch identities, worker edits and test command. No automatic correction attempts. Observe actual terminal evidence and trusted artifact/evaluator result.
4. For limited-POC qualification, at a harness-controlled boundary after terminal persistence and before root-result delivery, restart only the owned sandbox API using launcher-supported ownership controls, preserving the engine where supported. Release the hold and require recovery to the result. Preflight the restart hook so this can share the one paid coding run. A first functional-only experiment may omit this step and must mark A6 NOT RUN; it does not earn limited-POC acceptance. If the launcher cannot do API-only restart, add a narrow owned restart facility before the durability test; never hand-launch a second API or disturb normal listeners.
5. Replay duplicate terminal/reconnect signals through the supported production consumer. Verify the same stored result, unchanged admitted worker/prompt counts, and no extra callback inference. Reopen the desktop chat and inspect the readable result.
6. Exercise more-than-100 history using deterministic API/fixture operations, not 120 paid model conversations. Ensure the normalized command path actually crosses the old limit, then submit one supported next input and paginate to the old result. Barely inserting message rows would not test the old command cap.
7. Use deterministic sibling fixtures to check premature idle, evaluator failure/staleness, cancellation/expiry, a busy root, mixed unrelated completions and unknown allocation/dispatch. Do not repeat the successful real-model coding run to test each fault.

### Acceptance ledger

| ID | Pass condition | Fail condition / proof boundary |
| --- | --- | --- |
| A1 | Normal desktop request produces one goal and a genuine same-chat scoped approval | Magic-phrase-only capture, hidden seeded goal, approval signed by an agent/harness, or terms not shown. |
| A2 | Actual configured manager delegates one actual configured coding worker; IDs and approved slot correlate | Root/manager does the coding; undeclared transport; extra descendant/prompt admitted; substituted model. |
| A3 | Root/manager remain plan; worker edits permitted fixture and actually runs the allowed test command | Global permission relaxation, unapproved effects, test run only by the harness, or authority widened after a denied command. |
| A4 | Frozen independent evaluator passes exact captured bytes; changed/untracked inputs included; evaluator unchanged | Prose/hash alone, self-edited evaluator, moving artifact, missing check, or failed check labelled verified. |
| A5 | One readable canonical result returns to the original desktop root, persists on reopen, and states checks/files/limits | Wrong chat, missing result, duplicate logical result, UI working forever, transport acceptance presented as visible success. |
| A6 | API-only restart at completed-before-delivery positively recovers A5; duplicate events add zero execution/result/model wakes | Accepted work lost or blindly restarted, two results, or every recoverable state merely held forever. |
| A7 | Premature idle/wrong turn cannot complete; failed/stale verification gives a useful honest result | Idle/prose treated as success, root verification disconnected from worker artifact. Deterministic case, not another paid loop. |
| A8 | Cancellation/expiry/revocation and unknown usage stop additional authority/spend; late events only reconcile | New worker/callback after stop, stopped asserted without observation, cancelled work reopened. Real-engine cancellation can use scripted provider transport. |
| A9 | 120 supported command-path operations plus next input succeed; old callback/result still resolves | `command_limit`, pruning away required evidence, or direct DB seeding bypassing the tested path. |
| A10 | Scoped privacy/identity negatives in section 10 pass, and optional missing context permits the fresh fixture | Revoked history reused, foreign data exposed, or unrelated unavailable source prevents coding. |

**Functional experiment pass:** A1–A5 on the real model/desktop, with essential authorization and false-verification negatives already passing. This establishes the coding loop, not durability or release readiness.

**Limited desktop POC pass:** A1–A10 with their stated real versus deterministic evidence. API-restart, cancellation and history checks must be run, not merely written. Phone, actual overnight operation, engine restart, arbitrary descendants and full release qualification remain separate. A pending required row cannot be averaged into PASS.

Evidence goes in one lean `docs/ai/runs/` record with links to protected evidence: exact source/dirty-tree status and builds, models/profiles, fixture and evaluator digests, approval identity (no secrets), root/goal/operation/local/SDK/message IDs, actual admitted dispatch counts, changed artifact/diff digest, command/check exits, usage/unknowns, restart boundary/owned PIDs, unique result ID, screenshot of visible result and sandbox teardown. Keep private prompts/credentials outside committed evidence.

### Future launch envelope — not executed here

Use only the repository sandbox launcher, with an approved sanitized read-only DB/config outside the sandbox directory. Model/profile fixtures must be prepared without copying live transcripts. Preflight free API/engine/gateway ports and preserve all settings on every lifecycle command. No dependency installation through symlinked `node_modules`.

```bash
export RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-coordinator-repair-fixtures
export RHYTHM_LIVE_DB_PATH="$RHYTHM_APPROVED_FIXTURE_ROOT/rhythm.db"
export RHYTHM_SANDBOX_OPENCODE_CONFIG="$RHYTHM_APPROVED_FIXTURE_ROOT/opencode-config"
export RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-coordinator-repair-sandbox
export RHYTHM_SANDBOX_API_PORT=4798
export RHYTHM_SANDBOX_ENGINE_PORT=4797
export RHYTHM_SANDBOX_GATEWAY_PORT=4799
export RHYTHM_MOBILE_GATEWAY_PORT=4799
export DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow
# Proposed ports must be checked unused; no normal listener may be reclaimed.
# Configure the isolated host's genuine human-approval path before launch.
tools/dev/sandbox.sh up
tools/dev/sandbox.sh status
# Proposed test path; does not exist or pass merely because this plan names it.
# Run from apps/api_server with the same launcher environment:
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:4798 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4797 \
  npx --no-install vitest run src/__tests__/live_coordinator_coding_repair_poc.test.ts --no-file-parallelism
# Run from repository root with the unchanged environment:
tools/dev/sandbox.sh down
```

Build the exact fork/API/MCP/desktop candidate through documented commands/launcher before qualification. The fixture config must include a non-empty safe local-command MCP map. Sandbox credential/signing configuration proves transport only unless a human actually approves through the intended UI; never print keys or let the evaluator sign a human decision. API-only crash injection needs its own launcher-supported hook; the above ordinary `up`/`down` envelope does not claim to provide it.

## 13. Fair comparison and decision thresholds

The first experiment exercises the existing manager chain. Direct-worker execution is a **conditional diagnostic control**, not the default product architecture or a second permanent implementation.

Run the control only after one of these concrete observations: (a) the manager reproducibly fails its delegation/return edge after up to two focused repairs while shared worker execution can be tested safely; (b) the manager run succeeds but trace evidence shows substantial avoidable extra work and AJ wants that cost comparison. Do not run a second paid variant simply to fill out a benchmark.

Control: reset only the disposable fixture to identical bytes; retain worker model/profile, approved effects, evaluator, artifact capture and delivery semantics. Make the grant explicitly authorize a direct root→worker edge through the existing dispatcher. A manager-chain grant cannot be repurposed. The root remains plan; the one worker receives the same narrow scope. Use a test-only/server-controlled selection; remove it after the decision unless direct delegation is separately accepted as a product feature.

| Observation | Decision |
| --- | --- |
| Manager chain passes A1–A10 | Keep the repaired architecture for this supported scope. Broader replacement requires a separate demonstrated problem. |
| Manager-specific edge fails; direct control passes identical worker/evaluator/delivery conditions | Simplify or repair that exact manager edge. Shared chat/approval/journal/delivery replacement is not justified by this result. |
| Both fail at the same authority, worker, artifact or delivery boundary | Shared defect. Fix that boundary; result is inconclusive about orchestration. |
| Direct control passes only after looser policy, different model, changed fixture or bypassed checks | Invalid comparison; no architectural conclusion. |
| Both pass; manager adds no useful behavior for this task | Consider direct execution for this simple task class only. One task does not establish that managers are generally unnecessary. |
| Safe recovery requires duplicate lifecycle writers, uncorrelatable engine side effects or unavoidable scope expansion | Write the exact missing contract and propose a narrowly scoped replacement of that component. If engine support is required, obtain the repository-authorized fork scope; do not improvise another orchestration layer. |

Report observed token/latency differences descriptively. Proposed investigation trigger: manager path exceeds 2× direct-control usage, or exceeds 2× elapsed time with at least 60 extra seconds. These are review triggers, not statistical proof or automatic replacement thresholds. Require trace attribution to manager work and repeat only if variability could change a consequential decision and the additional spend is authorized. Safety/false-success/duplicate-execution failure overrides any speed benefit.

## 14. Compatibility, rollback and deferred work

Before a data migration, inventory the selected test/candidate database and any actually affected installation using aggregate metadata: Coordinator roots, command counts, active/unknown operations, approval kinds/expiry, async statuses, native jobs, callback bindings and retained-history formats. No private transcript dump is required. Do not generalize Fable's reported fixture counts to all users; do not cancel/delete those rows as an unapproved planning shortcut.

Prefer additive journal/receipt/message-key changes. If shared tables/bootstrap are touched, test both SQLite migration and applicable Postgres schema creation/backfill while keeping local agent execution inert on hosted Postgres. Do not incidentally repair unrelated async status-schema drift unless this change depends on it. Backfill/import must be idempotent and reject ambiguous mappings.

No generic versioned admission router is planned. A payload version and a per-root storage migration marker serve specific compatibility needs. The proposed receipt/delivery discriminator prevents ordinary async rows from being reinterpreted. Inventory old readers before switching writers. Preserve old approval semantics and transcript identities.

Rollback default for a disposable POC is restore its saved fixture database and rebuild the previous candidate after the owned run ends. For retained user state, pause new coding admissions, keep a compatible reader/delivery path for already accepted work, and reconcile/hold those exact records before running an older binary. Never roll back by erasing unknown operations or restoring a stale database over completed user work. If the inventory shows no affected retained records, a broader drain implementation is unnecessary. If it shows active records, write the smallest explicit handling list for them.

Deferred: automatic retries/corrections, arbitrary parallel goals and descendants, generalized aggregate-budget optimization, root model synthesis, scheduling/admission redesign, comprehensive optional-context refactoring, actual overnight continuity, engine-restart continuity, phone parity/physical-device reconnect, broad legacy deletion, and release/install. Preserve their requirements as future gates; the limited POC does not qualify them.

After desktop acceptance, prove actual next-day reopening and then the same root/result on a paired physical phone. No duplicate chat or task is acceptable. Inspect callers and real record ownership before deleting any superseded helper. Measure removed writers/branches and explain retained ones; do not invent a line-count target or delete native safeguards to make a simplification score look good.

## 15. Decisions, risks and completion of this document

| Item | Default / owner / timing |
| --- | --- |
| Planning direction | Repair current manager chain; accepted user direction. No additional decision needed to finish this document. |
| Implementation base before PR #1598 merges | Default wait for prerequisite merge, then branch from `main`. AJ decides only if an earlier explicit stack is desired. |
| Effective manager worker transport | R0 reads actual configured profile/instructions and records it. Async named-profile lane is the planning default; native-only requirements need a bounded admission design before claiming full current-chain proof. No live profile changed here. |
| Desktop host | Isolated Electron candidate default, subject to working genuine approval UI and exact build evidence; no installation swap. |
| Fixture limits/model availability | Defaults in section 5; human approves actual card later. Missing configured model is a preflight blocker, not permission for silent substitution. |
| OS confinement | Do not claim it from engine rules. AJ decides only if strict OS isolation is required beyond the disposable permission-scoped POC; that choice gates paid execution, not planning. |
| Conditional direct comparison | Run only on section 13 triggers and within authorized experiment spend; its grant explicitly names the changed edge. |
| SDK allocation uncertainty | Accepted safe limitation: some crashes hold because the current API lacks proven durable allocation correlation. Do not promise recovery that the engine cannot establish. |
| Integrated model/capture differences | Reproduce on frozen head; add minimal missing behavior only if needed. No wholesale PR #1610 import. |

Document acceptance: saved independently; original plan and unrelated dirty files preserved; current-plan pointer updated only if its observed contents are unchanged; source references and local links checked; every unit names likely files/dependencies/observable validation; experiment status remains NOT RUN. The new run/decision records document planning only. Do not replace the shared dirty `project-state.md` or claim runtime success from this document.

## Source map and prior art

All `a2cfd75e` references below name the independently inspected repair snapshot. Re-resolve symbols/lines on the eventual frozen integration head. Existing mechanisms are the primary prior art; no new external framework is proposed.

- [Atomic reservation/approval and capped journal](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/repositories/coordinator_conversations_repository.ts:1353): `reserveGoalDelegation`, `reserveGoalDelegationAuthorized`; journal consumers include `CoordinatorConversationService.prepareCallbackContext`.
- [Current manager target/root restrictions](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/server.ts:526); [delegation identity hooks and inheritance](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/services/agent_delegation_service.ts:23).
- [Plan and finite execution rule restrictions](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/services/opencode_client_service.ts:2421); `services/coordinator_finite_execution_scope.ts` for server-derived workspace rules.
- [Async idle handling and delivery](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/services/async_delegation_completion_service.ts:215); [waking-only scan](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/repositories/agent_async_delegations_repository.ts:239).
- [Native terminal evidence](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/services/persistent_workstream_coordinator.ts:2988); native admission budget checks around `admissionPolicy`, and descendant/callback usage near `reconcileJob`.
- [Current artifact verifier](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/services/workstream_artifact_verifier.ts:228); native criteria application is not a general coding-check authority.
- [Context qualification](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/services/coordinator_conversation_context.ts:728); [retained history guard](/Users/ajhochhalter/Documents/Rhythm-pr-worktrees/coordinator-conversation-20261007/apps/api_server/src/services/dayflow_receiving_history_guard.ts:93).
- [Integrated selection and recorded transport proof](https://github.com/ajhochy/Rhythm/blob/ac056260843a0bfbb99d4c0fef80e052450db81f/docs/ai/runs/2026-10-08-scoped-dayflow-approval-mega-integration.md), [companion fixture correction and limits](https://github.com/ajhochy/Rhythm/blob/8c003765241e25c0b18b15888363fd612d1c6fce/docs/ai/runs/2026-10-08-dayflow-fixture-integration-correction.md).
- [Repository testing guide](../testing-guide.md), [earlier observational audit](../runs/2026-10-08-memory-router-observational-audit.md), and [original plan](2026-10-08-coordinator-simplification-and-poc.md).
