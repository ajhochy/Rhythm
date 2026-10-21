---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pass
tags: [run, Rhythm]
---

# Primary Auto reload Codify

## Files

- `apps/web/tests/packaged/packaged-ai-primary-model-router.spec.ts` extends the existing one-turn private main Auto case with normal renderer reload and existing-primary reopen assertions.
- `docs/testing/results/recon-ai-primary-auto-reload.md` records the sanitized exact-build observation used for those assertions.

## Checks

- Exact signed `5dfffb5d9978795935becfe4723c8196bb2f883d` private Recon passed 1/1. The observed tier-4 Luna route survived reload/reopen with one foreground POST, one command, two unchanged Grid attempts, and the same SDK/history/UI result. This is observation, not a run of the revised checked-in test.
- `npm run build:guard -- ./apps/web/node_modules/.bin/tsc --noEmit --strict --allowJs --checkJs false --skipLibCheck --module esnext --moduleResolution bundler --allowImportingTsExtensions --target es2022 --types node --esModuleInterop apps/web/tests/packaged/packaged-ai-primary-model-router.spec.ts`: pass.
- Guarded Playwright `--list` for the revised spec: one test discovered. `git diff --check` for the spec: pass.
- Revised checked-in test native Confirm: pass, 1/1 in 5.3 seconds on the exact signed `5dfffb5d9978795935becfe4723c8196bb2f883d` bundle. It ran inside the serial 19-case private selection, which passed 19/19, 0 skipped/flaky/errors in 89.258 seconds with outer CLI exit 0. Command and output: `/private/tmp/rhythm-private-5dff-router-main-mcp19-esm-confirm-20261020.log`; JSON: `/private/tmp/rhythm-router-main-mcp-confirm-5dff-g3pvz5/report.json`.
- The whole private loan fixture was scrubbed after evidence capture. `/private/tmp/rhythm-router-main-mcp-confirm-5dff-g3pvz5/scrub.json` reports `sourceHashesUnchanged: true`. The first private config lacked package ESM metadata and failed before tests launched; that separate log is not counted as a behavior run.

## Notes

The existing routine acceptance remains tier 3 GPT-6 Sol/medium or tier 4 GPT-6 Luna/xhigh, always below the configured GPT-6.1 Sol baseline. The added readbacks do not create a second paid turn or assert that a reload survives an API/engine restart. GitNexus could not index this test symbol in its 318-commit-stale index; manual scope is one packaged spec, with no production edits.

After the native Confirm, the test title alone changed from “cheaper same-tier” to “routine same-tier” because model pricing was not measured and Sol may match the baseline price. No assertion or setup changed in that edit; the native log retains the earlier title.
