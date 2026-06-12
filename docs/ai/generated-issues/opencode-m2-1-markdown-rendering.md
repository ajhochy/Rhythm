# OPC-M2-1 — Markdown rendering in chat bubbles

**Milestone:** M2 — Rendering parity
**Branch:** `opc-m2-1-markdown-rendering`
**Depends on:** OPC-M1-3

## Summary

Assistant text parts render as markdown instead of raw `SelectableText` characters: headings,
bold/italic, inline code, fenced code blocks (monospace, surface-muted background, copy
button), ordered/unordered lists, and links (open via `url_launcher`). Text stays selectable.
Streaming deltas continue to append without re-rendering sibling bubbles.

## Motivation

Audit B BROKEN list: "markdown not rendered (SelectableText raw chars)". Every OpenCode client
renders assistant markdown; raw `**bold**` and ``` fences read as garbage to church staff.

## Decision (resolved 2026-06-12, plan open question 2)

Package: **`gpt_markdown`** — chosen for streaming-delta-friendly rendering (assistant text
arrives as `message.part.delta` appends). Criteria below remain package-agnostic; if
`gpt_markdown` cannot satisfy a criterion (e.g. selectability), surface that before swapping
packages rather than weakening the criterion.

## Likely files

- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` (`_ChatBubble` text branch)
- `apps/desktop_flutter/lib/features/agents/views/_markdown_message_body.dart` (new)
- `apps/desktop_flutter/pubspec.yaml` (add `gpt_markdown`)

## Acceptance criteria

1. A text part containing `# h`, `**bold**`, `` `code` ``, a fenced block, a list, and a link renders: no literal `**`/backtick/`#` characters findable as raw text; code block uses a monospace TextStyle; link tap invokes the (injected/mocked) launcher with the URL.
2. Fenced code block shows a copy affordance; tapping copies the block content to the clipboard (widget test via `Clipboard` mock).
3. User-role messages render as plain text (no markdown interpretation of user input).
4. Streaming: appending a delta to the last text part updates the rendered output without throwing and preserves earlier bubbles' widgets (no full-list rebuild assertion via keys).
5. All colors/typography come from `RhythmColorRoles` tokens (review check; widget test asserts code-block background == `context.rhythm.surfaceMuted`).
6. `flutter analyze`, `dart format`, full `flutter test` green; `ai-workflow checks --level pr` exits 0.
   _(Former criterion 6 — mini-bubble reuse — removed: the bubble overlay is deleted in OPC-M1-3.)_

## Required tests (flutter test)

- New `test/features/agents/opc_m2_1_markdown_test.dart` covering criteria 1-4 (+5 token assert).

## Out of scope

- Reasoning parts (M2-2). Diff rendering (M2-3). LaTeX/math support.
