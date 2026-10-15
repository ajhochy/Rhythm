# Add chat-only signed finite Coding Workflow admission

## Goal

Allow Secretary to prepare and start the existing bounded Coding Workflow from a primary-root chat. Secretary identifies one captured goal and one current indexed memory-vault reference, estimates task-specific finite limits, explains the estimate, and presents an exact signed human approval card in the same desktop chat. After approval, a durable continuation resumes the exact proposal and starts the existing selected-reference workflow. The existing two server-checked criteria and checked stop remain authoritative.

There is no setup form or separate limits questionnaire. A human may ask in chat to adjust a proposed limit; every changed proposal requires a new exact approval card. Choose limits that Secretary estimates will let this goal complete without unnecessary bloat. Keep the existing parser bounds: total soft tokens 1–2,000,000; worker wall time 30–300 seconds; expiry 30–3,600 seconds; outer turns 1–8, admitting only the turns required by the checked sequence.

## Acceptance Criteria

1. **AC1 — Propose from chat.** From a primary-root Secretary chat, asking to run a captured goal against a named current reference produces a human-readable unique source and task-specific estimated finite terms with rationale, without requiring a setup form or opaque IDs. Missing, ambiguous, stale, or ineligible inputs (uncaptured goal, revoked project, wrong root/profile, non-plan or bypass root) produce a bounded hold and create no approval, finite authority, or child job.
2. **AC2 — Same-chat exact human decision.** The desktop Transcript composes an actionable bounded-workflow approval card only in the matching session. It shows the server-authored goal, source/version, exact finite values and scope; approve and deny use the existing signed `decideApproval` / native `signApprovalDecision` path. Missing native signing material or API decision errors remain visible as a hold and preserve the pending card; untrusted text is rendered as text. A decision queues a durable wake, and the exact approved proposal resumes after idle/restart. Pending, rejected, expired, unsigned, generic, or auto-approved cards create no finite authority and dispatch no job. Chat limit adjustments issue a revised card rather than mutating the pending decision.
3. **AC3 — Consume exact proposal once.** Secretary's dedicated start tool accepts only the exact signed proposal on the approved native wake, after current C2/root/project/profile/goal/source/version checks. An altered field or digest, changed SDK message, stale proof, forged wake, cross-session call, callback, rejection, expiry, or replay creates no extra ordinal. Approval consumption and finite-authority issuance are atomic: failed issuance does not consume approval; unknown dispatch remains held.
4. **AC4 — Preserve checked G2 execution.** Through the real API, built fork, and MCP tool entrypoint in the approved sandbox, a real manager and reviewer finish the selected-reference case. Chat reports `selected_reference_current` and `reviewed_summary_with_citation` as server-checked, exact ordinals 1 and 2, and no third ordinal after 65 seconds of quiescence. Prose-only success, missing citation/reviewer membership, source drift, missing usage accounting, budget/expiry hold, or duplicate callback cannot verify criteria or spawn extra work.
5. **AC5 — Estimate and revise values safely.** Secretary estimates limits from the goal and reference and explains them. The human can request an in-range adjustment in chat. The final card and persisted authority contain precisely the approved values. Out-of-range values hold before approval; each changed proposal receives a fresh exact digest and signature, and an older approval cannot fund revised terms.

## Implementation notes

- Keep this as one atomic feature across the signed MCP tools, coordinator API/service, approval continuation and SQLite agent-approval persistence, Secretary allowlist/prompt, and desktop Transcript.
- Use a dedicated proposal/start path and the fixed `selected_reference_summary_v1` purpose. Resolve actor, project, root, profile, source ID/version, and eligibility on the server. Model prose cannot set acknowledgement flags or grant authority.
- Create a dedicated `coordinator.workflow.start` approval even for clean sessions. Do not use the taint-only external-content approval binding or broaden ordinary `rhythm_start_coordinator_goal` / `delegation.start-async`.
- Persist only the canonical compact proposal needed for digest verification and restart resume. Agent approvals are local SQLite state; verify ownership before schema work and do not add it to hosted Postgres unless a separate need is demonstrated.
- After current rechecks, use the existing G2 `prepareWorkflowPlan` admission and checked execution. Approval decision only queues a wake; a separately verified signed start issues authority before dispatch. Roll back approval consumption with authority issuance on failure.
- The current plan and investigation are `docs/ai/current-plan.md` and `docs/ai/current-investigation.md`. The referenced `docs/ai/issue-template.md` is absent in this checkout; this issue follows the required goal, criteria, likely files, tests, safety, and dependency sections.

## Likely files

- `apps/mcp_server/src/tools/coordinatorConversation.ts`, `apps/mcp_server/src/index.ts` (update the documented tool count), Secretary prompt and tool allowlist.
- `apps/api_server/src/routes/coordinator_agent_tools_routes.ts`; `services/coordinator_conversation_model_status_service.ts`, `coordinator_foreground_mcp_authority.ts`, `coordinator_conversation_service.ts`, `agent_approval_continuation_service.ts`; `repositories/agent_approvals_repository.ts`, `coordinator_conversations_repository.ts`; the local agent-approval SQLite migration.
- `apps/web/src/components/Transcript.tsx` and the existing Shell approval/store/gateway path; keep decision action scoped to the exact current chat session.
- Focused API/MCP contract tests, an env-gated real API/fork/MCP live test, and a composed desktop Transcript Playwright test.

## Tests and evaluation

- Contract: `apps/api_server/src/contract/chat_bounded_workflow.contract.test.ts`, `apps/mcp_server/src/tools/__tests__/chatBoundedWorkflow.contract.test.ts`, and `apps/web/tests/chat-bounded-workflow.spec.ts`. Run the focused Vitest and Playwright commands recorded in `docs/ai/contracts/chat-bounded-workflow.json` before and after implementation.
- Use the real SQLite repositories and existing signed native MCP and human-approval test credential helpers for API contract coverage; assert stored rows, authority, wake, and ordinal outcomes, not calls to implementation functions.
- AC4 live evaluation must enter through the new MCP chat tool against actual API + built fork inside `tools/dev/sandbox.sh` with approved read-only fixtures. Record the exact command/output under `docs/ai/runs/`. The live run, installed desktop chat UI smoke, and any production/release proof remain unqualified until actually performed.

## Out of scope and safety

- Other managed-work purposes; arbitrary target/profile/model/workspace/tool selection; schedules; new grants; approval bypass/auto-approve changes; new setup forms; provider-semantic claims; deployment, merge, or release; and changes to ordinary `rhythm_start_coordinator_goal` behavior.
- Do not use live application data as a fixture, hand-start api_server, or modify the separate integration checkout. Preserve the manager/callback membership, provider usage, exact retry, unknown holds, checked criteria, and quiescent stop. Any destructive schema change requires manual review.

## Dependencies

- Existing G2 bounded workflow admission and baseline API/fork/MCP live proof.
- Existing signed native MCP proof, exact active-call inspection, human decision nonce/signature, approval continuation, and desktop signer/store.
- GitNexus impact review before editing source symbols; `detect_changes()` before a future commit. No GitHub issue was created: this is a direct user request, recorded locally with `issue: null` instead of inventing a GitHub number.
