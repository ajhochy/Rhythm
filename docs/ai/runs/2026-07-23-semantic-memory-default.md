---
date: 2026-07-23
repo: rhythm
branch: claude/agent-skill-injection-semantic-0s6iv4
pr:
issues: []
status: complete
tags: [run, rhythm]
---

# Semantic memory retrieval: ranking fix + hybrid default + latency budget

## Files
- `apps/api_server/src/services/memory_retrieval.ts` — `getRelevantMemories` rewritten: concurrent per-token FTS probes (no early break), rank by distinct-token match count, drop single-token coincidences whenever a multi-token match exists.
- `apps/api_server/src/config/env.ts` — `getAgentMemoryRetrievalMode()` now defaults to `hybrid` (explicit `AGENT_MEMORY_RETRIEVAL_MODE=fts` opts out); new `getSemanticSearchBudgetMs()` (default 500ms, `AGENT_MEMORY_SEMANTIC_BUDGET_MS` override).
- `apps/api_server/src/services/engraph_manager.ts` — `getRetrievalClient()` uses the budget for both the managed and fallback clients.
- Tests: 3 step-scoped smoke suites + `memory_semantic_e2e.test.ts` (real SQLite + fake Engraph HTTP server, whole `buildMemoryPreface` path incl. hung-service latency assertion); inverted one existing default-mode test; 3 new engraph_manager budget tests.

## Checks
- Full api_server suite: 351 files / 3106 tests passing, tsc clean.
- E2E: zero-word-overlap memory injected via semantic lane by default; junk suppressed; 3s Engraph hang bounded by 200ms budget.
- Not verifiable in the remote container: real `engraph` binary, macOS app. First real-world validation is the release build.

## Notes
- Built by sequential Sonnet subagents against pre-written smoke tests; orchestrator reviewed each diff before commit.
- Cold start was already safe (boot warm-start + fail-closed client until healthy); the budget closes the steady-state 1s worst case.
- Related: `docs/ai/decisions/2026-07-23-semantic-scope-injection.md` parked in the same session — capability scoping stays config-level; this memory work was judged the higher-value semantic investment.
