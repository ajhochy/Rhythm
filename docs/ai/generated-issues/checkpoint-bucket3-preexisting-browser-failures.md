# Pre-existing browser checkpoint failures — P2

## Failure

Two unrelated buckets reproduce identically at merge base
`0bc46a5ece1a937c484c0054493c75b0299eafef` and retirement HEAD `d1be18ed`:
empty Deferred-board accessibility and two auto-promotion rendered tests.
No assertions or product behavior were changed to waive them.

## Repro Command

From `apps/web`, using the clean browser shell in `docs/ai/testing-guide.md`:

```sh
npm exec -- playwright test --grep 'Tasks is responsive'
npm exec -- playwright test --config tests/bucket-a-rendered-repair-playwright.config.ts --grep auto-promotion
```

## Expected

No critical/serious axe violations; promotion GET is intercepted at the configured
authority and explicit confirmation/admin-denial assertions execute.

## Actual / Relevant Output

- `aria-required-children`, critical: `div[aria-label="Deferred tasks"]` is a
  listbox containing only a paragraph, with neither option nor group children.
- Promotion enable test: `calls[0].confirmation` throws because `calls[0]` is undefined.
- Promotion errors test: expected `Admin/system access required`, received
  `Auto-promotion service unavailable RetryEnable`.
- Baseline focused results: task accessibility 1 failed; promotion 2 failed.
  Baseline profile and constrained-header checks both passed.

## Likely Cause / Likely Files

- Product semantics in `apps/web/src/pages/tasks/`: empty listbox has invalid ARIA children.
- Harness routing in `apps/web/tests/bucket-a-rendered-repair.spec.ts`: local-only
  interception does not cover the cloud-authority auto-promotion request. Also wait
  for the actual GET before inspecting `calls[0]`; visible default Disabled is not
  proof of fetched state. Trace `src/gateway/auto-promotion.ts` and the configured
  authority before fixing; do not redirect product requests just to satisfy this fixture.

## Required Fix

Correct empty-board semantics without disabling axe. Correct the promotion
fixture's authenticated authority interception and readiness, retaining all
confirmation, denial, and stale-eligibility assertions. No real promotion calls.

## Required Tests / Evaluation

Run only the two commands above, then include them at the next major checkpoint.
The detached baseline and its browser receipts remain in
`/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/bucket3-base`.
