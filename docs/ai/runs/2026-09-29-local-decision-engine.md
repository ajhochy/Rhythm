---
date: 2026-09-29
repo: Rhythm
branch: feat/local-decision-engine
pr: TBD
issues: []
status: in-review
tags: [run, Rhythm]
---

# Local decision engine: model routing, tool ranking, memory ranking

The plan was written and reviewed by the orchestrator. Four Sonnet subagents implemented it: core, memory, routing + tools, and bench/docs.

## Files

- `apps/api_server/src/services/decision/`:
  - `decision_client.ts`, `decision_engine.ts`, `decision_log.ts`
  - `model_router.ts`, `tool_ranker.ts`
  - `bench_metrics.ts`, plus tests
- Integrations:
  - `memory_retrieval.ts`: `off`/`shadow`/`on` rerank path.
  - `ws_gateway.ts`: tier routing and prompt threading.
  - `opencode_client_service.ts`: `updateSessionAllowlist(..., prompt?)`.
  - `turn_redispatch.ts`, `agent_runner.ts`.
- Config and storage:
  - `config/env.ts`: `AGENT_DECISION_*` getters.
  - `database/migrations.ts`: local-only `agent_decision_log` table.
  - `routes/agent_decisions_routes.ts`, registered in `app.ts`.
- `apps/api_server/scripts/decision_bench.ts` and `scripts/decision_bench/` (fixtures: 45 routing cases, 25 tool cases, 15 memory cases).
- `docs/ai/decision-engine-setup.md`
- `docs/ai/plans/2026-09-29-local-decision-engine.md`
- `docs/ai/decisions/2026-09-29-local-decision-engine.md`

## Checks

- `tsc --noEmit`: clean.
- `vitest run src/services/decision`: 54 tests passing.
- Memory suites plus decision: 443 tests passing.
- Routing, tool-cap, redispatch and runner suites: passing.
- Full suite: see PR description.
- `decision_bench.ts --fake`: the pipeline runs end to end. Real-model numbers are still pending, because this container cannot reach Hugging Face or Ollama to download weights.

## Notes

- Orchestrator review fix: routing no longer overrides `agent_config`, because a user-picked profile model is a pin. `agent_runner` routes only when the profile pins no model.
- GitNexus MCP tools were not available in this cloud session. Blast radius was assessed manually: every integration is behind a flag, defaults to `off`, and has a try/catch fallback.
- Next step: on the Mac, run llama-server with Qwen3-Reranker-4B, then `npx tsx scripts/decision_bench.ts`. Then set the three flags to `shadow` for a week and review `GET /agent-decisions`.
