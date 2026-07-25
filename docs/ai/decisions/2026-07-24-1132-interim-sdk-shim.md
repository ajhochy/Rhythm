---
tags: [decision, rhythm]
date: 2026-07-24
issue: 1132
index: "[[Rhythm]]"
---

# #1132 interim: shrink the hand-written SDK d.ts via selective re-export; defer the full fork-dist flip

> **Superseded on 2026-07-24 by the permanent #1132 implementation.**
> `bun run build:rhythm` now produces and vendors the complete fork-generated
> package; `api_server` consumes it through a normal `file:` dependency; the
> ambient declaration described below has been deleted. This document remains
> as the record of the interim constraint and why the permanent build was
> necessary.

## Context

#1132 ("fork emits its own complete SDK types — real OCU-27 fix") asks for the
hand-written `apps/api_server/src/@types/opencode-ai-sdk.d.ts` (903 lines) to
be deleted and replaced with a thin re-export shim over a **built** fork SDK
`dist/`, migrating the ~12 files that depend on the current flat `Message`/
`Part` shapes to the fork's v2 `Message = UserMessage | AssistantMessage`
discriminated union and `permission.asked/.replied` events.

Two things blocked doing that literally in this run:

1. **The fork's SDK package (`apps/opencode_fork/packages/sdk/js`) ships only
   unbuilt ESM `.ts` source — no `dist/`.** Producing one requires
   `bun ./script/build.ts`, which boots the actual engine (`bun dev generate`)
   to regenerate `openapi.json` before compiling. That's a bun/Effect
   toolchain dependency, separate from api_server's Node 22 tsc, and it
   mutates committed generated source (`clean: true`) — a legitimate but
   engine-coupled, higher-variance chunk of work better done at the next
   `git subtree pull` rebase boundary (see
   `docs/ai/decisions/2026-06-25-opencode-fork-vendoring.md`), not batched.
2. **`#1156` (`fix/1156-delegated-permission-gate`) is concurrently editing
   `opencode_stream_bridge.ts`**, which imports `Event`/permission types from
   `@opencode-ai/sdk`. A full flip rewrites this file's type imports and
   `.parts`/permission-event access patterns — guaranteed textual collision.

## Decision

**Ship the interim slice only: shrink the d.ts from 903 → 660 lines by
re-exporting every leaf type that is structurally identical (or a safe
optional-fields superset) to the real, already-installed
`@opencode-ai/sdk@1.14.49` generated types, and keep everything else
hand-written.** No consumer file changed an import line; no runtime code
changed.

Mechanism: this project's tsconfig uses `"module": "commonjs"`, which makes
TS use classic/Node10 module resolution. That resolution mode does **not**
consult a package's `"exports"` map — it walks `node_modules` by file path
directly. So while the bare specifier `@opencode-ai/sdk` still can't resolve
(no top-level `main`/`types` field, only `exports`), a concrete deep path
like `@opencode-ai/sdk/dist/gen/types.gen` resolves fine and can be re-exported
from inside the ambient `declare module '@opencode-ai/sdk' { ... }` block.
Verified empirically with a scratch probe file before committing to the
approach.

**Re-exported from the real generated types** (verified field-for-field, or
the real type is a strict optional-fields superset): `FileDiff`, `Todo`,
`ProviderAuthAuthorization`, `SessionStatus`, `Permission`, `Pty`,
`CompactionPart`, `Session`, `ApiAuth`, `OAuth` (aliased as legacy
`OAuthAuth`), `WellKnownAuth`, `Auth`, `EventFileEdited`,
`EventSessionCompacted`, `EventPermissionUpdated`, `EventTodoUpdated`,
`EventSessionDiff`, `EventMessageRemoved`, `EventMessagePartRemoved`,
`EventSessionStatus`, `EventSessionIdle`, `EventSessionCreated`,
`EventSessionUpdated`.

**Kept hand-written** (real generated shape has genuinely diverged from what
this codebase's runtime bridge actually parses off the live fork's wire
events, or is fork-only and absent from the official build entirely):

- `Message`/`AssistantMessage`/`Part`/`TextPart`/`ReasoningPart`/`ToolPart`/
  `PartInput` — the real generated `Message = UserMessage | AssistantMessage`
  has **no flat `.parts` field at all** (parts arrive via a separate
  `message.part.updated` event), and the real `ToolPart`/`ReasoningPart`
  shapes (`callID`/`tool`/`state`, `text`/`metadata`/`time`) don't match the
  flat shapes (`name`/`input`/`result`, `signature`/`content`) this codebase's
  bridge assembles from the live fork engine. This is the exact breakage
  surface the full flip would need to migrate across ~12 files — untouched
  here.
