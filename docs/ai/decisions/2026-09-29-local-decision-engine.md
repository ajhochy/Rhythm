---
date: 2026-09-29
repo: Rhythm
tags: [decision, Rhythm]
---

# Use a local reranker as a Jev-style decision engine

## Context

Three prompt-path choices are made today by hand-written heuristics:

- **Model tier:** a static route table plus task-kind policy.
- **MCP tool surface:** a fixed order, trimmed only by the Gemini cap.
- **Memory injection:** a lexical-overlap gate. Engraph semantic hits are dropped because Engraph 1.7.2 returns no calibrated confidence.

TypeSafe's Jev targets exactly these "typed decision + confidence" steps. The goal is to try the idea on open local weights first.

## Decision

- One engine, `services/decision/`, calls a cross-encoder reranker over a loopback-only `POST /v1/rerank`. The default model is Qwen3-Reranker-4B on llama.cpp.
- `rankCandidates` and `classify` derive all three decisions from reranker scores:
  - **Model routing:** classify the prompt against tier descriptions.
  - **Tool ranking:** rank MCP servers against the prompt.
  - **Memory ranking:** rank the owner-scoped candidate pool.
- Each feature has an `off`/`shadow`/`on` flag and defaults to `off`.
- Decisions are logged to a local-only `agent_decision_log` table, surfaced at `GET /agent-decisions`.

## Alternatives

- **Hosted Jev now.** Rejected for the first iteration: prompts and memories are personal staff data, and its terms and latency are unverified. It can be added later as another `RerankClient`.
- **A small generative LLM emitting JSON via Ollama.** Rejected: slower, and its scores are uncalibrated.
- **RouteLLM-style trained routers.** Rejected: they need training data we don't have yet. The decision log is how we would collect it.

## Consequences

- Nothing changes until an operator runs the reranker server and flips a flag.
- Guardrails:
  - Routing never overrides turn, session or profile pins (`agent_config` counts as a pin).
  - Tool ranking only reorders or defers and never revokes a grant.
  - Memory ranking keeps the owner, lifecycle and injectability gates, and every existing cap.
- With routing and tool ranking both `on`, a turn can take up to two sequential reranker calls (400 ms timeout each).
- Reranker scores are relevance scores, not trained decision probabilities. Calibration must be checked with the bench and shadow logs before switching features to `on`.
