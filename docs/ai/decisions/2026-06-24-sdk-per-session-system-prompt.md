---
date: 2026-06-24
tags: [decision, rhythm, api_server, opencode-sdk]
---

# OpenCode SDK: no per-session system prompt; forward via the per-prompt body

## Context

P2 asked whether the profile's `system_prompt` and `ocAgent` can be forwarded to
agent sessions. `agent_runner.ts` (~488-506) loads both from the profile but does
NOT forward them; explicit TODOs (~503-505) noted that the OpenCode SDK exposed no
per-session system prompt. We re-verified against the installed SDK.

## Finding (SDK @opencode-ai/sdk 1.14.49)

Inspected `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`:

- **Session creation has no system field.** `SessionCreateData.body` is
  `{ parentID?: string; title?: string }` only (POST `/session`). There is still
  no per-session system prompt at creation time — the original TODO was accurate.
- **The per-prompt body DOES accept it.** `SessionPromptData.body` and
  `SessionPromptAsyncData.body` (POST `/session/{id}/message`) both accept:
  - `system?: string` — a system prompt for that turn,
  - `agent?: string` — the opencode agent mode for that turn,
  - `tools?: { [key: string]: boolean }`,
  - `model?: { providerID, modelID }`, `parts`, etc.

## Decision

Forward profile fidelity through the **per-prompt body**, not session creation:

- `profile.system_prompt` → prompt body `system` on each turn (both
  `opencode_client_service.prompt()` and `promptAsync()`), sourced from the P1
  `resolveProfileScope` helper so scheduled and interactive paths behave
  identically.
- `profile.ocAgent` → prompt body `agent`, with precedence
  **per-turn agent override > profile ocAgent > none**. ws_gateway already
  forwards a per-turn `agent` (`ws_gateway.ts:563`); the profile default fills in
  when no per-turn override is sent.

### Guardrail (do not regress #738)

`agent_runner.ts:626` deliberately does **not** pass `agent: agentKind` (the
provider kind `claude`/`codex`) — passing the wrong value there caused #738.
Forwarding `profile.ocAgent` (an opencode agent *mode* such as `build`/`plan`) is
a different field and is safe, but the implementing change must pass the profile's
ocAgent value, never the agent *kind*, and must keep the existing #738 behavior
when ocAgent is unset.

## Consequences

- No SDK upgrade or session-creation change needed; P2 is implementable today.
- The system prompt is re-sent per turn (cheap, and robust to session resumption)
  rather than set once — acceptable and arguably more correct for resumed sessions.
- This forwarding lives behind `resolveProfileScope`, so P4 (manager→specialist
  delegation) inherits correct system_prompt/ocAgent forwarding for free.
