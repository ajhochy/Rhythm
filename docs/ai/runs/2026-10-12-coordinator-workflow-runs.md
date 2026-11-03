---
date: 2026-10-12
repo: rhythm
branch: feature/coordinator-workflow-runs
pr: draft (see project-state)
issues: []
status: verified-in-sandbox
tags: [run, rhythm]
index: "[[Rhythm]]"
---

## Goal
One Coordinator chat (Secretary) starts one existing workflow-orchestrator run per coding goal, tracks several
at once (goal, branch, status, real tokens) in the Coordinator card, and reports each finished run once in chat.
Plan: [plans/2026-10-12-coordinator-workflow-runs.md](../plans/2026-10-12-coordinator-workflow-runs.md).
Contract: [contracts/coordinator-workflow-runs.json](../contracts/coordinator-workflow-runs.json).

## Files (commits d03bf90e, f8d2a9bb)
- Run start: `coordinator_goal_repo.ts` (repo = the one git work tree the user's goal text names),
  `coordinator_conversation_service.startCodingWorkflow` (repo_required hold), `server.ts` dispatch
  (cwd=repo, isolateWorktree, `childPermissionMode: bypassPermissions`), `agent_delegation_service`
  (worktree base cwd, bypass only with a worktree, `confineToDirectory` for the run and its delegates,
  goal repo path rewritten to the worktree in the run prompt), `opencode_client_service.createSession`
  (`external_directory: deny` session rule).
- Run list: `coordinator_goal_runs.ts`, `POST /coordinator-conversations/runs`, stream bridge
  `listWaitingSessionIds` (needs_you), web gateway/hook (10 s poll) + `CoordinatorConversationCard` list.
- Report: wake block names branch + worktree; seeded `workflow-orchestrator` skill §7 final report.
- Concurrency: settle no longer fenced by the conversation revision; reserve re-reads it; reserving a run no
  longer bumps it. Coordinator snapshot lists `startableGoals`.
- Removed: bounded coding layer (coordinator_coding_*, grants, Docker evaluator, quickjs, selectTasks fixture),
  bounded propose/start tools, `coordinator.workflow.start` card, `chat_bounded_workflow`, finite `workflow`
  purpose + typed Coding Workflow adapter (≈ −14k lines). DB columns left in place.
- Dev only: `sandbox.sh` pairs `RHYTHM_MANAGED_CONTEXT_EXPORTS=1` with workstreams (as Electron does);
  Vite dev CSP allows `VITE_RHYTHM_API_BASE/ENGINE_BASE`; test-token mode names its user via `/auth/me`.

## Checks
- api/mcp/web typecheck + builds exit 0. Full api_server suite: 29 failed vs 31 at baseline ff0e8c84, no new
  failing tests/files. mcp_server 224/224. Contract + coordinator tests 98/98.
- Live sandbox (`tools/dev/sandbox.sh`, 4097/4098, synthetic fixture, AJ signed in to OpenAI inside the
  sandbox home; profiles on gpt-5.5): padder + clamp goals ran concurrently on their own branches, each
  committed, `npm test` 2/2 re-run independently, each reported once with Changed/Branch/Verification/Decision;
  original checkouts unchanged. Full runtime restart: reports 6 = notified 6, run list identical.
  Live test: `RHYTHM_LIVE_E2E=1 … coordinator_workflow_runs_live.test.ts` 1 passed.
- Evidence: [card screenshot](evidence/2026-10-12-coordinator-runs-card.jpg).

## Failures found and fixed during the live demo
1. Sandbox could not run any coordinator turn (missing `RHYTHM_MANAGED_CONTEXT_EXPORTS`).
2. Free OpenCode models answer "Model is unavailable"; `gpt-5.3-codex` refused for ChatGPT-account Codex.
3. Concurrent starts left one run "reserved"/untracked (fixed + `coordinator-workflow-runs-c2` test).
4. A run cd'd into the original checkout and committed on `main` (wordcount fixture) → confinement fix +
   `c1a`/`c1e` tests; re-run proved a run asking for another repo was refused.
5. Coordinator tried to code itself in its read-only chat → explicit instruction + startable goal ids.
Stale engines shadowing the fresh build were renamed `*.stale-20261011` (gitignored, not deleted).

## Follow-ups (not done)
- First coordinator message right after a runtime restart can come back `foreground_uncertain` (engine still
  loading plugins; 2 s prompt-anchor timeout) and the card's Retry only replays it.
- Fork-side schema-2 provider-guard protocol for the retired typed adapter remains in `apps/opencode_fork`.
- One web test (needs `apps/mobile` React) and `sandbox_attached_transport_contract_test.mjs` not run.
- Electron packaged smoke not run.

## Follow-up (same day, AJ feedback): Runs tab, actions, notifications
- The coordination card no longer sits in the transcript (it hid the chat). It is a **Runs** tab in Details
  (shown only in a Rhythm Coordinator chat): coding runs newest first, goals waiting to start, recovery
  buttons only when a message is stuck. "Plan this goal", the planning form and context dump were removed
  from the UI (the finite-plan controller/route remain; no UI entry).
- Card actions: click a run → opens its own session (watch it / answer it); "Needs you — open to answer";
  Stop → inline confirm → `POST /coordinator-conversations/runs/cancel` cancels the delegation (no report),
  aborts the whole run tree and withdraws its pending requests (cards/"!"/banners clear). Status "Stopped".
- Notifications: a background session (run or its specialist) that starts waiting on the user pushes one
  bell notice ("Rhythm needs you") tagged with the session; the renderer skips a second macOS banner for it
  because Electron already raises the clickable per-request banner. Root chats get no bell entry.
- Live (sandbox): Runs tab, open-run, needs-you → question card in the run session, bell notice, UI Stop with
  inline confirm → Stopped, no report, sidebar mark cleared. macOS banner path is Electron-only (unchanged
  code) and was not exercised in the browser. Evidence: evidence/2026-10-12-runs-tab-needs-you-stop.jpg.
- Checks: api/mcp/web tsc clean; api_server full suite 28 failed vs 31 baseline, no new failures.
