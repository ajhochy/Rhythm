---
date: 2026-06-25
tags: [decision, rhythm, agent-delegation]
issues: ["#742"]
---

# Delegation depth raised to 2 (3-level chain: Secretary → orchestrator → specialist)

## Context

Issue #742 identified that the intended delegation chain Secretary → workflow-orchestrator → specialist collapsed to 2 levels because `MAX_DELEGATION_DEPTH = 1` in `agent_delegation_service.ts`.

Depth accounting: the root Secretary call starts at `depth=0` and passes `depth+1` when it calls `delegateToAgent`. So workflow-orchestrator runs at `depth=1`. When it tries to delegate to a specialist (also via `delegateToAgent` with `depth=2`), the old cap of `1` blocked it immediately (`depth >= 1`).

## Decision

Raise `MAX_DELEGATION_DEPTH` to `2`. This enables the 3-level chain:
- Secretary (depth=0, isManager=true) → workflow-orchestrator
- workflow-orchestrator (depth=1, isManager=true) → coding-agent/planning-agent/etc.
- specialists (depth=2) do not delegate further (isManager=false)

The isManager check is required at every level: a profile must have `is_manager=true` to call `delegateToAgent`. Specialists are never isManager, so they cannot delegate even at depth=1. This constraint, combined with the allowedDelegatesJson allowlist, is the true guard against fan-out.

The depth cap is now a secondary hard ceiling that prevents a misconfigured isManager specialist from chaining beyond depth=2, even if someone accidentally sets isManager=true on a leaf agent.

## Alternatives considered

1. **Scope exception for orchestrator only**: add a check like `if (caller.id === 'workflow-orchestrator') allowDepth = 2`. Rejected — fragile, hardcodes a profile id in service logic, breaks if the orchestrator is renamed.

2. **Keep depth=1 and have Secretary directly delegate to specialists**: rejected by the issue as architecturally wrong — the orchestrator/chain pattern is the value; collapsing it defeats the purpose.

3. **Unlimited depth (no cap)**: rejected — infinite loop risk if any two isManager profiles inadvertently have each other in allowedDelegates.

## Consequences

- The 3-level chain now works end-to-end.
- A misconfigured 4th level (isManager specialist trying to delegate) is still blocked at depth=2.
- The test `depth: 1` still rejects (depth 1 < 2) in the existing test "c4: rejects nested calls" — the test was asserting depth=MAX, so the test value must be updated to `depth: 2` to remain a cap-boundary test.
