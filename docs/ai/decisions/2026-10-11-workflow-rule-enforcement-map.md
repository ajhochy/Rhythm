---
tags: [decision, rhythm]
---
# Which workflow rules are enforced vs prompt-only

> Superseded 2026-10-12: the bounded coordinator coding path described here was removed — see
> [2026-10-12-coordinator-runs-over-existing-workflow](2026-10-12-coordinator-runs-over-existing-workflow.md).

## Context
The brief requires separating engine/server-enforced safeguards from prompt instructions. The six rules live as prompt text in config_seeds/skills/{workflow-orchestrator,acceptance-contract,coding-agent,verification-gate}.

## Decision (findings, file:line in apps/api_server/src)
The bounded coordinator coding path is ONE hard-wired fixture: files, test command, the 7 acceptance checks and evaluator id are constants (coordinator_coding_execution_service.ts:24,134-142; contracts/coordinator_coding_execution_contract.ts:4,59-61,111-130); workspace must be under /private/tmp and equal RHYTHM_CODING_WORKSPACE_ROOT (:33-44). Enforcement applies only while a coordinator_coding_execution_v1 grant exists (coordinator_coding_grant_permission.ts:75-80).

| Rule | Class | Enforced | Not enforced |
|---|---|---|---|
| 1 Acceptance before dispatch | bounded-only | server writes the 7 fixed criteria; schema rejects anything else; dispatch rechecks pins | model never authors criteria; nothing checks ordinary chats / rhythm_delegate_async / typed goal adapter |
| 2 Feasibility | general partial + bounded | general: blocked profiles, allowed delegates, model override auth, depth cap 2; engine skill allowlist + permission rules. bounded: model, effort, effort variant must resolve; run model must match proposal; per-op permission authority | task-fit feasibility is prompt-only |
| 3 Bounded execution, honest partial | bounded-only | 600s task / 300s worker / 1 attempt; watchdog revokes, cancels, aborts; receipt always written (cancelled/unverified) | partial handoff is server facts, not a model handoff; general delegations have no wall clock |
| 4 Evidence reuse on identity match | bounded-only | proposal binds workspace/evaluator/profile digests; receipt marked stale if bytes or pins change; passed downgraded to stale before delivery if not current | never reuses prior evidence at all; general chat evidence reuse is prompt-only |
| 5 One implementation owner | bounded-only | one worker slot by CAS; concurrentWorkers:1; workers cannot sub-delegate; edit/bash only for the bound worker on writable paths; manager/root in plan mode; one delegation per goal | ordinary delegation has no writer lock |
| 6 Nearest prior receipt | prompt-only | — (workstream receipts and memory turn receipts exist but are recency-based, not this rule) | no code reads prior coding receipts into a later run |

## Consequences
No rule is a universal engine guarantee. D1 demonstrates the bounded fixture end to end; "an ordinary coding request captures its own criteria" is NOT implemented. Generalizing the bounded path is a separate project.
