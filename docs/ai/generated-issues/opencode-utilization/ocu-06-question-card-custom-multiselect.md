---
date: 2026-07-11
repo: Rhythm
branch: ocu-06-question-card-custom-multiselect
status: ready-for-coding
issues: [1047]
order: 06
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m1-interaction-polish]
---

# OCU-06 — QuestionToolCard — free-text (custom) and multi-select (multiple) support

## Summary

The engine question schema supports per-question `multiple` (multi-select) and `custom` (free-form answer allowed, default true). The Flutter QuestionToolCard renders option buttons only, degrading agents asking open questions. This issue adds support for both flags: custom free-text answers and multi-select checkboxes.

## Scope (in)

- Honor `custom`: render an "Other…" affordance expanding to a text field whose submission sends the typed string as that question's answer
- Honor `multiple`: checkbox-style multi-select with the existing staged "Submit (n/m)" flow, allowing option+custom combinations
- Parse both flags from the authoritative question.asked payload (questionsForCallId) and tool-args fallback

## Non-goals (out)

- No backend changes (reply path already accepts string[][])
- No redesign of single-select fast path
- No changes to production user data; local agent-server (port 4001) surface only unless the spec says otherwise

## Likely files

- apps/desktop_flutter/lib/features/agents/views/_question_tool_card.dart
- apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart
- apps/desktop_flutter/lib/features/agents/models (question payload model if present)

## Acceptance criteria

- A question with custom=true shows Other… and a typed answer reaches the agent verbatim
- multiple=true allows 0..n options + optional custom string in one submission
- custom=false hides free-text
- existing single-select one-tap flow unchanged
- flutter analyze passes

## Required tests

- Widget tests on the mounted card for the four flag combinations (single/multi × custom on/off) asserting reply payload shape string[][]

## Dependencies

None
