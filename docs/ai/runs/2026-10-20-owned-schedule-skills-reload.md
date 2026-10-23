---
date: 2026-10-20
repo: rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pass
tags: [run, rhythm, playwright]
---

# Bind owned schedule and Skills checks to their actual UI lifetime

## Files

- `packaged-ai-private-schedule-timing.spec.ts`: target the actual Cron input, unmount schedule inspector and drain history requests before nonce-owned API cleanup.
- `packaged-ai-private-skills.spec.ts`: preserve full page reload, bind catalog response to a GET observed after the new main document commits, then require edited record in the response, real inspector and API/engine catalogs.

## Checks

- Signed6101 broad native run57 passed/3 failed. Two failures were test defects: Cron label matched both an option-containing select and input, and the Skills reload waiter captured a catalog response from the document being replaced. Primary notice failure remains a separately repaired product bug.
- First focused run1 passed/1 failed,55.8s: complete schedule timing behavior passed; Skills test preparation accidentally reloaded Agent Tools and never mounted Skills. A late history read of the API-deleted selected schedule also produced404 in that following test's strict audit. The incorrect preparation was corrected; the schedule test now unmounts and verifies quiescence before deletion. Neither failure is counted as a final green result.
- Evidence: `/private/tmp/rhythm-private-6101-broad-failure-evidence-20261020`, `/private/tmp/rhythm-schedule-skills-failure-preserve-20261020`, `/private/tmp/rhythm-focused-6101-skills-schedule-failure-preserve-20261020`.
- Latest strict packaged/browser test TypeScript: `npm run build:guard -- ./apps/web/node_modules/.bin/tsc -p /private/tmp/rhythm-mcp-schedule-contract-tsconfig-20261020.json` — exit0; `/private/tmp/rhythm-qualification-new-tests-final-strict-20261020.log`. This configuration includes Node types, app global declarations, both new contracts, Skills, and both relevant browser specs.
- Exact rebuilt local bundle `5dfffb5d9978795935becfe4723c8196bb2f883d`: the independent 60-case synthetic packaged selection passed **60/60**, 0 skipped/unexpected/flaky, 152.939s, with model gate off and `UNVERIFIED` cases excluded. The future schedule timing case passed in 2.5s and the managed Skills create/edit/reload/delete case passed in 1.6s. Report `/private/tmp/rhythm-private-5dff-broad-green-evidence-20261020/report.json`; log `/private/tmp/rhythm-private-5dff-broad-discard-confirm-20261020.log`. Full-page reload and owned UI/API/SQLite/fork assertions stayed in place; this is scoped native confirmation, not completion of the wider AI behavior inventory.

## Notes

No production symbol changes in this slice. Ownership, maximum nonce rows, profile/owner/timing readback, zero run/root checks and exact cleanup remain intact. If UI quiescence cannot be verified, cleanup preserves the records and fails. Native credential fixtures are always scrubbed after sanitized evidence capture and owned runtime teardown, including on failure.
