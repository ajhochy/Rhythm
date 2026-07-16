---
date: 2026-07-15
repo: Rhythm
branch: (orchestrator-owned)
pr: (pending)
issues: [1091]
status: implemented — awaiting verification-gate
tags: [run, Rhythm]
---

## Files changed
- `apps/opencode_fork/packages/llm/src/protocols/utils/gemini-tool-schema.ts`
  — root-cause fix in `projectNode`.
- `apps/opencode_fork/packages/llm/test/provider/gemini.test.ts`
  — added focused test.

## Root cause
`GeminiToolSchema.convert` (`projectNode`) is the shared Gemini/Vertex tool-schema
projector for ALL tools (via `lowerTool` in `protocols/gemini.ts`). For a node with
a combiner, it emitted `anyOf`/`oneOf`/`allOf` **alongside** sibling keys
(`description`, `type`, `required`, `format`, `enum`, `properties`, `items`,
`nullable`, `minLength`). Vertex rejects this: "when using any_of, it must be the
only field set". An optional param like `budget` serializes as
`{ description, anyOf: [T, {type:null}] }`, tripping the error for `engraph_context`
(and any tool with an optional/union param).

## Fix
When a node has a combiner, `projectNode` now returns only that combiner key with its
branches recursively projected — no sibling metadata. Removed the now-unreachable
`allOf`/`anyOf`/`oneOf` entries from the non-combiner projection block. Fixed once at
the shared conversion point, so every tool (not just `engraph_context`) is corrected.

## Impact analysis (GitNexus)
- `impact(projectNode, upstream)`: **LOW** risk, 1 direct caller (`convert`, same
  file), 0 execution flows, 1 module.
- `detect_changes(unstaged)`: LOW, only `projectNode` touched, 0 affected processes.

## Checks run
- `bun test test/provider/gemini.test.ts` (from `apps/opencode_fork/packages/llm`):
  **12 pass, 0 fail, 26 expect()**. Includes new test
  "emits anyOf as the sole key on an optional param (Vertex #1091)".
- `bun run typecheck` (`tsgo --noEmit`) from same dir: **clean, exit 0**.

## Notes
- The fork `llm` package uses `bun:test`, not vitest (issue mentioned vitest); followed
  the actual repo convention in `gemini.test.ts`.
- A sibling sanitizer exists in `apps/opencode_fork/packages/opencode/src/provider/transform.ts`
  `schema()` (AI-SDK path). It already preserves combiner nodes without adding siblings
  (see its test at transform.test.ts:668) — no change needed there. The Vertex error
  path routes through the `llm` package Gemini protocol, which is what was fixed.
- No running server required (pure schema-shape unit test + typecheck).
- Git (branch/commit/PR) is orchestrator-owned; no git actions taken.
