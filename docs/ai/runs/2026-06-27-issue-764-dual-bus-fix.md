---
date: 2026-06-27
repo: Rhythm
branch: fix/issue-761-agents-ui-render
pr: 763
issues: [764]
status: verified
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# #764 — SyncEvent dual-bus split fixed (shared per-directory PubSub)

## Files changed

- `apps/opencode_fork/packages/opencode/src/bus/index.ts` — module-level
  `Map<directory, State>` read-through inside the `Bus.layer`
  `InstanceState.make` factory. The namespace runtime (bus B) and the
  per-request DI `Bus.Service` (bus A) now resolve ONE `{wildcard, typed}` per
  directory. First builder owns creation + the `InstanceDisposed`-publish /
  `PubSub.shutdown` finalizer + shared-map cleanup; a re-check after
  `PubSub.unbounded` keeps the two caches convergent under a fresh-directory
  race.
- `apps/opencode_fork/packages/opencode/test/server/httpapi-event-dual-bus.test.ts`
  — new e2e contract test (`issue-764-c1`): real HTTP `/event` subscriber + a
  namespace `Bus.publish` of `message.updated` / `message.part.updated`. Fails
  on the dual-bus codebase, passes once shared. This is the cross-request
  reproduction the namespace-only `httpapi-event-sync-message.test.ts` could not
  catch.
- `docs/ai/contracts/issue-764.json` — contract.
- `docs/ai/decisions/2026-06-27-syncevent-shared-bus-registry.md` — decision.

## Checks run

- `bun run typecheck` → EXIT 0.
- `bun test test/server/ test/bus/` → 237 pass / 1 skip / 0 fail (incl. the new
  contract test).
- `bun run build --single` (arm64) → EXIT 0, fork `--version` smoke passed.
- **Built-fork real anthropic turn (`claude-haiku-4-5-20251001`), `/event`
  capture:** `message.updated` ×6 AND `message.part.updated` ×5 now present
  (plus turn-time `session.updated` ×3). All three were absent on the dual-bus
  build. This is the gold-standard evidence — the split only manifests across
  HTTP requests on the running server.

## Notes

- Approach chosen over rewiring `SyncEvent` to require `Bus.Service` (which
  propagates `R = Bus.Service` through dozens of `R = never` contracts —
  documented in the prior "Core bus-routing fix — attempted, found
  cross-cutting" state). See the decision file.
- `convertEvent` SSE reconstruction (from the #762 work on this branch) is
  retained — correct hardening and a prerequisite once routing is fixed, but not
  itself the cure.
- Engine-only change; no Flutter/UI edits. UI render confirmation (live agent
  turn, no duplicate messages, working token/context gauge) is the downstream
  manual smoke.
- Folds into PR #763; `Closes #764`. Not merged — left open for human review +
  manual UI smoke.
