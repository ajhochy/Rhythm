---
date: 2026-07-06
repo: Rhythm
branch: issue-912-913-opencode-continuity
pr: (open against main — Fixes #912, Fixes #913)
issues: [912, 913]
status: verified-local
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #912 + #913 — opencode session-continuity fixes + agent-system audit

Advisor session: resolve #912/#913 (verified against real session
transcripts), audit Agent Profiles + delegation + skill/MCP scoping, and test
against the built fork engine.

## Transcript verification (before coding)

- **#913 confirmed** from row-level evidence in `rhythm.db` + the engine DB
  (`~/.local/share/opencode/opencode-feature-dual-anthropic-accounts.db`):
  session `edd203b7…` received **21** synthetic "Continue if you have next
  steps…" injections in ~9m36s (plus 21 paired empty inputs — 42 non-human
  inputs), terminal `tool_use…without tool_result` 400 on a completed `read`
  call, two real user questions about the error never answered, and no cap
  (manual abort did not stop it). Issue's "compaction replay severs tool
  pairs" theory was **refuted**; real fuel is bodyless-400→overflow
  misclassification re-triggering compaction.
- **#912 confirmed** as an observable event but the issue's root cause was
  **refuted**: not an OpenAI server error and not a resume/idle bug. The
  string is client-side Vercel AI SDK stream bookkeeping
  (`reasoning part rs_x:0 not found`) thrown when a reasoning delta arrives
  for an id with no `-start` in the same request; the fork re-threw it and
  killed the turn. Occurred 2m50s into the FIRST turn of a fresh session.
  Single occurrence across all DBs.

## Files changed

Fork (`apps/opencode_fork`):
- `packages/opencode/src/session/processor.ts` — `isSpuriousStreamPartError`
  predicate + swallow-and-warn in the stream `case "error"` branch (#912).
- `packages/opencode/src/session/compaction.ts` — `AUTO_CONTINUE_CAP` +
  `autoContinueExhausted()`; cap wired into the auto-continue branch,
  `CompactionLoopError` published on exhaustion, replay parts tagged (#913).
- `packages/opencode/src/session/message-v2.ts` — `CompactionLoopError`
  NamedError + union membership (required for the bus publish to typecheck).
- `packages/opencode/src/provider/transform.ts` — `repairToolPairing()` at
  the `ProviderTransform.message` chokepoint (anthropic/vertex) (#913).
- `packages/opencode/src/provider/error.ts` — narrowed `isOverflow()` so a
  bodyless 400 is overflow only for cerebras/mistral, not universally (#913).
- `packages/sdk/js/src/v2/gen/types.gen.ts` — hand-mirrored
  `CompactionLoopError` into the generated SDK types (see decisions).
- Tests: `test/session/compaction.test.ts`, `test/provider/transform.test.ts`,
  `test/provider/error.test.ts` (new), `test/session/message-v2.test.ts`,
  `test/session/processor-spurious-error.test.ts` (new).

api_server:
- `src/services/opencode_stream_bridge.ts` — `errorClass: 'tool_pairing'` +
  human-readable message on the tool-pairing 400 in `case 'session.error'`,
  flowing into both the broadcast frame and DB persistence (#913).
- `src/__tests__/opencode_stream_bridge.test.ts` — +2 tests.

## Checks run

- api_server: `npx tsc --noEmit` EXIT=0; `npm test` 2405 passed / 1 skipped.
- fork: `bun test` (5 targeted suites) 330 pass / 0 fail; `bun run typecheck`
  clean except pre-existing `system.test.ts` (byte-identical to origin/main).
- Build: fork `bun run build --single` RC=0; api_server `npm run build` RC=0.
- Live-engine (BUILT fixed binary, :4012): real delegation with tool call
  completed clean — no pairing-400, no reasoning-part error, no APIError.
- GitNexus: both agents reported LOW risk / 0 affected processes.

## Notes / decisions / follow-ups

- Decision: hand-mirror `CompactionLoopError` into the generated SDK types
  (no offline regen) — see `docs/ai/decisions/2026-07-06-compaction-loop-error-generated-sdk-types.md`.
- Deferred (#912): retry-with-stripped-reasoning fallback — only build if the
  swallow proves insufficient against live traffic.
- Optional deeper live check not run this session: stub OpenAI Responses /
  Anthropic servers to fault-inject the exact error triggers; the 330 unit
  tests cover the fault paths, and a clean live regression pass was captured.
- **Agent-system audit** produced 10 follow-up issues (#914–#923): delegation
  caller spoofing, 60s delegation timeout → duplicate runs, scope fail-open,
  nonexistent tool/server names in allowlists, model-binding fixes, profile
  hygiene, delegation robustness, trigger-path bypass, 401 MCP servers, minor
  cleanups. To be fixed on a separate `agent-profiles-audit-fixes` branch.
  Verified-healthy (no issue): scope write-path (#765/#774/#775), child status
  mapping (#751), shared `resolveProfileScope`.
