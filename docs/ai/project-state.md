# Project State

## Current focus

Issue #1132 complete fork-generated SDK implementation has passed independent
compiled-engine behavioral verification and is ready to integrate.

## Active branch / PR

- Branch: `codex/1132-fork-sdk`
- PR: none; isolated worktree handoff to the 2026-07-24 orchestration run

## In progress

- Complete generated fork SDK is vendored as a normal `api_server` dependency.
- Hand-written SDK ambient declarations are deleted.
- Four raw-fetch SDK gaps are converted to generated v2 calls.
- Acceptance criteria 1–6 pass; no criteria remain untested.
- The built-runtime `containsReal` binding blocker inherited from #1133 is
  fixed and covered by the live permission path.

## Risks / known issues

- The fork-wide typecheck has one unrelated base failure in
  `GlobalBusEmitter.emit`; core typecheck passes.
- Two fork session timing tests fail in untouched base code. Relevant session
  and API suites are green.
- #1134's YAML quoting fix must be present before combined smoke; without it,
  labels beginning with `#` project invalid null descriptions.

## Test status

- SDK deterministic build/typecheck: PASS.
- API lint/typecheck/build/full suite: PASS (3,184 tests).
- Clean API install and Docker build: PASS.
- Built fork binary/version smoke: PASS.
- Fork containment suites: PASS, 32 core + 18 opencode tests.
- GitNexus own-diff analysis: LOW risk, zero affected execution flows.
- Live permission/question/message event smoke: PASS against built fork/API
  on isolated `:4998`/`:4997` (1 test, 11.32s).
- Full evidence:
  `docs/ai/runs/2026-07-24-1132-complete-fork-sdk.md`.

## Next step

Integrate the #1132 implementation and verification commits, include #1134,
then run the combined branch's final smoke/build gate.
