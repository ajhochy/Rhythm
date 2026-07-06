---
date: 2026-07-06
repo: Rhythm
tags: [decision, Rhythm]
index: "[[Rhythm]]"
---

# Hand-edit the generated opencode SDK types for the new CompactionLoopError variant

## Context

Issue #913 requires a new `MessageV2.CompactionLoopError` (added to
`apps/opencode_fork/packages/opencode/src/session/message-v2.ts`, alongside
`ContextOverflowError`/`APIError`) so `SessionCompaction.processCompaction` can
publish a distinct bus error when the auto-continue cap is hit. That error
must join `AssistantErrorSchema`, the discriminated union backing
`MessageV2.Assistant.error` and `Session.Event.Error`.

`apps/opencode_fork/packages/sdk/js/src/v2/gen/types.gen.ts` hand-mirrors that
same union (`AssistantMessage.error`, `EventSessionError.properties.error`) as
plain TypeScript types — it is openapi-ts output generated from the running
server's Effect HttpApi schema, not derived automatically from
`message-v2.ts` at build time in this repo checkout. Adding
`CompactionLoopError` to the Effect schema without updating this file broke
`bun run typecheck` in three places (`src/share/share-next.ts`), because that
file's zod/plain-type consumers pattern-match on the full literal union of
error `name`s.

No SDK regeneration script could be run offline in this sandboxed worktree —
generation depends on introspecting a running server's live schema
(`packages/opencode/script/generate.ts` only regenerates the unrelated
models.dev snapshot, not this openapi surface).

## Decision

Hand-add the `CompactionLoopError` type and its two union memberships to
`types.gen.ts`, following the exact shape of the six existing sibling error
variants (`UnknownError`, `MessageAbortedError`, `StructuredOutputError`,
`ContextOverflowError`, `ApiError`, `ProviderAuthError`) already hand-mirrored
there. Did not touch the separate v1 `sdk/js/src/gen/types.gen.ts` — that
file's error union is already missing `StructuredOutputError`/
`ContextOverflowError`, confirming it is a stale/independent snapshot that
was never kept in sync with the v2 message schema, so adding the new variant
there would not match existing precedent.

## Alternatives considered

- Regenerate the SDK from a live server: not runnable in this environment
  (requires bootstrapping and introspecting a running opencode server); out
  of proportion for a one-variant addition to a bugfix.
- Skip publishing a typed `Session.Event.Error` and use a raw
  `NamedError.Unknown` instead (already used elsewhere for ad hoc bus
  errors): rejected because the design explicitly asks for a distinct,
  named error class so `opencode_stream_bridge.ts` (and any future consumer)
  can discriminate on `error.name === "CompactionLoopError"` rather than
  parsing a message string.
- Leave `message-v2.ts` untouched and stuff the loop-exhaustion signal into
  an existing error type's `message` field: rejected because it collapses a
  distinct failure mode into a lookalike of context-overflow/generic-API
  errors, which is exactly the ambiguity issue #913's fix is trying to remove
  from the auto-continue path.

## Consequences

- `message-v2.ts` and `types.gen.ts` now both require a manual, matching edit
  any time a new `Assistant.error` variant is added — this was already true
  before this change (six variants already require dual maintenance); this
  fix does not introduce the pattern, it follows it.
- If the SDK is regenerated from a live server in the future, the generator
  output should reproduce exactly what was hand-added here (same field
  names/shape as the Effect schema), so no drift is expected — but this
  should be spot-checked the next time real SDK regeneration runs.
