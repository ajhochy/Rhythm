---
date: 2026-10-07
repo: Rhythm
branch: codex/coordinator-conversation-20261007
pr: null
issues: []
status: proposed
index: "[[Rhythm]]"
tags: [decision, rhythm, coordinator, permissions]
---

# Coordinator permission mode and approval-scope matrix

## Context

Approval scope is a workflow record: task identity, repository/branch, objective,
allowed work/exclusions, authorization evidence, and resolved decisions. It is
not an engine permission mode, a tool permission grant, or an approval-bypass
marker. A resumed task may reuse its own record; a different task or repository
may not.

## Matrix

| Path | Supported engine/tool mode behavior | Approval-scope behavior | Regression evidence |
| --- | --- | --- | --- |
| Native child creation | `default`, `plan`, `acceptEdits`, and `bypassPermissions` inherit through three levels. | Inheritance does not create a human approval or authorize new workflow scope. | `apps/api_server/src/__tests__/coordinator_native_child_permission_mode.test.ts:28` |
| Async child creation | `default`, `plan`, and `acceptEdits` are persisted and forwarded to the actual engine create body; `bypassPermissions` is retained only when selected on the parent. | The child receives the parent task's durable record only when the handoff names that same task; the mode itself does not supply it. | `apps/api_server/src/__tests__/async_delegation_permission_scope.test.ts:93`, `:107` |
| Parent mode changes during async dispatch | Dispatch holds before prompting the child; a post-create stream-race becomes a failed delegation. | A workflow record remains distinct from this operational hold; it cannot be used to ignore a changed permission constraint. | `apps/api_server/src/__tests__/async_delegation_permission_scope.test.ts:116` |
| Existing native child replay/resume | An existing child keeps its explicit human override when its creation event is replayed. | Resume reuses the same task record only; it never transfers approval to unrelated work. | `apps/api_server/src/__tests__/coordinator_native_child_permission_mode.test.ts:45` |
| Explicit bypass ancestry | A child inherits operational bypass mode but its `approval_bypass_explicit` marker remains false. Sensitive external-content authority resolves only through bounded ancestry to an explicit interactive root. | Bypass does not create feature approval, erase exclusions, or waive separate restricted-operation decisions. | `apps/api_server/src/__tests__/coordinator_native_child_permission_mode.test.ts:55`; `apps/api_server/src/contract/issue_1392_bypass_approval_gate.test.ts:240`, `:267`; `apps/api_server/src/services/external_content_security_service.ts:369` |
| Hard security boundary | Hardline commands remain denied even in `bypassPermissions`. | A workflow record never overrides security policy, tool constraints, credentials, destructive actions, deploys, or live hardware gates. | `apps/api_server/src/__tests__/opencode_stream_bridge.test.ts` test `denies a hardline-blocklisted command even under bypassPermissions mode` (line 692): `rm -rf /` is asserted rejected and broadcast as deny. |

The native and async rows document engine-mode regression coverage. They do not
establish that a permission-inheritance defect caused the reported approval
loop; that root cause remains unproven.

## Decision

A HIGH or CRITICAL GitNexus rating requires one consolidated impact, test, and
review report for the already approved feature. It does not require a new
approval for each necessary internal implementation detail, exported class, or
route. Renewed approval is required for material scope expansion, a newly
identified consequential risk outside the record, or a separately restricted
operation.

The attach-only real-model toy scenario in
`tools/dev/approval_scope_real_model_toy.mjs` requires root-captured actual
HIGH/CRITICAL evidence for `TrackingManager`, `trackingSnapshot`, and
`installTrackingRoutes`. O continuation ran the configured Coding Agent in one
existing SDK session through RED-to-GREEN snapshot and route edits without a
per-symbol approval stop, with immutable manager evidence preserved. It also
created a separate, project-bound Coding Agent session for a nested unrelated
fixture: that model refused to reuse the record for payroll, while the original
session refused deployment and neither sentinel changed.

This proves a same-session continuation and a concrete separate-session
wrong-scope refusal under the supplied durable record. It does not prove native
or async child-handoff propagation, automatic non-leakage in arbitrary new
sessions or repositories, or the behavior of the Workflow Orchestrator
candidate; the real model used the Coding Agent skill, not that candidate.
