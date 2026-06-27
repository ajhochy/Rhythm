---
date: 2026-06-24
repo: Rhythm
branch: feature/agent-scheduler
pr: 734
issues: [13-followup-skill-self-refinement, 12-followup-memory-retrieval-injection]
status: integrated-ci-green-pending-manual-smoke
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# P5 self-refinement + memory injection — parallel implementation & integration

Two independent follow-up issues implemented **in parallel** via git worktrees, then
integrated **sequentially** onto `feature/agent-scheduler`. Not merged to main (manual review).

## Mechanism
- Worktrees: `../rhythm-p5-refine` (`feat/skill-self-refinement`) and `../rhythm-mem-inject` (`feat/memory-injection`), both off `feature/agent-scheduler` @ `551beb4`.
- Two `coding-agent` subagents dispatched concurrently (AgentFlow `implement_issue` deliberately avoided — it had been stalling). Each locked to its own worktree, TDD, self-verified.
- Integration: Stream A landed via fast-forward (`551beb4..3d3c15d`), re-verified; Stream B merged (`--no-ff` → `1412614`).

## Files changed
**Stream A (P5 self-refinement)** — api_server: `database/migrations.ts`, `database/postgres_bootstrap.ts` (NEW `agent_skill_versions` table + `version` col, both DBs), `models/agent_skill.ts`, `repositories/agent_skills_repository.ts` (`reviseInPlace`/`listVersions`/`rollback`), `services/skill_refiner.ts` (NEW, injectable fail-closed judge), `services/skill_extractor.ts` (route matched candidate via refine), `config/env.ts` (`AGENT_SKILL_REFINEMENT_ENABLED`), `controllers/agentSkillsController.ts` + `routes/agentSkillsRoutes.ts` (versions/rollback). Flutter `features/agent_skills/`: `models/agent_skill_version.dart` (NEW) + data source/repo/controller/view (History dialog + rollback). Tests: +30 (repo 8, refiner 15, routes 7, +2 Flutter real-surface).

**Stream B (memory injection)** — api_server: `services/memory_retrieval.ts` (NEW), `config/env.ts` (`AGENT_MEMORY_INJECTION_ENABLED`), `services/agent_runner.ts` (`ownerUserId` + memory preface), `services/ws_gateway.ts` (memory preface, owner=null), `services/agentSchedulerService.ts` (threads `created_by_user_id`). Tests: +15 (injection 9, runner 6, incl. cross-user-leak).

## Conflicts reconciled (integration-owner work)
Only two files conflicted (the dispatch's other predicted overlaps — `agent_runner.ts`, `ws_gateway.ts`, `skill_retrieval.ts` — did not, because A used the `distillFromSession` seam and B added a new `memory_retrieval.ts`):
- `config/env.ts` — kept BOTH toggles.
- `docs/ai/project-state.md` — kept BOTH run entries.
- Verified send-site composition in `agent_runner.ts`: `memory \n\n skills \n\n prompt`, each preface independently toggle-guarded + never-throws.

## Checks run (integrated tree @ 1412614)
- `npx tsc --noEmit` → 0 errors.
- `npx vitest run` → **1123/1123** (baseline 1078 + 30 A + 15 B).
- `dart format --set-exit-if-changed .` → clean.
- `flutter analyze --no-fatal-infos` → 0 errors (259 info-level only).
- `flutter test` → **656/656**.
- CI (push `551beb4..1412614`): Server CI ✓, Desktop CI ✓, MCP Server CI ✓.

## Notes / decisions / deviations
- Refinement wired at the single shared `distillFromSession` seam so both auto-extract AND teacher-escalation get it (smallest correct change).
- Quality bar = injectable LLM judge (fail-closed on equal/worse/uncertain/throw) AND `candidate.confidence ≥ existing.confidence`. Rollback non-destructive (snapshots current first). Seed invariant preserved (UPDATE keeps row id; non-seed source).
- Memory owner-scoped, fail-closed: scheduler threads `agent_scheduled_tasks.created_by_user_id`; WS/interactive has no per-session owner → `null` → global-only memory (deliberate, prevents cross-user leak). Deviation: added `extractQueryTokens` per-token FTS probe (reused FTS5 AND-semantics make full-prompt retrieval near-useless) — preserves the shared `searchAsync` path and the on-demand `rhythm_search_memory` tool.
- No follow-up issues filed; no scope expansion.

## Pending
- Manual smoke (visual): Skills → History/Rollback dialog; memory injection owner-scoping at runtime. Live judge/refine + live memory model paths are `isTestEnv`-guarded (unit-proven, not end-to-end).
- Worktrees safe to remove (`git worktree remove ../rhythm-p5-refine ../rhythm-mem-inject`).
