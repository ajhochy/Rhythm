---
date: 2026-07-16
repo: Rhythm
branch: (merge train — multiple)
pr: [1095, 1100, 1101, 1102, 1103, 1105, 1107]
issues: [1093, 1091, 1089, 1083, "codex-5.6-sol", 1001, 1041]
status: complete
tags: [run, rhythm]
---

# Open-PR merge train (continued from out-of-tokens Codex session)

## Context
A Codex session was tasked with "merge all open PRs to main safely." It merged
#1104 (#1038 dark theme) and #1106 (#1082 skill revert) on GitHub, then ran out
of tokens mid-flight with deep, partly over-engineered hardening (provenance
columns, path confinement) stranded in unpushed `codex/pr-*` worktrees.

7 PRs remained open: #1095, #1100, #1101, #1102, #1103, #1105, #1107 — all draft.

## Key finding
Every open PR carried the same **pre-squash #1097 noise** (`opencode_agent_writer.ts`,
`opencode_agent_writer_projection.test.ts`, `opencode_agent_writer.test.ts`,
`live_e2e_manager_direct_routing.test.ts`, `issue-0-manager-routing.json`,
`manager-agents-direct-work.md`, and a stale `project-state.md`). Squash-merging
any as-is would have **reverted main's project-state.md** and re-applied divergent
#1097 files. Each PR's *real* change was small and disjoint from the others.

## Approach
For each PR: fresh worktree on current `origin/main`, 3-way-apply **only the meat
files** (drop all #1097 noise), commit as one clean commit, build + full unit
suite, force-push to the PR head, CI, squash-merge. Did NOT adopt Codex's
speculative provenance-column expansion (Codex itself flagged it HIGH blast radius;
the PRs' own small fixes are correct and unit-tested).

Worktrees share the baseline `node_modules` (root + apps/api_server) via symlink —
npm workspace hoists deps to root `node_modules` (gotcha: symlinking only
apps/api_server/node_modules leaves undici/ws/resend unresolved). Bash tool runs
**zsh** → needed `setopt shwordsplit` for multi-path var expansion.

## Per-PR meat + verdict
- #1095 (#1093 hybrid Engraph memory retrieval): env.ts, agent_memory_repository,
  engraph_client, memory_retrieval + 3 tests. Build+2731 unit green.
- #1100 (#1091 gemini anyOf sole-key): opencode_fork gemini-tool-schema.ts. bun test
  12/12 green. MERGED (no fork CI in repo; release build must rebuild fork binary).
- #1101 (#1089 cron nextRunAt in task timezone): agentSchedulerService + tz tests. green.
- #1102 (#1083 NULL MCP scope): agent_profile_sync.ts — makes MCP/skill defaults
  INSERT-ONLY so a deliberate NULL (unrestricted) survives re-sync. +99 hygiene tests. green.
- #1103 (codex frontier route gpt-5.6-sol): model_fallback/model_resolver. green.
- #1105 (#1001 live-E2E isolation guard): test-only (live_e2e_guard.test.ts + 2 tweaks). green.
- #1107 (#1041 prompt-fix resolver fallback): org_proposal_appliers_wiring.ts. green.

## Checks
- Baseline main: 2728 passed / 30 skipped.
- Each api_server PR rebuilt: 2731 passed / 30 skipped (+3 new tests), 0 TS errors.
- Release smoke (`smoke-launch.sh`) on main: build+spawn+bind :4001 + /health +
  /agents/capabilities 200 + POST /agent-sessions 201 — PASS (isolated temp DB).

## Notes
- main is NOT branch-protected; admin + squash available.
- Live `live_e2e_*` suites need isolated DB + RHYTHM_LIVE_E2E_ISOLATED=1 + real
  external agent CLIs/keys; smoke-launch is the deterministic release proof used here.
