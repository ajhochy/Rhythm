# OPC-M4-4 — Custom agent/mode selection

**Milestone:** M4 — Input & config
**Branch:** `opc-m4-4-custom-agent-selection`
**Depends on:** OPC-M1-1

## Summary

Surface OpenCode's agent concept (build/plan built-ins + any custom agents the SDK config
reports for the session cwd): a per-session agent selector next to the model picker, sent with
prompts, with the active agent reflected in `agent`-type parts. Scoped to **render what the SDK
reports** — no config-authoring UI (custom agents come from opencode config files in the cwd;
Rhythm does not manage those).

## Motivation

Audit A top-15: "agent switching". The existing permission-mode toggle (plan mode) partially
overlaps; this aligns the affordance with opencode's real agent model so plan/build behave
identically to OpenCode proper.

## Likely files

- `apps/api_server/src/services/opencode_client_service.ts` (listAgents/config wrapper)
- `apps/api_server/src/routes/agents_capabilities_routes.ts` or new route (expose agent list)
- `apps/api_server/src/services/ws_gateway.ts` (forward `agent` field on prompt)
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (selector)
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`

## Acceptance criteria

1. `GET /agent-sessions/agents` (or capabilities extension — implementer documents choice) returns the SDK-reported agent list for a cwd (vitest spy + fixture incl. a custom agent entry).
2. WS `session.input` carrying `agent: <name>` forwards it on the SDK prompt call (vitest spy assert).
3. The composer shows an agent selector populated from the endpoint; default matches the SDK default; selection persists per session for the app run (controller test).
4. An `agent`-type part in the transcript renders a labeled marker ("Switched to plan") rather than the generic card (widget test with fixture).
5. When the SDK reports only built-ins, the selector still works with build/plan (no crash on absent custom agents).
6. Existing permission-mode behavior (plan mode auto-deny semantics) is regression-tested — selecting the plan agent must not double-apply permission gating.
7. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: agent list + prompt-forwarding contracts (c1-c2).
- flutter test: `opc_m4_4_agent_selection_test.dart` (c3-c6).

## Out of scope

- Authoring/editing custom agents inside Rhythm. Reconciling Rhythm's legacy `agentId` (claude-code/codex/gemini-cli) naming — that stays the session-creation concept; this selector is opencode's intra-session agent.
