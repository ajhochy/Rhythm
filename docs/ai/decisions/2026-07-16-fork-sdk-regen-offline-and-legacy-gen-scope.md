---
tags: [decision, Rhythm]
date: 2026-07-16
issue: 1067
index: "[[Rhythm]]"
---

# Fork OpenAPI/SDK regen is possible fully offline; only `src/v2/gen` has an active generator

## Context

Issue #1067 (OCU-26) asks to regenerate the fork's checked-in `openapi.json` +
JS SDK so `/skill/reload`, `/config/reload`, and the `session.update`
`mcpAllowlist`/`skillAllowlist` fields are typed. `docs/ai/current-plan.md`
listed both `apps/opencode_fork/packages/sdk/js/src/gen/` (legacy) and
`.../src/v2/gen/` (v2) as candidate output paths.

A prior decision
(`docs/ai/decisions/2026-07-06-compaction-loop-error-generated-sdk-types.md`,
issue #913) states: "No SDK regeneration script could be run offline in this
sandboxed worktree — generation depends on introspecting a running server's
live schema (`packages/opencode/script/generate.ts` only regenerates the
unrelated models.dev snapshot, not this openapi surface)." That agent hand-edited
`src/v2/gen/types.gen.ts` to add a `CompactionLoopError` variant instead.

That premise is incorrect, and this issue's investigation found the real
generator. There are three same-named-ish files, easy to conflate:

- `apps/opencode_fork/script/generate.ts` (repo root) — the actual full regen:
  `bun ./packages/sdk/js/script/build.ts` (builds `src/v2/gen` via
  `@hey-api/openapi-ts`) + `bun dev generate > ../sdk/openapi.json` (regenerates
  the canonical spec) + `./script/format.ts` (repo-wide prettier).
- `packages/opencode/script/generate.ts` — unrelated; only writes
  `models-snapshot.js` (models.dev data). This is the one the prior decision
  found and, reasonably, concluded was the only generator.
- `packages/opencode/src/cli/cmd/generate.ts` — the actual `generate` CLI
  subcommand (invoked as `bun dev generate`). It calls `Server.openapi()` →
  `OpenApi.fromApi(PublicApi)`, a **pure function over the static Effect
  HttpApi route definitions** (`OpenCodeHttpApi` in `.../httpapi/api.ts`). It
  does not start a listener, open a port, or need a live server — it ran
  offline in ~2s in this sandboxed worktree with zero network access.

Confirmed offline: `bun dev generate` from `packages/opencode` produced a
133-operation spec including `app.skills.reload`/`app.config.reload`, matching
the acceptance criteria, with no server process involved.

Also confirmed: only **one** `@hey-api/openapi-ts` `createClient()` call exists
in the whole fork (`packages/sdk/js/script/build.ts`), targeting
`output.path: "./src/v2/gen"` only. `src/gen` (the legacy default
`@opencode-ai/sdk` export target, used by `client.ts`) has no generator
invocation anywhere in this repo snapshot — it is a frozen artifact from the
initial `v1.14.49` vendor import (`f0981434b`), last touched by that commit
only. `src/v2/gen` (used by the `/v2` export, `v2/client.ts`) is the actively
regenerated one — it was already touched by a real fix
(`9b24dda7d`, #912/#913) after the vendor import.

Cross-check: the prior agent's hand-added `CompactionLoopError` type in
`src/v2/gen/types.gen.ts` came out **byte-identical** in this regen (zero diff
on those lines) — the hand-edit matched the real generator's shape exactly.
The canonical `packages/sdk/openapi.json`, however, had never been regenerated
since before that fix landed, so it picked up `CompactionLoopError` (and an
unrelated Effect-registration-order reshuffle of the `Event` schema union
members — `Event.tui.*`, `EventServerConnected`, `EventGlobalDisposed`) as
part of this regen, alongside the #1067-targeted changes. All of this is
static OpenAPI metadata / SDK typings — no runtime behavior changed.

## Decision

1. Ran the real, offline-capable generator: `packages/sdk/js/script/build.ts`
   (regenerates `src/v2/gen/*`, with its own scoped `prettier --write src/gen
   src/v2`) plus a direct `bun dev generate > packages/sdk/openapi.json` run
   (the canonical spec `packages/docs/openapi.json` symlinks to it). Skipped
   root `script/generate.ts`'s trailing `./script/format.ts` step — that runs
   `prettier --write .` across the **entire** fork monorepo, which would have
   produced a massive, unrelated diff outside this issue's scope. The CLI
   generate handler already pre-formats `openapi.json` through prettier before
   writing it (see comment in `src/cli/cmd/generate.ts`: "so output is
   byte-identical to committed file regardless of whether ./script/format.ts
   runs afterward"), so skipping the repo-wide pass does not affect this
   file's formatting.
2. Left legacy `src/gen` untouched. No generator targets it in this repo, and
   hand-writing its equivalent typed methods would repeat the exact mistake
   the prior #913 decision's postscript flagged as a future risk ("this
   should be spot-checked the next time real SDK regeneration runs") and that
   this project's engineering memory already warns against (hand-written SDK
   types caused false-green bugs before). Since nothing in Rhythm imports
   either `@opencode-ai/sdk` or `@opencode-ai/sdk/v2` yet (typed adoption is
   OCU-27 / #1068, out of scope here), leaving `src/gen` stale is inert.

## Alternatives considered

- Run the full root `script/generate.ts` as-is: rejected — its final
  repo-wide `prettier --write .` would reformat unrelated files across the
  whole vendored subtree, far exceeding "regenerate openapi.json + SDK."
- Add a second `createClient()` call targeting `./src/gen` to bring the
  legacy SDK current too: rejected as scope creep — issue #1067 asks to
  regenerate with the fork's *own* tooling, and inventing new codegen wiring
  for a path nothing currently consumes is a different, larger change than a
  regen. Flagging it here so whoever picks up #1068 knows `src/gen` is stale
  and has no generator, rather than assuming it's current.

## Consequences

- `packages/sdk/openapi.json` (133 ops, was 131) and `packages/sdk/js/src/v2/gen/{sdk,types}.gen.ts`
  are the only files this issue changed. `packages/docs/openapi.json` (symlink)
  picks up the change automatically.
- Legacy `src/gen` remains at its `v1.14.49`-import-time shape: it lacks
  `skillReload`/`configReload` methods and the `mcpAllowlist`/`skillAllowlist`
  fields, and lacks `CompactionLoopError`. If OCU-27 (#1068) ever adopts the
  default (non-`/v2`) SDK export, this must be regenerated too — and since no
  generator exists for it, that work should either wire one up (mirroring
  `build.ts` with `output.path: "./src/gen"`) or confirm the fork has fully
  moved consumers to `/v2` and `src/gen` can be deleted.
- The 2026-07-06 decision's "cannot regenerate offline" premise is superseded
  by this one. Not editing that file (it accurately documents what was known
  and decided at the time); this entry supersedes it going forward.
