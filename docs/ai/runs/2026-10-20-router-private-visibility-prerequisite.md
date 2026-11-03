---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pending
tags: [run, Rhythm]
---

# Private router visibility prerequisite

## Files

- `apps/web/tests/packaged/packaged-model-router.spec.ts` checks the live authorized, visible, Decisions-enabled Luna, GPT-6 Sol, and GPT-6.1 Sol candidates before its four paid UI cases. An exact validated synthetic model-loan actor opts in only missing visibility rows through the normal private API. Ordinary operator mode performs readback only. Twelve classifier-only cases do not use this prerequisite fixture.

## Checks

- Before this test-only repair, exact signed `5dfffb5d9978795935becfe4723c8196bb2f883d` combined selection passed MCP scope, router settings, and trivial Luna routing, then failed routine arithmetic: 3 passed, 1 failed, 14 not run. The classifier returned knowledge tier 3, but the ledger had one unapplied `no_usable_route` attempt because Sol and higher-tier candidates were unavailable. Log: `/private/tmp/rhythm-private-5dff-router-mcp-confirm-20261020.log`. This RED receipt remains preserved and is not counted green.
- Earlier exact `4fda312118` ordinary router selection passed 17/17 only after private normal-API visibility opt-in for Luna, GPT-6 Sol, and GPT-6.1 Sol. The 5dff combined MCP test exposed only Luna. This was a fixture setup omission; the new prerequisite makes it explicit before paid router turns.
- Guarded strict TypeScript and Playwright discovery passed after repair; 17 router cases were discovered. The exact 5dff combined private selection then passed all 19/19 with 0 skipped/flaky/errors and CLI exit 0 in 89.258 seconds, including routine arithmetic, literal edit, fixed pin, and all classifier cases. Log: `/private/tmp/rhythm-private-5dff-router-main-mcp19-esm-confirm-20261020.log`; JSON: `/private/tmp/rhythm-router-main-mcp-confirm-5dff-g3pvz5/report.json`. The whole fixture scrub receipt reports `sourceHashesUnchanged: true`.
- The 19-case selection ran the main Auto test first, which also enabled all three candidates in the same actor. A separate **fresh isolated** exact-5dff synthetic fixture started with all three hidden and ran only the checked routine-arithmetic case. Its own normal-API visibility PATCH and live catalog/Decisions readback preceded one actual tier-3 GPT-6 Sol/medium route with two Grid attempts and exact owned session cleanup to zero. The case passed 1/1 in 5.6 seconds, 41.0 seconds total, outer CLI exit 0. Log: `/private/tmp/rhythm-private-5dff-fresh-router-prerequisite-20261020.log`; JSON: `/private/tmp/rhythm-router-schedule-fresh-5dff-kdLBkB/report.json`. This proves the previously untested prerequisite mutation branch. The fresh loan fixture is still active for a separate serial schedule Recon; no scrub result is claimed for it here.

## Notes

The test preserves all prior served-model, ledger, SDK, and UI assertions. It does not reclassify a failed route as acceptable. GitNexus could not index the test fixture in its 318-commit-stale index; manual blast is the one packaged spec and its paid setup, with no production-symbol edit.
