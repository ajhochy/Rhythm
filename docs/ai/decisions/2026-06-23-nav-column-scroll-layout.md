---
index: "[[Rhythm]]"
date: 2026-06-23
repo: Rhythm
tags: [decision, Rhythm]
---

# Decision: Nav column layout — SingleChildScrollView middle region

## Context

`AgentsNavColumn` has a header (pinned) + footer (pinned) + a middle region containing:
CHATS controls, session list, and a TOOLS section with 8 rows. At short window heights
(e.g., 680px) the TOOLS section exceeded the available flex space, causing a RenderFlex
overflow. The fix needed to make the middle region scrollable while keeping header/footer pinned.

The nav column Container is placed as a non-flex child inside the `Row` in `_buildWorkspace`
with the default `CrossAxisAlignment.center`. This gives it **loose** height constraints from
the Row, meaning `Expanded` children in the nav column's `Column` cannot resolve their
allocation (no target height to fill).

## Decision

Use `Expanded(SingleChildScrollView(Column([SessionListBody(shrinkWrap:true), Divider, _ToolsSection])))` for the middle region. The search field, CHATS controls, session list, and TOOLS section all scroll together inside a `SingleChildScrollView`. Header and footer are Column siblings outside the `Expanded`.

Also add `crossAxisAlignment: CrossAxisAlignment.stretch` to the workspace Row so the nav column Container receives tight height constraints, which is required for the outer Column's `Expanded` to allocate height correctly.

## Alternatives considered

1. **Nested `Expanded(inner_Column([Expanded(SessionListBody), Divider, _ToolsSection]))` with stretch** — tried first. Worked for normal rendering but still overflowed during the Flutter test teardown frame (when `pumpWidget(SizedBox())` shrinks constraints to near-zero). The `_EmptyChatsState` Center+Padding+Column structure has fixed-height content that overflows any container < 91px regardless of Column flex semantics.

2. **`height: double.infinity` on Container** — would require the Row to have a finite maximum height to clamp against. Risky: if the Row's height is determined by its tallest child in some edge case, `double.infinity` propagates as unconstrained height and Flutter throws a layout assertion.

3. **`SliverFillRemaining` in CustomScrollView** — tried earlier in the session. `SliverFillRemaining` must be the LAST sliver, making it impossible to put TOOLS below the session list in the same viewport without intrinsic-dimension errors (viewport does not support intrinsic dimension computation).

4. **CustomScrollView with `SliverList` + `SliverToBoxAdapter(child: _ToolsSection)`** — structurally sound, but adds complexity and requires the session list items to be lifted into SliverList form.

## Consequences

- **Middle region scrolls as one unit** — CHATS controls, session list, and TOOLS all scroll together, matching the Odysseus design intent.
- **Header + footer always visible** — they are Column siblings outside the scroll.
- **`shrinkWrap: true`** on `SessionListBody` is required to prevent the inner ListView from trying to fill unbounded height inside the scroll view.
- **`CrossAxisAlignment.stretch` on workspace Row** — all Row children (AgentsNavColumn, TranscriptPanel, SessionSidePanel, InspectorResizeHandle) now receive tight height. This is semantically correct; all panels should fill the available workspace height.
- **No intrinsic dimension issues** — `SingleChildScrollView` + `Column` + `shrinkWrap ListView` all support intrinsic dimension computation; no assertions thrown at any height.
