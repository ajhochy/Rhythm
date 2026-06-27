---
index: "[[Rhythm]]"
date: 2026-06-24
repo: Rhythm
branch: feature/agent-scheduler
pr: "734"
issues: P0-2, P1-1, P1-2, P2-1, P2-2, P3-1, P3-2, P4-1, P4-2 (P0-1 = agent-stack PR #15)
status: implemented + CI-green (Server/Desktop/MCP); manual smoke pending; never merged
tags: [run, Rhythm]
---

# Run: Odysseus self-improving skill library port

Built a Rhythm-native, **instance-shared** (no per-user owner scoping) self-improving
skill library modeled on Odysseus (`~/Documents/odysseus`: `skill_extractor.py`,
`skills.py::get_relevant_skills`, `chat_helpers.py` injection, teacher-escalation).
Agent prompts stay stable; the **skill library is the evolving layer**. Planned via
the AgentFlow `plan_and_issues` workflow; each issue implemented by a dispatched
coding-agent subagent, independently re-verified (tsc + vitest / flutter), committed,
and `gh run watch` CI-gated before the next.

## Files (by issue)

- **P1-1** store: `migrations.ts` + `postgres_bootstrap.ts` (`agent_skills` table, both DBs, no owner_user_id), NEW `models/agent_skill.ts`, NEW `repositories/agent_skills_repository.ts` (CRUD + incrementUses + findByTitle).
- **P1-2** routes: NEW `controllers/agentSkillsController.ts`, NEW `routes/agentSkillsRoutes.ts`, mounted `/agent-skills` in `app.ts`.
- **P0-2** seed: NEW `services/skill_seed_importer.ts` (reads `~/.config/opencode/agents` + `~/.claude/skills`, idempotent, boot-guarded by source-count, isTestEnv-guarded), wired in `server.ts`.
- **P2-1** extractor: NEW `services/skill_extractor.ts` (`distillFromSession`, injectable LLM call, ≥2 rounds, ≥0.6 conf, dedup, never-throws, isTestEnv-guarded).
- **P2-2** wiring: `skill_extractor.ts` (`queueSkillExtraction`), `agent_runner.ts` (success path), `opencode_stream_bridge.ts` (session.idle) — fire-and-forget.
- **P3-1** retrieval: NEW `services/skill_retrieval.ts` (`getRelevantSkills` — Jaccard + tag + substring + conf/uses; thresh 0.3, top-5; published always, draft≥0.6 fail-closed).
- **P3-2** injection: `skill_retrieval.ts` (`buildSkillsPreface`, `isSkillInjectionEnabled`), `agent_runner.ts` + `ws_gateway.ts` (transient preface prepend; `uses` increment), `config/env.ts` (`AGENT_SKILLS_ENABLED`, default ON).
- **P4-1** teacher-escalation: `agent_runner.ts` (`run`→`_runOnce` + wrapper, `shouldEscalate`/`escalateAndCapture`, `modelOverride`), `skill_extractor.ts` (source param), `config/env.ts` (`AGENT_TEACHER_MODEL`, `AGENT_TEACHER_ESCALATION_ENABLED`).
- **P4-2** Flutter: NEW `lib/features/agent_skills/**` (model/data/repository/controller/view), `main.dart` (provider), `_agents_nav_column.dart` ("Skills" nav row).
- Tests: 8 new api_server test files (repository, routes, seed, extractor, wiring×2, retrieval, injection×2, teacher-escalation) + 1 Flutter real-surface test.

## Checks

- api_server: `tsc --noEmit` 0 errors; `vitest` **1070/1070** (baseline 966 → +104).
- desktop_flutter: `dart format` clean; `flutter analyze --no-fatal-infos` 0 err/0 warn; `flutter test` **652/652**.
- CI: Server + Desktop + MCP green per issue (`gh run watch`). Known flaky port/socket tests (opc_curated_mcp_token_bridge c4, issue_638_contract, notifications_agent) cleared on re-run.

## Notes

- **Test-env guard** mirrored from `opencode_agent_writer.ts::isTestEnv()` on every file/LLM-writing service (a prior bug let vitest pollute `~/.config/opencode/agents` — guarded + proven by tests this run).
- **AgentFlow `implement_issue` stalled** (registry/instance flakiness) → fell back to coding-agent subagents per orchestrator's documented fallback. See `[[2026-06-24-agentflow-implement-stalled-subagent-fallback]]`.
- **P0-1** (sever agent-stack `sync-globals` opencode write) done out-of-tree: agent-stack PR #15. See `decisions/2026-06-24-rhythm-owns-skills.md`.
- Follow-ups: `generated-issues/11-followup-skill-body-column.md` (prose `body` column); flaky-test hardening (background task chip).
- Live model/run paths are isTestEnv-guarded → proven by injected-dep unit tests, not end-to-end; manual smoke (Agents → Skills) still pending.
