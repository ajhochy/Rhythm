---
index: "[[Rhythm]]"
date: 2026-06-23
repo: Rhythm
tags: [decision, Rhythm]
---

## Context

`AgentRunner.run()` calls `opencodeClient.promptAsync(sessionId, prompt, model, cwd)` where `model` is `{providerID, modelID}`. The original code passed `undefined`, so opencode never generated a response — the 600 s poll always timed out.

Interactive chat worked because the UI composer supplies the model when the user submits a message. AgentRunner has no composer, so it must resolve a model itself for scheduled/cookbook runs.

## Decision

Use a 3-step cascade in `resolveRunModel(agentConfigId?)`:

1. **Agent config preference** — if `agentConfigId` is provided and the `agent_configs` row has non-null `model_provider` + `model_id`, use them. This lets operators configure a specific model per agent profile via PATCH `/agent-configs/:id`.
2. **Most-recently-used (MRU)** — query `agent_sessions` for the most recent row with non-null `provider_id` + `model_id`. This automatically picks up whatever model the user last used interactively — zero configuration needed for the common case.
3. **Hardcoded default** — `anthropic / claude-sonnet-4-5`. Ensures a run never silently hangs even on a fresh install with no prior sessions.

The function never throws and never returns `undefined`. If DB lookups fail, it logs warnings and falls through to the hardcoded default.

## Alternatives considered

- **Require model to be set on agent config (fail otherwise):** Too strict — new installs would need manual config before any scheduled task could run.
- **Read from opencode's provider list and pick the first available:** Too fragile — provider ordering is not deterministic and the "first" model may not be capable.
- **Store a single global "default model" preference:** Adds a new config surface. The MRU approach gives the same result automatically by reusing the user's own last-used model.
- **Fast-fail with error status if no model:** Considered, but the hardcoded default is strictly better — it gives the user a working baseline and fails with a clear `promptAsync returned false` error (fast, not a 600 s hang) only if the hardcoded provider is not configured.

## Consequences

- Scheduled tasks work out of the box after the user has done at least one interactive chat (MRU populated).
- Operators who want a specific model per agent profile can PATCH `model_provider`/`model_id` on the agent config row.
- Fresh installs with no sessions and no config will attempt `anthropic/claude-sonnet-4-5`; if anthropic is not configured the run fails fast at `promptAsync` with a logged error.
- `resolveRunModel` is exported and fully covered by tests.