- `EventPermissionAsked`, `EventQuestionAsked`/`Replied`/`Rejected`,
  `EventMessagePartDelta` — fork-only; the official v1 build's `Event` union
  doesn't declare `permission.asked` or any `question.*`/`message.part.delta`
  event at all (confirmed: `permission.replied` exists officially,
  `permission.asked` does not).
- `SdkAgent` — the official `Agent` type requires `permission.bash` as a
  fixed record and has no index signature; the engine supports ~17 permission
  keys plus arbitrary custom ones, which `SdkAgent`'s index signature covers.
- `McpStatusEntry`, `McpLocalConfigInput`, `McpRemoteConfigInput` — the
  official `McpStatus` is a 5-variant discriminated union (this codebase reads
  a flat `{status, error?}` shape instead), and the `*Input` names
  deliberately distinguish the POST `/mcp` request-body shape from the
  official `McpLocalConfig`/`McpRemoteConfig` config-file shape.
- `EventSessionError` — kept `error?: Record<string, unknown>` (loose) rather
  than the official 5-member tagged error union, because several tests
  construct ad-hoc `{ message: '...' }` error payloads that wouldn't satisfy
  the stricter official union.
- The entire `OpencodeClient` interface and the `declare module
  '@opencode-ai/sdk/v2/client'` block — the official SDK's real client classes
  use a generic `Options<Data, ThrowOnError>` / `RequestResult<Responses,
  Errors, ThrowOnError, "fields">` surface, not the flat
  `{path, body, query} → Promise<{data?, error?}>` facade every consumer in
  this codebase actually codes against. `V2OpencodeClient`
  (question/skills) is a hand-rolled minimal facade over the same wire calls
  the official v2 class makes, kept for the same reason (confirmed the
  official `dist/v2/gen/sdk.gen.d.ts` genuinely has `question.list/reply/
  reject` and `app.skills()` now — but as class methods with the generic
  envelope, not a drop-in type match).

## Alternatives considered

- **Full flip in this PR** (delete the d.ts, build the fork's SDK dist,
  migrate all ~12 flat-shape consumers to the discriminated `Message` union
  and `permission.asked/.replied`): rejected for a batched/mega-PR context —
  engine-boot-coupled build step, ~12-file regression surface, and a
  guaranteed textual collision with #1156's concurrent edits to
  `opencode_stream_bridge.ts`. This is exactly the false-green regression
  class the #948 postmortem and PR #1129 established empirically: passing
  `tsc` + unit tests is not proof the live behavior survived a type-shape
  migration.
- **Wholesale re-export of every type, including `Message`/`Part`/
  `OpencodeClient`**: attempted first, rejected on inspection — the official
  generated `Message`/`Part`/`ToolPart` shapes structurally diverge from what
  every consumer file reads (no flat `.parts`), so this would have failed the
  `tsc` gate (or worse, silently type-checked against the wrong shape if
  `skipLibCheck`/structural laxity let it through, then broken at runtime).
- **`file:` workspace dependency on the fork's SDK package**: not
  re-attempted here — already rejected in
  `docs/ai/decisions/2026-07-18-ocu27-sdk-types-adoption.md` (no `dist/`,
  ESM-only unbuilt source, would require adding the fork to api_server's
  build pipeline, which AGENTS.md forbids).

## Consequences

**Satisfied (#1132 ACs met by this interim):**
- d.ts materially shrunk (903 → 660 lines, −27%) by removing genuine
  duplication with the official build.
- Zero consumer import-line changes; zero runtime behavior changes — safe to
  batch alongside #1133/#1156.
- `tsc --noEmit` (via `npm run build`) clean.
- Full `vitest run`: 3106 passed, 21 failed — all 21 match the pre-existing
  documented baseline exactly (18 `memory_*` vault fixture-path failures + 3
  `engraph` PATH-discovery failures), zero new failures.

**Explicitly deferred (#1132 ACs NOT met — tracked for the fork-rebase-boundary
PR):**
- The hand-written d.ts is **not deleted** — a real `OpencodeClient` surface
  remains hand-authored (by design; see Decision above).
- The fork's own SDK (`apps/opencode_fork/packages/sdk/js`) is **not built**;
  no `dist/` vendored. `bun ./script/build.ts` was not run in this slice.
- The ~12 files depending on flat `Message.parts` / `permission.updated` /
  the legacy `ToolPart`/`ReasoningPart` shapes are **not migrated** to the
  fork's v2 discriminated-union model. This remains the load-bearing,
  engine-coupled work item for the next `git subtree pull` rebase boundary.
- Criterion (d) of the acceptance contract (fork build green) is N/A/waived
  for this interim slice per the approved scope.

**Risk carried forward:** every future edit to `opencode-ai-sdk.d.ts` should
re-run this same "does a bare re-export of the official type compile clean"
check before adding new hand-written duplication — the file will drift back
toward 900+ lines if new SDK surface is copy-pasted instead of re-exported
where the official shape is actually compatible.
