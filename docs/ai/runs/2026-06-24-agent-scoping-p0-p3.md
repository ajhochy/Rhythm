---
date: 2026-06-24
repo: rhythm
branch: feature/agent-scheduler
pr: 734
issues: [P0, P1a, P1b, P2, P3, P4-1, P4-2]
status: verified-uncommitted
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Agent scoping parity — P0–P3 implementation + P4 design

Workflow run (orchestrator → planning-agent → issue-writer → coding-agents →
verification-gate). Stacked onto `feature/agent-scheduler`, one PR (#734).
Local issue files only. P4 = design/issues only (no code), per instruction.

## Files changed
- **P0** — `apps/api_server/src/__tests__/migrations_self_heal.test.ts` (NEW, 3 tests);
  `docs/ai/decisions/2026-06-24-stale-local-rhythm-db.md` (NEW).
- **P1a** — `apps/api_server/src/services/agent_profile_scope.ts` (NEW,
  `resolveProfileScope`); refactor `agent_runner._runOnce`; wire
  `ws_gateway.handleInputFrame` (forward `mcpRoleConfig` to `createSession`);
  `interactive_scope_parity.test.ts` (NEW, 6).
- **P1b** — `skill_retrieval.ts` (`getRelevantSkills`/`buildSkillsPreface` gain
  `allowedSkillsJson` filter, null = all eligible); call sites in
  `agent_runner` + `ws_gateway`; `skill_injection.test.ts` (+3),
  `skill_injection_runner.test.ts` (+1).
- **P2** — forward `system_prompt`→prompt body `system` and `ocAgent`→`agent` via
  `opencode_client_service.prompt()/promptAsync()` on both paths; #738 guardrail
  preserved (never pass agent *kind*); `p2_systemprompt_ocagent.test.ts` (NEW, 8);
  `docs/ai/decisions/2026-06-24-sdk-per-session-system-prompt.md` (NEW).
- **P3** — `agent_profile_sync.ts` (`syncOpencodeAgentProfiles` now sets non-null
  model + `allowed_mcps_json` on imported profiles; tier→model constants;
  workflow-orchestrator forced as the single selectable dev front-door);
  `agent_profile_sync_hygiene.test.ts` (NEW, 8).
- **P4 (docs only)** — `docs/ai/decisions/2026-06-24-manager-delegation.md`;
  issue files `P4-1-…`, `P4-2-…`.
- Plan/issues: `docs/ai/current-plan.md` + `docs/ai/generated-issues/*`.

## Checks run (verification-gate, this run)
- `npx tsc -p tsconfig.json --noEmit` — PASS (exit 0).
- `npx vitest run` (full) — **1152/1152 PASS**, 135 files; reproduced exit 0 across
  6 consecutive runs.
- Targeted (P0/P1a/P1b/P2/P3 + #738 guard): 9 files, 70 passed.
- `ai-workflow checks --level pr` — tsc + dart format + flutter analyze pass.

## Notes / decisions / deviations
- **P0 was not a migration bug.** `runMigrations` is correct; the queried file
  (`apps/api_server/rhythm.db`) is a stale, untracked, gitignored dev artifact;
  the runtime DB has all three tables. Deliverable was a regression test +
  decision note (no hand-created tables). See decision file.
- **P2 SDK finding:** SDK 1.14.49 has no per-session system prompt at
  `createSession`; forwarded via the per-prompt body instead. See decision file.
- **P3 skills scope (user chose to tighten):** importer derives a per-agent
  `allowed_skills_json` via `AGENT_SKILL_ALLOWLIST_MAP` (workflow-orchestrator →
  full 13-skill chain; specialists → own skill + handoff targets; unknown agents
  fail-open to null). Registry exposes no `skills` field, so the map is
  hand-maintained. MCP scope is `["rhythm"]`. (+3 tests → 1155 total.)
- **Out-of-scope flake filed:** `tasks_controller.test.ts > overdue=yes` is a
  pre-existing intermittent order/parallelism flake (shared `_db` singleton +
  `listen(0)`), ~1/7, not reproducible in 7 consecutive green runs, unrelated to
  the changed surface. Follow-up:
  `docs/ai/generated-issues/FOLLOWUP-flaky-tasks-controller-overdue.md`.

## Follow-ups
- Manual smoke (`flutter run -d macos`) before merging PR #734.
- P4 epic (manager→specialist delegation) awaits user go-ahead.
- Fix the flaky tasks-controller test (low priority).
