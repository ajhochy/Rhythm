# Project State

## Current focus

**2026-06-27 — Agent session live-streaming hardening (#759 + #761 + #762 +
question recovery), stacked on one branch.** The bundled fork opencode engine's
`/event` SSE path is being made fully reliable so a real delegating turn renders
live with no duplicate messages, working context/token display, and a functioning
ask-question flow — covered by end-to-end tests so these stop recurring.

Sub-fixes on this stack (`fix/issue-761-agents-ui-render`):
- **#759/#760** — `/event` stream collapse (eager-PubSub resolution in the SSE
  handler). Merged into this branch from `fix/issue-759-event-sse`.
- **#761** — Flutter live-render workaround (`_ensureLiveAssistantMessage`).
- **#762** — engine `convertEvent` reconstructs plain serializable
  `message.updated` / `message.part.updated` payloads from the DB (mirrors
  `session.updated`), so tokens/cost and the authoritative bubble reach the
  `/event` subscriber. (in progress)
- **#2 ask-question hang** — api_server bridge recovery: poll `question.list`
  to surface a missed `question.asked` as a card. (in progress)

## Active branch / PR

- **Branch:** `fix/issue-761-agents-ui-render` — now contains #760 (merged) +
  #761 (committed) + #762 + question recovery (in progress).
- One combined PR will close #759, #761, #762 and supersede the standalone
  PRs [#760](https://github.com/ajhochy/Rhythm/pull/760) and
  [#763](https://github.com/ajhochy/Rhythm/pull/763). Do not merge — leave for
  review + manual smoke.
- **#758** [PR #758](https://github.com/ajhochy/Rhythm/pull/758) — bridge
  map-miss hardening; complementary defense-in-depth ("refs #751"). Leave as-is.

## In progress

- Implement #762 convertEvent + question recovery; add end-to-end tests at the
  engine, bridge, and Flutter layers.
- Build a signed local smoke app (fork + Flutter + api_server) and drive a real
  delegating turn against the bundled fork; curl `/event` for ground truth.

## Risks / known issues

- **Verification parity:** opencode-engine changes must be verified against the
  **bundled fork** engine, not stock 1.14.40 (`augmentPathForOpencode` prepends
  `~/.opencode/bin`, spawning stock unless the fork is forced — this previously
  masked regressions).
- **Engine unit tests can false-green:** the in-process bus delivers raw
  `Schema.Class` payloads that `JSON.stringify` fine, so a bus-level test does
  NOT reproduce the SSE-serialization drop with plain test fixtures. Ground
  truth for #762 is the runtime curl `/event` capture against the built fork.
- **Env leak:** `RHYTHM_LOCAL_SMOKE` set in a shell makes `agent_trigger_watcher`
  tests fail; unset before running the Flutter suite.

## Test status

- opencode_fork: `tsgo --noEmit` PASS · `bun test test/server/` (217 + #759 +
  #762 flow test) — re-running on the merged stack.
- desktop_flutter: `flutter analyze` / `dart format` / `flutter test
  test/features/agents/` — to re-run on the stack.

## Next step

1. Finish #762 + question-recovery implementation and end-to-end tests.
2. Build signed smoke app; drive a real delegating turn; verify live render,
   no dupes, token/context display, ask-question flow. Curl `/event` for #762.
3. Open one combined PR (closes #759/#761/#762; supersedes #760/#763). Do not
   merge.
