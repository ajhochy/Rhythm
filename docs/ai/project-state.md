# Project State

## Current focus

Issue #1186 is implemented and live-verified: the isolated dev sandbox now has
an explicit foreground mode that remains stable under non-interactive
automation hosts.

## Active branch / PR

- Branch: `codex/1186-sandbox-foreground`.
- PR: none yet.
- Related issue: #1186.

## In progress

- `tools/dev/sandbox.sh up --foreground` completes the normal build/readiness
  sequence and then holds the real API process until `down`.
- Both launch modes record the ready sandbox engine's exact PID and built-fork
  executable identity; `down` safely removes that engine if API shutdown leaves
  it orphaned.
- The acceptance contract, focused process suite, gated live lifecycle test,
  and testing-guide usage are complete.
- The branch is ready for final diff review, commit, push, and a draft PR.

## Risks / known issues

- Fixed sandbox ports `:4097/:4098` remain a serialized local test resource.
- GitNexus does not index the Bash lifecycle functions, so its impact result is
  UNKNOWN; focused process and real lifecycle tests cover the behavior.
- The repo-local Flutter analyze gate is environment-blocked: installed Flutter
  3.24.5 supplies Dart 3.5.4, but current dependencies require Dart 3.7 or
  newer. This branch changes no Flutter files.

## Test status

- Bash syntax and focused process suite: PASS, 7/7, including 20 acknowledged
  foreground cycles and fail-closed engine PID/executable mismatch coverage.
- TypeScript and API build: PASS.
- Full API suite: PASS, 373 files passed and 34 skipped; 3,252 tests passed and
  57 skipped.
- Fork single-binary build and binary smoke: PASS.
- Live foreground/orphan lifecycle: PASS, 1/1 in 43.92 seconds on the final
  rerun. API `:4098`, engine `:4097`, both health endpoints, exact engine
  identity recording, forced API-exit orphan cleanup, protected listener
  identities, unrelated-PID refusal, and teardown all passed.
- Foreground shutdown acknowledgment stress: PASS, 20 consecutive lifecycle
  iterations.
- At #1186 teardown, `:4097/:4098` were free; protected `:4001` PID 965 and
  `:4096` PID 1011 were unchanged. Parallel tracks may subsequently reuse the
  fixed sandbox ports.
- Full evidence: `docs/ai/runs/2026-07-26-1186-sandbox-foreground.md`.

## Next step

Run final GitNexus/diff review, commit the intended #1186 files, push, and open
a draft PR. Do not merge automatically.
