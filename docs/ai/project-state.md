# Project State

## Current focus

**2026-06-27 — Agent live-streaming: root cause re-diagnosed.** Runtime smoke
against the BUILT fork overturned #762's serialization hypothesis. The real
defect is a **dual-bus split**: `SyncEvent.process()` publishes via the
module-level namespace `Bus` runtime while `/event` (and BusEvents like
`message.part.delta`) use the per-request DI `Bus.Service`. They are different
bus states for the same directory, so every deferred SyncEvent publish during a
turn (`message.updated`, `message.part.updated`, and `session.updated` via
`sync.run`) lands on a wildcard the live `/event` subscriber never reads.

Net effect on the three symptoms:
- **#1 duplicate messages / #3 no token-context** — still BROKEN at runtime,
  because `message.updated` never reaches the api_server bridge. The #762
  convertEvent change is correct hardening but insufficient; the bus-routing fix
  is the real prerequisite.
- **#2 ask-question hang** — FIXED (question recovery; see below).

## Active branch / PR

- **Branch:** `fix/issue-761-agents-ui-render` — contains #760 (merged) + #761 +
  the #2 question-recovery fix + #762 convertEvent hardening + new tests.
  Commit `fix(agents): recover missed ask-questions; harden message SyncEvent…`.
- **No combined "fixes #762" PR opened** — the headline fix does not work at
  runtime; surfaced to the user as BLOCKED pending the core bus-routing fix.
- Standalone PRs [#760](https://github.com/ajhochy/Rhythm/pull/760),
  [#763](https://github.com/ajhochy/Rhythm/pull/763), and #758 remain open.

## Root cause (verified against the built fork — see decisions/)

`apps/opencode_fork/.../sync/index.ts:333` — `SyncEvent.process()` does
`ProjectBus.publish(...)` where `ProjectBus = Bus` (namespace, line 4). The
namespace `Bus.publish` runs over a module-level `makeRuntime(Service, layer)`
bus, distinct from the per-request DI `Bus.Service` that the `/event` handler
and `bus.publish(message.part.delta)` (session.ts:839) use. busId diagnostics on
the running fork proved it: `/event` subscribed busId A; `message.part.delta`
published to A (arrived); `message.updated`/`part.updated`/`session.updated`
published to B (never arrived). **Fix direction:** route
`SyncEvent.process()`'s publish through the per-request DI `Bus.Service` (or make
the bus a true per-directory singleton shared by both accessors).

## Test status

- opencode_fork: `tsgo --noEmit` PASS · `bun test test/server/ test/bus/` 236
  pass / 1 skip / 0 fail (incl. new httpapi-event-sync-message flow test).
- api_server: `vitest run` 1278 pass / 0 fail (incl. new opc_question_recovery 5).
- desktop_flutter: `flutter analyze` clean (errors), `flutter test
  test/features/agents/` 446 pass (incl. new issue_762_live_turn_e2e).
- **Runtime smoke (built fork, real anthropic turn): #762 FAILED** —
  message.updated/part.updated still absent from /event with the convertEvent
  fix. This is the evidence the unit suite could not surface.

## Next step (needs user decision)

1. Authorize the core bus-routing fix (route SyncEvent publishes through the DI
   `Bus.Service`), then re-smoke the built fork. This fixes #1/#3 (and is the
   true root of #751/#759/#761/#762).
2. OR split the #2 question-recovery fix into its own PR now (complete + tested)
   and track the bus-routing fix separately.
3. Update issue #762 with the corrected root cause; file a new issue for the
   dual-bus split.
