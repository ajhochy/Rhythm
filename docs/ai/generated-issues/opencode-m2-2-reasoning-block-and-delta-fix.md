# OPC-M2-2 — Reasoning collapsible block + non-text delta routing fix

**Milestone:** M2 — Rendering parity
**Branch:** `opc-m2-2-reasoning-block-and-delta-fix`
**Depends on:** OPC-M1-3 (M2-1 recommended first for shared body widget)

## Summary

Two halves of one feature: (a) fix `_appendChatDelta` (agents_controller.dart:1322) so
`message.part.delta` frames are routed by part type/field — reasoning deltas append to the
reasoning part, not dropped; (b) render reasoning parts as a collapsed "Thinking…" block
(expandable, secondary text color, duration label when step-finish provides it) instead of
plain prose inline with the answer.

## Motivation

Audit B: `_appendChatDelta` drops non-text field deltas; reasoning parts render as plain prose
(`_ChatBubble` has no reasoning branch — agents_view.dart:1881). Extended-thinking models
currently interleave chain-of-thought with the real answer, which is confusing and verbose.

## Likely files

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` (≈:1322)
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (≈:1881)
- `apps/desktop_flutter/lib/features/agents/views/_reasoning_block.dart` (new)

## Acceptance criteria

1. A `message.part.delta` for a reasoning-type part appends to that part's text (controller unit test with a real-shape delta frame); a text delta still appends to the text part; an unknown-field delta is retained (logged), not silently dropped.
2. Reasoning part renders as a collapsed block labeled "Thinking…" (or "Thought for Ns" once finished); the reasoning text is NOT visible until expanded (widget test: find.text on reasoning content fails collapsed, succeeds after tap).
3. Expand/collapse state is per-block and survives a delta append (no auto-collapse on rebuild).
4. The final answer text part renders outside the reasoning block (both findable when expanded).
5. Rehydrated reasoning parts (REST, M1-3) render identically to streamed ones (same widget test fixture through the rehydrate path).
6. `flutter test` green; `ai-workflow checks --level pr` exits 0.

## Required tests (flutter test)

- New `opc_m2_2_reasoning_test.dart`: controller delta-routing units (c1) + widget tests (c2-c5) using recorded v1.14.49 part shapes.

## Out of scope

- Token/cost display (M2-4). Reasoning-budget composer controls (already shipped).
