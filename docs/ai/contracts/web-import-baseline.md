# Slice 1 Acceptance Contract — React Prototype Import Baseline

**Date:** 2026-08-14
**Branch:** `codex/react-electron-live-suite`
**Source project:** `fc0be6da-6e7a-4650-aa68-3bd044a0712c/rhythm-desktop-agents`
**Contract command:** run the checks mapped below from the worktree root.

## Pre-implementation red

WAIVED: evidence-and-test-only repair with no application behavior change; verification is the encoded traversal assertion, targeted screenshot sweep, artifact validation, checksum verification, and dist-smoke pass.

The import must not be considered complete before its provenance and reproducible inventory exist:

```bash
test -f apps/web/PROVENANCE.md && test -f apps/web/SHA256SUMS
```

Expected before implementation: **FAIL** because `apps/web` is absent.

The focused post-import repair also began from the maintained acceptance command:

```bash
cd apps/web && npm run test:dist-smoke
```

Expected before repair: **FAIL** with `ENOENT` while reading the absent sibling
`apps/rhythm-desktop-agents.html`. This proves the regression caught: retaining the external Open
Design launcher dependency prevents the imported distribution from being verified independently.

## Criteria and evidence

| ID | Criterion | Verification evidence |
|---|---|---|
| slice1-c1 | `apps/web` is absent/new before import; no existing Rhythm symbol is edited. | Preflight directory listing and final `git status --short`; GitNexus symbol impact is not required for an all-new tree. |
| slice1-c2 | Import the complete reproducible source, tests, lockfile, package metadata, and fixtures while excluding dependencies, build/test output, caches, logs, secrets, temporary files, generated output, and Git metadata/history. | Filtered source/destination inventories and imported/excluded file counts in the run note. |
| slice1-c3 | Record exact provenance and a deterministic SHA-256 file inventory/root digest. | `apps/web/PROVENANCE.md`; `apps/web/SHA256SUMS`; independent digest recomputation command in the run note. |
| slice1-c4 | Preserve fixture-only, zero-network behavior; retain paused-live evidence as opt-in only under `RHYTHM_LIVE_E2E=1`; add no gateway or Electron implementation. | Existing test suite, exact opt-in source inspection, network-isolation results, and scoped `git status`. |
| slice1-c5 | Run clean install, TypeScript/build, test discovery, complete fixture Playwright suite with installed Chrome and one worker, and dist smoke; record discovered and executed totals accurately. | Exact commands and totals in the run note. |
| slice1-c6 | Fixture runs make no non-loopback/live API/engine requests and never target ports 4001 or 4096. | Existing network-isolation assertions plus exact static/runtime evidence recorded in the run note; any evidence gap is explicit. |
| slice1-c7 | Git changes contain only prior Slice 0 docs and declared Slice 1 files; dependencies/build/reports remain ignored and untracked. | `git status --short`, ignored-file checks, and `apps/web/.gitignore`. |
| slice1-c8 | Run note records exact commands/results, import/exclusion counts, digest, baseline count, and warnings; this contract maps every criterion. | `docs/ai/runs/2026-08-14-electron-m1-web-import.md` and this table. |
| slice1-c9 | Return a structured terminal status with changed files and exact test totals. | Final workflow-orchestrator handoff. |

## Regression caught

The red command fails if the snapshot is copied without auditable provenance or if its deterministic inventory is omitted; either omission makes the baseline irreproducible.

## Result

- Contract red was observed before import: `FAIL: apps/web provenance and inventory are absent before import`.
- Repair red was observed before editing: `npm run test:dist-smoke` failed `ENOENT` for the absent external launcher.
- Contract completion check passes after import.
- Failure triage approved the minimal Rhythm adaptation: the smoke harness no longer reads or asserts the external host launcher and continues to verify `dist/index.html#/agents`, the React root, relative asset safety/existence, path-traversal protection, and served assets.
- Criteria c1–c8 have the mapped evidence recorded in the run note. `npm run build`, `npm run test:dist-smoke`, and the adapted 144-file SHA-256 inventory all pass.
- Criterion c9 is satisfied by the final structured `READY_FOR_VERIFICATION` handoff with exact totals.

## Verification failure and focused evidence repair

- Slice 1 verification failed because the preserved traversal guard had no executed traversal request and the only screenshot sweep was skipped, leaving no durable UI baseline artifact. The completed retrospective is `docs/ai/runs/2026-08-14-retro-slice-1-evidence-acceptance.md`.
- The focused repair adds one active request for `/%2e%2e%2fpackage.json` and asserts `404`; removing the guard would expose the sibling `apps/web/package.json` as `200`. Existing root, index, React-root, relative-asset existence, and served-asset checks remain.
- `cd apps/web && RHYTHM_SWEEP=1 npx playwright test tests/screenshot-sweep.spec.ts --workers=1` — **PASS:** 1 passed in 35.1 seconds. `RHYTHM_SWEEP=1` was enabled only for this targeted evidence run; the other 238 baseline tests were not rerun.
- Artifact: `docs/ai/runs/evidence/electron-m1-slice1-dashboard-1440.png`; decoded dimensions `1440 × 900`; SHA-256 `1ccc81fcfb344dc63ad0b3d08f8d6cbe5e00a38e2f3e4f07fdb75a4304c9f231`; reviewer `coding-agent`; review date `2026-08-14`; result **PASS for baseline artifact validity only**. The image is populated and legible with no obvious blank page, error state, unintended overlay, corruption, or unintended clipping in visible content. The next section begins at the viewport fold behind the fixed request-log footer; this is recorded as normal continuation, not product-design approval.
- Repaired `tests/dist-smoke.mjs` SHA-256: `b72c5578f9c257b3d7e36e6ea4b1c24f61b921b7696a204e531aa27178e4c836`. The inventory remains 144 entries; repaired inventory root SHA-256: `e0ceaf876bb347c82ea7a52aba31dedc67469d5a14a2984ba40b8962158b0e53`.
