---
date: 2026-10-05
repo: Rhythm / apps/opencode_fork
branch: isolated snapshot at 358fb3f1cd3644d4362b19b62b1d4425624b5706
status: pending
tags: [run, rhythm, opencode, session, compaction]
---

# Engine research compaction loop repair

## Scope

Source-only repair in the isolated snapshot. The supplied sanitized CPU handoff identified a pinned prompt repeatedly appending auto-compaction user markers because the pinned-turn filter hid each marker it had just created. No live research database, app, engine, provider, or package operation was used.

## Changed source

- `src/session/compaction.ts` returns the exact created control message and any synthetic replay/continue follow-up identity to its caller.
- `src/session/prompt.ts` admits only those internally-created control/follow-up user messages for the currently pinned run; later ordinary user messages stay excluded. Terminal parent matching follows the currently active internal user rather than the original pinned ID.
- The overflow path stops the current loop if it would auto-compact the same completed assistant again, rather than appending an unbounded marker sequence.
- Focused prompt and compaction tests exercise the actual SessionPrompt/SessionCompaction layers with invented in-memory stream data.

## Impact review

`gitnexus status` reported this isolated checkout as unindexed. No index was created or substituted. Bounded static review found `SessionCompaction.process` is consumed by `SessionPrompt.run`; `SessionCompaction.create` is used there and by the manual HTTP compaction handler, which ignores its return value. Prompt service callers are the existing HTTP/ACP surfaces and test fixtures. Risk is limited to session turn isolation and compaction continuation, so those paths received focused tests.

## Checks

- `bun test test/session/prompt.test.ts --test-name-pattern 'pinned prompt consumes its automatic compaction without admitting a queued user' --timeout 5000`
  - Red against unchanged prompt/compaction source: failed after the test's bounded second-auto-compaction guard, proving the historical re-append path without a large message fan-out.
  - Green after the repair: 1 pass, 0 fail, 11 assertions.
- `bun test test/session/compaction.test.ts --test-name-pattern 'adds synthetic continue prompt when auto is enabled|stops an auto-compaction sequence after the no-progress cap|replays the prior user turn on overflow when earlier context exists|autoContinueExhausted' --timeout 10000`
  - Green: 10 pass, 0 fail, 21 assertions.
- `git diff --check` passed.
- The generated source delta applies cleanly to a fresh archive of baseline `358fb3f1cd3644d4362b19b62b1d4425624b5706` with `git apply --check`.

The pre-existing HTTP `TestLLMServer` fixture could not bind its ephemeral listener in this constrained checkout (`ServeError` / `EADDRINUSE`); the focused regression therefore uses the existing typed LLM stream seam directly and does not launch any server.

## Not run

Heavy engine builds and full suites, application/sandbox startup, live engine/provider verification, CPU-load recovery verification, and package/signing checks remain intentionally unrun while the CPU investigator owns runtime recovery. No persisted-session cleanup or migration was attempted.

## Bounded typecheck correction

Root's serialized package typecheck subsequently found three introduced type errors: a widened compaction status, a generic sync-definition identity comparison, and an invalid `text-delta` fixture property. The final return now preserves an underlying processor `"stop"` (including the blocked-without-error path) and is explicitly typed as `"continue" | "stop"`; the fixture compares sync event type and uses the supported text-only delta shape.

Using `/Users/ajhochhalter/Documents/Codex/2026-10-01/task-11/bounded-serialized-validation.py` with the shared bounded lock:

- Focused pinned prompt: passed, 1 test / 11 assertions.
- Focused compaction continuation, replay, no-progress, and cancellation subset: passed, 13 tests / 30 assertions.
- `bun run typecheck`: passed (`tsgo --noEmit`, exit 0).

The new compaction regression proves a processor `stop` is preserved even when the summary assistant has no error. Full suites, build, runtime, and CPU-recovery qualification remain unrun.
