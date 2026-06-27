# Project State

## Current focus

**2026-06-27 — Agent session live-streaming fix chain (#759 → #761 → #762).**
The fork opencode `/event` stream collapse (#759) is fixed and the Flutter agents
UI now renders assistant responses live (#761). One deeper engine bug remains
open (#762). Net: agent sessions leave "Starting", messages persist, and
responses stream into the UI live.

## Active branch / PR

- **#759** `fix/issue-759-event-sse` → PR [#760](https://github.com/ajhochy/Rhythm/pull/760)
  "Fixes #759" — engine `/event` eager-PubSub fix. Verified; **not merged**.
- **#761** `fix/issue-761-agents-ui-render` (commit `6695317f2`) → PR to open
  "Fixes #761" — Flutter live-render fix. Verified; **not merged**.
- **#758** [PR #758](https://github.com/ajhochy/Rhythm/pull/758) — bridge map-miss
  hardening; complementary defense-in-depth ("refs #751"). Leave as-is.

## In progress

- Manual smoke of the combined build `/Applications/Rhythm-fix-smoke.app`
  (engine #759 + Flutter #761 + api_server): confirm a turn's response renders
  live without switching sessions.
- Open the #761 PR.

## Risks / known issues

- **#762 (open):** fork `/event` drops `message.updated` & `message.part.updated`
  (SyncEvents reach the bus but not the wildcard `/event` stream;
  `session.updated` works because its `convertEvent` reconstructs a plain
  payload). Until fixed, live token/cost/model-backfill rely on a REST refetch
  on session reselect — #761 restores live text only.
- **Verification parity:** opencode-engine changes must be verified against the
  **bundled fork** engine, not stock 1.14.40 (`augmentPathForOpencode` hides the
  fork).
- **Env leak:** `RHYTHM_LOCAL_SMOKE` set in a shell makes `agent_trigger_watcher`
  tests fail; unset before running the Flutter suite.

## Test status

- opencode_fork: `tsgo --noEmit` PASS · `bun test test/server/` 217 pass · bus tests PASS
- desktop_flutter: `flutter analyze` PASS · `dart format` PASS · `flutter test test/features/agents/` 445 pass (env corrected)
- #759 + #761 regression tests both verified failing on unmodified source
- Runtime: #759 `/event` A/B vs bundled fork PASS; #761 verified via live WS capture + controller contract

## Next step

1. Smoke `/Applications/Rhythm-fix-smoke.app`: send a turn, confirm the assistant
   reply appears live (no session switch needed). Tokens/cost may lag until #762.
2. Open PR "Fixes #761"; leave #760 and #761 for review/merge (do not merge).
3. Decide whether to fix #762 (engine `convertEvent` for message.updated/part.updated)
   for fully-live tokens/cost and other `/event` HTTP subscribers.
