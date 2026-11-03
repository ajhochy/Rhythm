---
date: 2026-09-30
priority: P2
status: deferred
tags: [issue, Rhythm]
---

## Failure

Fork session tests pass but leave one `opencode-test-*` directory; representative config/git/util tests also show variable growth. Pre-existing on origin/main/base `4f915540f700bbb403728ef8e01e0b5e02baf94f`, not fixed in the narrow initialization-throw cleanup repair.

## Repro Command

While an owned synthetic sandbox is up, with clean environment and its HOME:

`node tools/dev/test-temp-directory-cleanup.mjs -- bun --cwd <package> test test/session/ src/session/`

Use `<package>=apps/opencode_fork/packages/opencode` for the repaired branch; substitute the same package in an isolated `git archive 4f915540f700bbb403728ef8e01e0b5e02baf94f apps/opencode_fork` extraction for base. Use identical dependency links/runtime, no installs through links.

## Expected

Completed tests leave no new matching directories.

## Actual / Relevant Output

- Untouched base: 408 pass, 5 skip, 1 todo; wrapper exit1, counts `12635/159/6 -> 12635/160/6`; exact new root `opencode-test-ciyew7oyg2i`.
- Repaired branch: identical test totals; wrapper exit1, `12635/160/6 -> 12635/161/6`; exact new root `opencode-test-jmzlr7c4m1s`.
- Both roots contain only `.opencode/`; branch subtree contains `node_modules/`, `package-lock.json`, `package.json`.
- Representative git/config/filesystem/process/glob suite: 180 pass on both; base grew `161 -> 173` (data `6 -> 7`), branch rerun `173 -> 188` (data `7 -> 8`). Earlier branch grew `157 -> 159`. Variable growth, not a stable-count equivalence claim.
- Count triples are rhythm-vitest/opencode-test/opencode-test-data; second includes third. Actual TMPDIR `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T`. All leftovers retained.

## Likely Cause / Likely Files

`apps/opencode_fork/packages/opencode/src/config/config.ts:608-628` launches dependency installation with `Effect.forkDetach`. These writes can outlive fixture disposal and recreate removed config roots. Session subtree evidence supports this hypothesis; exact individual representative writers are not traced. `test/preload.ts` and instance teardown may also need investigation for data-root recreation. The repaired helper's successful disposal is byte-for-byte unchanged apart from indentation.

## Required Fix

Separate lifecycle work: attribute background writers and await/cancel their owned operations before disposing fixtures. Do not add prefix sweeping, change normal fixture lifetimes, or delete retained evidence. This exceeds AJ's existing CRITICAL approval (initialization throw before return only). Impact-analyze implicated symbols and obtain approval if HIGH/CRITICAL before editing.

## Required Tests / Evaluation

Repeat identical branch/base session and representative commands in an owned synthetic sandbox, assert exact owned roots absent after writer teardown and stable prefix counts; preserve unowned sentinels. No GitHub issue created.

## Independent run3 observation

The same deferred background growth repeats: representative180 pass/264 assertions on branch and base, branch214->227 and base228->241(data9->10); session branch227->228 and base241->242. All roots retained. This is not a no-growth claim or a GitHub filing. Separately, branch session run has407 pass/1 assertion failure at prompt.test.ts1523 (expected1 llm call, received0), while exact base has408 pass/0 fail. That new assertion is NOT established pre-existing by this background-growth comparison and prevents the final verification gate; it is not silently folded into this deferred item.
