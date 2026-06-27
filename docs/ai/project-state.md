# Project State

## Current focus

**2026-06-27 — #759: fork opencode `/event` SSE regression fixed (real root
cause of #751).** The bundled fork engine's event stream collapsed right after
`server.connected`, leaving agent sessions stuck on "Starting". Fixed by
resolving the wildcard PubSub eagerly in the `/event` handler. Verified against
the bundled fork engine; PR pending.

## Active branch / PR

- **Branch:** `fix/issue-759-event-sse` (off `main`), commit `003d71074`.
- **PR:** to open — "Fixes #759" (do not merge; leave for review + manual smoke).
- **Related open PR:** [#758](https://github.com/ajhochy/Rhythm/pull/758) —
  durable `sdk_session_id` fallback in the bridge reverse-lookup; correct
  defense-in-depth for the map-miss class, "refs #751" (NOT a fix for the engine
  regression). Leave as-is.

## In progress

- Open the #759 PR and hand off for manual smoke in the packaged `Rhythm.app`
  (requires a release build of the fork binary).

## Risks / known issues

- **Verification parity:** opencode-engine changes must be verified against the
  **bundled fork** engine, not stock 1.14.40 — PATH augmentation
  (`augmentPathForOpencode`) spawns stock unless the fork is forced, which
  previously masked this regression and produced a false PASS on #751.
- **End-to-end (shipped app) still unproven for #759** until a release build
  swaps the rebuilt fork binary into `Rhythm.app` — source-server runtime test
  is the strongest pre-build evidence but not a substitute for packaged smoke.

## Test status

- `npm run typecheck` (opencode_fork, tsgo --noEmit) — PASS
- `bun test test/server/` (opencode_fork) — 217 pass / 1 skip / 0 fail
- `bun test test/bus/ test/acp/event-subscription.test.ts` — PASS
- #759 regression test — passes with fix, **fails on unmodified source** (faithful)
- Runtime curl `/event` A/B vs bundled fork — FIXED stays open + heartbeats/events

## Next step

1. Open PR "Fixes #759" off `fix/issue-759-event-sse`; do not merge.
2. Manual smoke: release-build the fork binary, swap into `Rhythm.app`, run a
   real delegating turn — confirm sessions leave "Starting", messages persist,
   child subagent rows appear.
3. After merge, #751 can be closed as resolved by #759 (symptom) — #758 remains
   independent hardening.
