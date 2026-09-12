# P2 — stale-redo contract fixture depends on millisecond insertion chronology

## Failure

OUT OF SCOPE baseline failure, reproduced 2026-09-12 during final-gate triage on
`feature/electron-flutter-retirement`, HEAD `44a71ab850b7ca942073a67b871db1eb9cf592a3`.
Merge base: `0bc46a5ece1a937c484c0054493c75b0299eafef`.
Classification: pre-existing test-harness chronology defect; the detector also
has unspecified equal-createdAt ordering. No branch product regression found.

External HEAD movement was observed at final validation: `805731d99eab178d805616ff98754f6a97c67528`
(`Bind Phase 3 to 5 rendered acceptance evidence`). Its diff from the starting
HEAD contains only web tests and docs; `git diff --stat 44a71ab8 HEAD --
apps/api_server` is empty. This triage created no commit and changed no API source.

The final `npm test -- --no-file-parallelism` failed only at
`apps/api_server/src/__tests__/workflow_failure_signal_extractor.test.ts:764`.
The originally supplied services/agent_self_improvement test path is not the tracked path.

## Repro Command

From `/Users/ajhochhalter/Documents/Rhythm-electron-flutter-retirement/apps/api_server`:

```sh
env -i \
  HOME=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode \
  TMPDIR=/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode \
  PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  npm exec -- vitest run --no-file-parallelism \
  src/__tests__/workflow_failure_signal_extractor.test.ts \
  -t 'reworking the same issue # signals' --sequence.shuffle --sequence.seed=8
```

Natural reproduction is intermittent, not guaranteed by the seed: the exact
single test ran separately for seeds 1 through 20. Candidate: 18 passed, two
identical failures (8,15). Merge-base sources: 17 passed, three identical failures
(5,6,13). A single selected test has no other test ordering to shuffle.

Deterministic diagnostic config retained outside the worktree:
`/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/stale-redo-triage.config.mjs`.
Add `--config <that-path>` to the above command and these environment variables:

- `TRIAGE_BASE=0` selects unchanged candidate sources.
- `TRIAGE_BASE=1` uses a Vite pre-load plugin to read **every loaded local TS
  module**, including test, setup, repositories, database/migrations and detector,
  directly with `git show <merge-base>:<relative-path>`; it is not a mock of the
  detector or a candidate repository substituted for baseline.
- Leave `TRIAGE_CLOCK` unset for the original test fixture.
- `TRIAGE_CLOCK=tie` transforms only this test's fixture after `setErrorStatus`:
  both created_at values become `2026-09-12T00:00:00.000Z`, with s1/s2
  last_activity_at values respectively `00:00:00.000Z`/`00:00:02.000Z`.
- `TRIAGE_CLOCK=distinct` changes only s2.created_at to
  `2026-09-12T00:00:01.000Z`. The existing signal/confidence assertions remain intact.

This is a source-overlay focused baseline comparison using candidate-installed
dependencies, not an independently installed merge-base checkout or full-suite
baseline claim. It avoids changing either worktree or installing dependencies.

## Expected

Two chronologically distinct attempts at #42, first closed and latest errored,
produce a defined high-confidence stale-redo signal.

## Actual

The original fixture does not guarantee distinct creation timestamps. Depending
on insert/update clock boundaries, the closed session is selected as latest and
the stale-fixed safeguard suppresses the signal.

## Relevant Output

`AssertionError: expected undefined to be defined` at the existing signal assertion.

| Focused experiment, seeds 1–20 | Candidate | Merge-base sources |
|---|---|---|
| Original test, real clock | 18 pass / 2 fail | 17 pass / 3 fail |
| Equal created_at, newer s2 activity | 0 pass / 20 same failures | 0 pass / 20 same failures |
| Distinct created_at, same activity order | 20 pass / 0 fail | 20 pass / 0 fail |

The whole focused test file then exited 0 on each revision, clock injection off,
using `npm exec -- vitest run --config <path> --no-file-parallelism
src/__tests__/workflow_failure_signal_extractor.test.ts`.
No full API suite, live server, sandbox launch, timeout increase, retry setting,
weakened assertion, product edit, or test edit was used.

## Likely Cause

`insert` stamps created_at using `new Date().toISOString()`; two inserts may share
one millisecond. `listAll` returns descending coalesced activity/update/create
order. `detectStaleRedoSignals` stably sorts ascending createdAt only and picks
the last item; equal creation timestamps preserve incoming order, allowing the
closed first attempt to win and suppress the expected signal.

The test resets its SQLite database before each case. Single-test reproduction
rules out another test being required to contaminate state. UUIDs are random,
but the relevant ordering has no UUID tiebreaker. The extractor's message cache
is per invocation. Branch repository additions implement history pagination;
the legacy insert/listAll/status paths and detector/test are unchanged.

## Likely Files

- `apps/api_server/src/__tests__/workflow_failure_signal_extractor.test.ts:753–765`
- `apps/api_server/src/services/workflow_failure_signal_extractor.ts:513–550`
- `apps/api_server/src/repositories/agent_sessions_repository.ts` (read-only tracing)

Owner: workflow-failure extractor contract, not Electron/web/checkpoint evidence.

## Required Fix

In a separately scoped change, give the first fixture attempt an explicit earlier
created_at, reusing `rawUpdate` exactly as the adjacent #936 safeguard test does.
Keep both expected signal and high-confidence assertions. Do not change production
ordering merely to make a fixture with ambiguous chronology pass. If equal-time
production semantics are required, define that contract separately rather than
pretending a random UUID or last activity proves attempt creation order.

## Required Tests / Evaluation

Run this single test at least 20 times with deterministic creation chronology,
then its focused file including the clean-latest suppression contract. No full
API rerun or typecheck is needed for a fixture-only repair. Obtain impact evidence
before editing; this triage makes no indexed-symbol edits and no fix claim.
