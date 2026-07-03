---
tags: [decision, Rhythm]
---

# Insert agent_configs as a new precedence step in resolveModelForSessionTurn (#854)

## Context

`resolveModelForSessionTurn` (`apps/api_server/src/services/agent_model_resolver.ts`)
is called from two places — `ws_gateway.ts` (~line 609, per-turn model
resolution for the WS chat path) and `agent_sessions_controller.ts`'s
`summarize()` (~line 1135). Its precedence was: per-turn override → session
pin → `resolveModelForAgent(agentId)`, a STATIC lookup table
(`ROUTE_FALLBACKS_BY_AGENT`) keyed only by the four base agent kinds
(`claude-code`, `codex`, `gemini-cli`, `opencode`). It never consulted
`agent_configs.model_provider`/`model_id` at all. A custom agent profile
(e.g. `secretary`, configured `anthropic/claude-sonnet-4-6`, authed and in
the live catalog) with no session-level model pin would resolve to
`undefined`, and `ws_gateway`'s undefined-model guard aborts the turn —
the session hangs forever with no LLM call ever fired. `AgentRunner`
(the scheduled-task path, `resolveRunModel` in `agent_runner.ts`) already
read `agent_configs` first; only this per-turn WS path had the gap.

## Decision

Insert a new step 3 into `resolveModelForSessionTurn`'s precedence, between
the session pin and the static fallback:

1. Per-turn `modelOverride` (WS `session.input` payload) — unchanged.
2. Session row's persisted `providerId`/`modelId` — unchanged.
3. **NEW** — `agent_configs.model_provider`/`model_id` for `agentId`, used
   ONLY when both fields are non-null AND the provider passes the same
   `opencodeClient.listAuthedProviders()` auth/catalog check
   `resolveModelForAgent` already performs. An unauthed configured model
   falls through to step 4 rather than returning a dead route. The whole
   step is wrapped in try/catch — any lookup failure (DB unavailable, auth
   probe error) logs a warning and returns `undefined` from this step,
   never throwing into the caller (fail-soft: a resolver hiccup must never
   hang a turn).
4. `resolveModelForAgent(agentId)` static fallback list — unchanged, just
   renumbered.

The repository lookup goes through a new narrow accessor,
`setAgentConfigsRepositoryForTest(repo | undefined)`, backed by a
module-level override variable that defaults to `new AgentConfigsRepository()`
when unset. This keeps `resolveModelForSessionTurn`'s public function
signature (and both call sites) completely unchanged, while still letting
unit tests inject a mock repo without `vi.mock`-ing the whole
`agent_configs_repository` module (both approaches now work; the accessor
is additive).

## Alternatives considered

- **Add a 5th optional param to `resolveModelForSessionTurn`'s opts object**
  (e.g. `agentConfigsRepo?: AgentConfigsRepository`) for constructor-style
  injection. Rejected: would have required touching both call sites
  (`ws_gateway.ts` and `agent_sessions_controller.ts`) for a test-only
  concern; the module-level override achieves the same testability with a
  zero-caller-change diff.
- **Hard-couple to `new AgentConfigsRepository()` inline** (mirroring
  `agent_runner.ts`'s `resolveRunModel`, which does exactly this and is
  tested via `vi.mock('../repositories/agent_configs_repository', ...)`).
  Viable and simpler, but the issue explicitly asked for "a narrow, mockable
  dependency" rather than a hard DB coupling; the accessor pattern supports
  both `vi.mock` (still works, tested implicitly by not breaking anything)
  and direct injection (used in the new contract tests) without forcing a
  choice.
- **Trust the agent_configs model without auth verification.** Rejected per
  the issue's explicit AC: "if verification says not-authed, fall through
  to step 4 rather than returning a dead route." Reusing
  `listAuthedProviders()` (rather than adding a second auth-check helper)
  keeps the two auth-aware code paths (`resolveModelForAgent` and the new
  step) consistent by construction.

## Consequences

- Custom agent profiles configured with a valid, authed model now resolve
  correctly on their first turn with no session pin required — the #854 bug
  is fixed for the WS chat path and for `summarize()`.
- `workflow-orchestrator` and any other manager/base profile with no
  `model_provider`/`model_id` set on its `agent_configs` row is UNCHANGED —
  it still resolves to `undefined` from the static fallback, exactly as
  before. This issue only stops the resolver from ignoring configs that
  exist; it does not backfill missing ones. A follow-up could seed sensible
  defaults for manager-only profiles so they don't depend on a session pin
  either.
- `tools/dev/agent_eval_driver.ts` was updated (issue #854 part 2) to PATCH
  each session's `providerId`/`modelId` from `agent_configs` immediately
  after creation, so the live agent-eval harness tests each agent on its
  intended model independent of this resolver fix landing correctly.
