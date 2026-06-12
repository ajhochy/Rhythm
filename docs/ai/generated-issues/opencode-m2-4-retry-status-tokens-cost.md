# OPC-M2-4 — Retry status surfacing + token/cost display

**Milestone:** M2 — Rendering parity
**Branch:** `opc-m2-4-retry-status-tokens-cost`
**Depends on:** OPC-M1-2, OPC-M1-3

## Summary

(a) The bridge stops collapsing every non-busy SDK status to `idle`: retry states/parts are
relayed as a distinct WS status and rendered inline ("Retrying (attempt N)…" with reason).
(b) Assistant messages display token+cost metadata (already persisted by M1-2): per-message
cost (USD, 2-4 decimals) with token breakdown (input/output/reasoning/cache) in a tooltip, and
a session running total in the transcript header.

## Motivation

Audit B: "retry status dropped (bridge treats non-busy as idle)" — users see a frozen session
during provider retries; "token/cost display: ABSENT" — OpenCode's sidebar shows cost/tokens,
and per-user-API-key billing makes cost visibility genuinely useful to staff.

## Likely files

- `apps/api_server/src/services/opencode_stream_bridge.ts` (status mapping)
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (bubble footer + header total)
- `apps/desktop_flutter/lib/features/agents/models/agent_session_message.dart` (tokens/cost fields)

## Acceptance criteria

1. Bridge maps a real-shape retry status/part event to a WS frame with status `retrying` (vitest: not `idle`); idle and busy mappings unchanged (regression asserts).
2. A retry part renders inline with attempt count and reason text (widget test).
3. When the retry resolves (next message/part event), the retrying indicator clears.
4. An assistant message with `cost: 0.0142` and tokens `{input: 1200, output: 350, reasoning: 0, cache: 800}` renders a footer "$0.0142"; tooltip/expanded detail contains all four token counts (widget test).
5. Messages without cost (user, legacy rows) render no cost footer.
6. Transcript header shows the session total = sum of persisted message costs, updating when a new message lands (controller test).
7. Rehydrated messages (REST) show identical cost/token UI to streamed ones.
8. `ai-workflow checks --level pr` exits 0; vitest + flutter test green.

## Required tests

- vitest: bridge status-mapping tests with recorded retry fixtures (c1).
- flutter test: `opc_m2_4_retry_cost_test.dart` (c2-c7).

## Out of scope

- Cost budgeting/limits. Currency localization (USD only — plan open question 4).
