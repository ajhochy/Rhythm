---
tags: [decision, rhythm, opencode-fork, agents]
date: 2026-06-27
---

# SyncEvents never reach /event: dual-bus split, not serialization (#762 re-diagnosed)

## Context

Agent sessions exhibited three recurring regressions: (1) duplicate messages,
(2) ask-question tool hangs, (3) context/token usage never displays. Issue #762
hypothesized the cause was SSE serialization: `message.updated` /
`message.part.updated` are `SyncEvent`s whose raw Effect `Schema.Class` payloads
"do not survive JSON serialization to the /event wildcard stream", while
`session.updated` works because its `convertEvent` reconstructs a plain payload
from the DB row.

We implemented that fix (convertEvent cases reconstructing plain payloads, mirroring
session.updated) and it passed unit/bus-level tests. Then we built the fork
(`bun run build --single`, arm64), ran a real anthropic turn against it, and
captured `/event`.

## Finding (verified at runtime)

The convertEvent fix did NOT make the events appear on `/event`. The engine log
showed `message.updated` (×6) and `message.part.updated` (×5) WERE published to
the bus — yet none reached the live `/event` subscriber. Crucially, turn-time
`session.updated` (via `sync.run`) ALSO failed to reach `/event`, while
`message.part.delta` (a BusEvent) did. So the discriminator is not the event
payload — it is the **publish path**.

`busId` diagnostics (tagging each Bus state instance) proved a **dual-bus split**:

- `/event` subscribes to bus state **A** (per-request DI `Bus.Service`).
- `message.part.delta` is published via `bus.publish(...)` (`session.ts:839`,
  the same per-request DI `Bus.Service`) → bus **A** → arrives.
- `SyncEvent.process()` publishes via `ProjectBus.publish` (`sync/index.ts:333`),
  where `ProjectBus = Bus` (the namespace, line 4). The namespace `Bus.publish`
  runs over a **module-level `makeRuntime(Service, layer)`** bus → bus state
  **B** → never seen by the `/event` subscriber.
- The one `session.updated` that did reach `/event` was published via
  `bus.publish(Event.Updated)` (`session.ts:578`, DI) during POST /session, not
  via `sync.run`.

`Bus.layer` builds its wildcard PubSub inside an `InstanceState` ScopedCache, and
instance layers are provided per-request (`provideInstanceContext` middleware),
so the DI bus and the module-runtime bus hold separate caches → separate
wildcards for the same directory.

## Decision

- The `convertEvent` reconstruction is correct, harmless hardening (SSE needs
  plain payloads) and is KEPT, but it is explicitly NOT the fix for #1/#3.
- The real fix is to route `SyncEvent.process()`'s publish through the
  per-request DI `Bus.Service` (the bus `/event` actually reads), or to make the
  bus a true per-directory singleton shared by the namespace runtime and DI.
  This is core-engine work and is surfaced to the user as a scope decision rather
  than attempted blind, because each verify cycle requires a fork rebuild + real
  turn and the change carries cross-cutting regression risk.

## Alternatives considered

- Trust the unit suite (bus-level test passed): rejected — it cannot reproduce
  the split, which only manifests across HTTP requests in the running server.
  This is exactly the false-green the project has been burned by before.
- Revert the convertEvent change: rejected — it is correct and a prerequisite
  once SyncEvents are routed to the right bus.

## Consequences

- #762's "serialization" framing is wrong; updated with this finding.
- A new issue tracks the dual-bus split (real root of #751/#759/#761/#762/#1/#3).
- The #2 ask-question hang is independently fixed (question.list recovery poll in
  the bridge) because `question.asked` is a BusEvent on the DI bus and the
  recovery uses HTTP `GET /question`, both unaffected by the split.

## Repro (for the follow-up)

```
BIN=apps/opencode_fork/packages/opencode/dist/opencode-darwin-arm64/bin/opencode
"$BIN" serve --port 4096 --hostname 127.0.0.1 &
curl -sN "http://127.0.0.1:4096/event?directory=$DIR" > cap.txt &
SID=$(curl -s -X POST ".../session?directory=$DIR" -d '{"title":"x"}' | jq -r .id)
curl -s -X POST ".../session/$SID/message?directory=$DIR" \
  -d '{"model":{"providerID":"anthropic","modelID":"claude-haiku-4-5-20251001"},
       "parts":[{"type":"text","text":"Reply with exactly PONG."}]}'
# grep cap.txt for message.updated → absent until the bus-routing fix lands.
# tail ~/.local/share/opencode/log/*.log for "publishing type=message.updated".
```
