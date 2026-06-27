---
date: 2026-06-27
repo: Rhythm
tags: [decision, rhythm, opencode-fork, agents]
index: "[[Rhythm]]"
---

# #764 fix: one shared per-directory PubSub for the namespace Bus and the DI Bus.Service

## Context

`SyncEvent.process()` publishes `message.updated` / `message.part.updated`
(and turn-time `session.updated`) through the **module-level namespace `Bus`**
(`makeRuntime(Service, layer)`, bus B), while `/event` and `message.part.delta`
use the **per-request DI `Bus.Service`** (bus A). Each `Bus.layer` build owns a
separate `InstanceState` ScopedCache → a separate `{wildcard, typed}` PubSub for
the same directory. Runtime-verified `busId` diagnostics confirmed the split
(see `2026-06-27-syncevent-dual-bus-split.md`). Net effect: SyncEvent publishes
never reached the live `/event` subscriber → Rhythm duplicate messages (#1) and
empty token/context gauge (#3).

## Decision

Introduce a module-level `Map<directory, State>` in `bus/index.ts`. The
`Bus.layer` `InstanceState.make` factory reads through it: the first runtime to
build the State for a directory creates `{wildcard, typed}`, registers it, and
owns the `InstanceDisposed`-publish + `PubSub.shutdown` finalizer (and removes
its own entry on disposal). Every later build — namespace OR DI — resolves the
same object. A re-check after `PubSub.unbounded` (a fiber yield point) keeps the
two caches convergent if they race on a fresh directory; the loser discards its
throwaway wildcard and adopts the winner's State.

## Alternatives considered

- **Route `SyncEvent.process()` through the DI `Bus.Service`** (capture it in the
  SyncEvent layer, or require `Bus` in `run`/`replay` `R`): rejected — both
  propagate `R = Bus.Service` through dozens of `R = never` service contracts
  (app-runtime, bootstrap, server, compaction, processor, prompt, many test
  harnesses). Engine-architecture sprawl, not a patch. Documented in the prior
  project-state "Core bus-routing fix — attempted, found cross-cutting".
- **Keep the `convertEvent` serialization fix as the cure:** rejected — it is
  correct hardening but inert for this bug; the discriminator is the publish
  path, not the payload shape. Kept as a prerequisite.

## Consequences

- The namespace `publish`/`subscribe`/`subscribeAll`/callbacks keep identical
  signatures; the layer graph and `R = never` contracts are untouched. Contained
  to one file.
- `InstanceDisposed` + PubSub shutdown that `/event`'s
  `Stream.takeUntil(InstanceDisposed)` relies on (#759/#760) are preserved —
  the owning builder still publishes it and shuts the wildcard down.
- Disposal is per-directory-global (the instance-registry invalidates every
  registered cache for a directory together), so owner and reusers are disposed
  as a pair — no stale-shutdown of a still-referenced PubSub.
- Must be verified against the BUILT fork with a real turn; bus-level unit tests
  cannot reproduce the split (it only manifests across HTTP requests).
