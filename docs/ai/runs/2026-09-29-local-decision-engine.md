---
date: 2026-09-29
repo: Rhythm
branch: feat/local-decision-engine
pr: https://github.com/ajhochy/Rhythm/pull/1588
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

- Capacity routing: `decision/capacity_router.ts` (+ tests) and `agent_runner_pin.test.ts`. Integrated in `agent_sessions_controller.ts` (auto account pick), `ws_gateway.ts` (model + auto-session account switch) and `agent_runner.ts` (shared profile-pin check).

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
- The capacity layer was added at AJ's request.
  - Most-headroom account first.
  - When the base provider is low, same-tier models on other providers count as equivalent (opus≈sol, sonnet≈terra).
  - When all accounts are low: lowest tier ≥ required, then most headroom; price never breaks ties.
  - The "could do the job" tier comes from the model router. With routing off, capacity never drops below the route's current tier.
- Full suite (7124 tests): 8 failures.
  - 3 fixed: assertions now expect the new prompt argument.
  - 5 unrelated to this branch: a root-ignores-chmod test, 3 `sandbox.sh` shell tests, and a boot-timing flake that passes when run alone.
- Next step: on the Mac, run llama-server with Qwen3-Reranker-4B, then `npx tsx scripts/decision_bench.ts`. Then set the three flags to `shadow` for a week and review `GET /agent-decisions`.

## Follow-up work in the same PR (same day)

- **Auto (router) session mode.** `agent_sessions.model_mode`; new interactive sessions default to `auto`. The picker offers "Auto (router)" first in Electron (`apps/web`), Flutter and mobile.
- **Router backend settings.** Local / Jev / custom (LAN) with write-only keys, consent gating, and a test-connection endpoint. UI in Electron (Agent Settings → Models) and mobile (Settings → AI & providers).
- **Routing scope.** `first_prompt` (default), `escalate_only`, `every_prompt`. Mobile prompts are routed in the OpenCode proxy, so no engine change was needed.
- **Contrarian review fixes.** Auto sessions default to shadow, memory pool cap, usage-cache self-priming, cross-agent tier equivalence, and a decision-log cap.
- **Calibration script.** `scripts/decision_calibrate.ts`: 20 labelled prompts → threshold sweep and description diagnostics.
- **Checks.** api_server: 1035 focused tests pass. web: `tsc -b` clean and 9 Playwright contract tests pass. mobile: jest settings/chat suites pass (the 4 `issue-1387` and 1 `issue-1173` failures are pre-existing). Flutter: analyze at baseline, 740 tests pass, and the 2 golden failures are pre-existing Linux rendering diffs.
- **Still unverified.** Nothing has run against a real reranker or Jev. The Jev field names come from third-party docs.
