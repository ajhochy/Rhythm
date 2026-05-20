# fix(agents): agent_kind pill mislabels non-Anthropic OpenRouter models as "Claude Code"

## Problem

When a new agent-less (`__pending__`) session is created and the user picks an OpenRouter model that isn't prefixed `openai/` or `google/`, the WS gateway's `agentKind` resolver in [ws_gateway.ts:184-199](apps/api_server/src/services/ws_gateway.ts) falls through to `'claude-code'`. The composer pill then displays "Claude Code" even though the user is talking to DeepSeek / Mistral / Qwen / Llama / etc. The actual routing through OpenRouter is correct; only the displayed agent label is wrong.

## Reproduction (vbeta.18.36)

1. Create a new session in Agents view.
2. Pick **DeepSeek** (or any non-anthropic / non-openai / non-google OpenRouter model) in the composer picker.
3. Set as session default and send a turn.
4. Get a successful response from DeepSeek.
5. Observe: the model pill / session header reads "Claude Code" — not "OpenRouter" or "DeepSeek" or anything indicating the actual provider/model.

## Scope

`apps/api_server/src/services/ws_gateway.ts` lines ~184-211. Expand the OpenRouter-prefix branch (or introduce a separate provider→agent map / per-model lookup) so that:

- `anthropic/*` → `claude-code` (already correct via the fallback path)
- `openai/*` → `codex` (already correct)
- `google/*` → `gemini-cli` (already correct)
- Anything else (deepseek/, mistralai/, meta-llama/, qwen/, x-ai/, …) → a new neutral `agent_kind` like `'opencode'` (already in the schema; used as the bare "talk to any model" agent) OR introduce a new `'openrouter'` agent_kind with the appropriate routing fallbacks added to `ROUTE_FALLBACKS_BY_AGENT`.

Decide which feels right for the UX before implementing — neutral "OpenCode" pill or a new "OpenRouter" pill. Both require a small Flutter label-mapping addition in `agents_controller.dart` / the model picker view.

## Acceptance criteria

- [ ] DeepSeek / Mistral / Qwen / etc. OpenRouter models surface a pill that is **not** "Claude Code."
- [ ] Existing Anthropic / OpenAI / Google routing is unchanged.
- [ ] Existing tests still pass; new test covers the non-prefixed OpenRouter branch.
- [ ] No flutter analyze or test regressions.

## Out of scope

- Building a full per-model display-name map. The pill should reflect agent-kind / family, not literal model name (model name is already shown elsewhere in the picker).

## Severity

Low — purely cosmetic, no functional impact on routing or responses.
