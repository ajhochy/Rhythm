# Follow-up: three failures in the repository PR gate

Priority: P2 verification follow-up. Scope: separate from exact-session opening.

## Failure

`ai-workflow checks --level pr` exited 1 on `codex/electron-session-opening`,
based on `2350a500`. Thirteen stages passed. No source files in API, fork, mobile,
Flutter, or MCP differ from that base in this change. This does not establish
whether the failures are persistent baseline bugs, timing failures, or environment
issues. The original full run is the recorded observation; no rerun or repair was
performed because the coordinating agent explicitly kept these outside scope.

## Repro commands and actual results

Run each from its package directory. These focused commands are proposed for
triage; only the original full gate has run for this record.

1. API: `npm exec -- vitest run src/__tests__/prod_trigger_parity_contract.test.ts --fileParallelism=false`.
   AC1b, empty `allowed_mcps_json` array, failed at `dispatchProd` line122:
   `expected "vi.fn()" to be called once, but got 2 times` for `mockDbRun`.
   The test expects the production trigger insert exactly once.
2. Fork: `bun test test/session/ src/session/ --test-name-pattern 'cancel finalizes interrupted bash tool output through normal truncation'`.
   The named interrupted-output finalization test failed. Summary: 395 pass,
   5 skipped, 1 todo, 1 fail across 402 tests/27 files. The wrapper's last-30-line
   failure report did not retain the underlying assertion, so a focused rerun
   must capture it before any diagnosis.
3. Mobile: `npm run test:e2e:web -- tests/e2e/issue-1174-parity.spec.mjs --grep 'chat session maintenance'`.
   Line116 expected visible text `Edited from mobile parity`; the element was
   absent. Summary: 70 passed, 1 failed. The existing test-result error context
   was generated locally under `apps/mobile/test-results/`.

## Expected / likely files

Each existing criterion should pass unchanged. Start with the named test and the
smallest implementation it exercises. The interrupted-output source filename
must be located by its exact test title; do not infer the cause from this summary.

## Required fix and evaluation

Reproduce each failure independently, preserve its actual error, identify the
cause, and add a regression only if behavior changes. Do not weaken assertions to
produce a green report. Run the affected checks after a diagnosed repair, then
the normal repository checkpoint. Signed packaging and Electron release gates
are separate from these failures and from the source-shell opening qualification.
