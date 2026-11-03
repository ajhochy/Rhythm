# Coordinator tracks multiple coding-workflow runs (2026-10-12)

Branch `feature/coordinator-workflow-runs` from `codex/rhythm-deliverables-completion-20261010` @ ff0e8c84. Draft PR only.

## Intent
One Coordinator chat (Secretary profile) takes coding goals in chat, starts ONE run of the existing
`workflow-orchestrator` per goal via async delegation, tracks several concurrently (goal, repo/branch,
status, actual tokens) in the existing Coordinator card, and reports each finished run once in the same chat.

In scope: wiring existing goal → `startCodingWorkflow` → `delegateToAgentAsync` → completion wake; a run
list read model + card section; retiring the bounded coding layer.
Non-goals: new approval system, new verification/evaluator, new branch management, changing the finite
`prepare-plan` decompose/continue/execute admission, mobile/Flutter UI.

## Hard constraints
- Live installed Rhythm 0.18.74 + live DB are off limits; demo only in `tools/dev/sandbox.sh` on 4197/4198/4199.
- Never start servers on 4001/4096; never touch ~/.config/opencode or ~/.local/share/opencode.
- Keep the external-content taint approval on goal start (security, #1134) — it only fires for tainted chats.

## Decisions (AJ, 2026-10-12 alignment)
- Run child permission mode: `bypassPermissions` inside an engine-created git worktree of the named repo;
  #878 hardline/high-risk bash denies stay; skill keeps "never merge".
- Retire `rhythm_propose/start_bounded_coding_workflow`, the `coordinator.workflow.start` card and
  `chat_bounded_workflow` entirely, including `selected_reference_summary_v1`.
- Demo: real model, AJ signs in inside the sandbox.

## Clarification interview
Done via one alignment block (4 questions) plus AJ's explicit DONE MEANS. Prior-art swarm skipped:
pure internal reuse, no new dependency or pattern.

## Acceptance criteria
1. `rhythm_start_coordinator_goal {goalId, repoPath}` on a captured goal dispatches exactly one
   `workflow-orchestrator` child whose cwd is a NEW worktree of `repoPath` (own branch), permission mode
   `bypassPermissions`; a second call for the same goal does not create a second child. `repoPath` that is
   not an absolute git work tree → held, no child.
2. Two goals → two children running at once (no per-parent cap), separate worktrees/branches.
3. `POST /coordinator-conversations/runs {sessionId, projectId}` returns one row per dispatched goal:
   `goalId, objective, delegationId, childSessionId, repoPath, worktreePath, branch (live git HEAD of the
   worktree, fallback stored), status running|needs_you|finished|failed|unknown, reported (wake delivered),
   usage {inputTokens, outputTokens, reasoningTokens, cacheReadTokens, cacheWriteTokens, totalTokens, cost}`
   summed over the child and all its descendant sessions' engine assistant messages. `needs_you` = a
   pending permission or question in the run's session tree.
4. Coordinator card shows the run list; polls while any run is running/needs_you.
5. On finish, the existing exactly-once wake delivers into the Coordinator chat; each run block names its
   branch + worktree; the workflow-orchestrator skill ends with a fixed report (Changed / Branch & PR /
   Verification commands + result / Needs your decision). Survives a sandbox `restart` without a second report.
6. Bounded layer removed: no `coordinator_coding_*` modules, no bounded tools/routes/card/fixture/Docker
   evaluator, no `quickjs-emscripten`; typecheck clean; api_server suite no new failures vs baseline
   (31 failed tests / 38 failed files on ff0e8c84).

## Issues
| # | Title | Likely files | Tests |
|---|---|---|---|
| 1 | Retire bounded coding layer + tools/card | coordinator_coding_*, chat_bounded_workflow, agent_delegation_service, async_delegation_completion_service, opencode_stream_bridge, opencode_client_service, model_status_service, agent_approval_continuation_service, mcp tools, web Transcript/store, tests | tsc api/mcp/web; suite diff |
| 2 | Goal start → worktree run in named repo | mcp coordinatorConversation.ts, model_status_service startGoal, coordinator_conversation_service startCodingWorkflow, server.ts dispatch, agent_delegation_service (cwd, permission mode) | coordinator_workflow_runs.test.ts |
| 3 | Run list read model + route | coordinator_conversation_service, repository listGoalDelegationOutcomes reuse, routes/controller | same test file |
| 4 | Card run list | web gateway/coordinator-conversations.ts, use-coordinator-conversation.ts, CoordinatorConversationCard.tsx | web typecheck + unit |
| 5 | Report shape | config_seeds/skills/workflow-orchestrator/SKILL.md, async_delegation_completion_service buildWakeText, coordinator foreground text, .mcp-roles/secretary.mcp.json | wake text test |
| 6 | Live sandbox demo + docs | docs/ai/runs, project-state | manual evidence |

Dependencies: 1 → 2 → 3 → 4; 5 after 2.

## Data safety
Fixture repos live under /private/tmp; sandbox HOME/XDG isolated; no auth.json copied by the agent.
