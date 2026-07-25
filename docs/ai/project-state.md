# Project State

## Current focus

Issue #1132 complete fork-generated SDK implementation is ready for its
coordinator-owned built-engine live smoke.

## Active branch / PR

- Branch: `codex/1132-fork-sdk`
- PR: none; isolated worktree handoff to the 2026-07-24 orchestration run

## In progress

- Complete generated fork SDK is vendored as a normal `api_server` dependency.
- Hand-written SDK ambient declarations are deleted.
- Four raw-fetch SDK gaps are converted to generated v2 calls.
- Acceptance criteria 1–5 pass; criterion 6 has an executable live test and
  awaits the shared sandbox coordinator.

## Risks / known issues

- The fork-wide typecheck has unrelated base failures in
  `GlobalBusEmitter.emit` and missing `AppFileSystem.containsReal`.
- Two fork session timing tests fail in untouched base code. Relevant session
  and API suites are green.
- Do not claim #1132 complete until the isolated built-engine event smoke
  passes and its contract status is updated.

## Test status

- SDK deterministic build/typecheck: PASS.
- API lint/typecheck/build/full suite: PASS (3,184 tests).
- Clean API install and Docker build: PASS.
- Built fork binary/version smoke: PASS.
- GitNexus own-diff analysis: LOW risk, zero affected execution flows.
- Live permission/question/message event smoke: pending coordinator sandbox.
- Full evidence:
  `docs/ai/runs/2026-07-24-1132-complete-fork-sdk.md`.

## Next step

Run `live_e2e_1132_built_sdk_events.test.ts` against the orchestration
sandbox's rebuilt fork + API, mark criterion 6 pass, then integrate this commit.
