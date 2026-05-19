# tweak(agents): default first-choice model should be Sonnet, not Opus

## Request

In a new agent-less session, the "Choose a model" placeholder pill shows `claude-opus-4-7` because Opus is the first entry in `ROUTE_FALLBACKS_BY_AGENT['claude-code']` in [agent_model_resolver.ts:29-44](apps/api_server/src/services/agent_model_resolver.ts). User preference: surface Sonnet as the default first choice — Opus is heavyweight + expensive, Sonnet is the more reasonable everyday model.

## Scope

`apps/api_server/src/services/agent_model_resolver.ts` — reorder the `claude-code` route list so Sonnet is first (and add corresponding Sonnet routes for openrouter / github-copilot if not already at the top of those tiers). Update the corresponding agents_models_catalog test if it asserts the first-route identity.

Decide whether the same preference applies to `codex` (currently `gpt-5.3-codex` first) and `gemini-cli`. For consistency, leaning toward "moderate model first, premium variants below" across all agents — but defer to the user's call.

## Acceptance criteria

- [ ] New agent-less session opens with Sonnet (or Sonnet equivalent) in the model placeholder.
- [ ] All agents still route correctly; no test regressions.
- [ ] User can still pick Opus / Opus 1M / Legacy via the picker.

## Severity

Trivial — pure config tweak.
