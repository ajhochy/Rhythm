---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: pass
tags: [run, rhythm]
---

# Natural Once schedule Codify

## Files

- `apps/web/tests/packaged/packaged-ai-private-natural-once.spec.ts`: new exact-build, explicit synthetic-actor and bounded model-loan case transcribed from the [native Recon](../../testing/results/2026-10-20-synthetic-natural-once-recon.md). It uses ordinary UI schedule creation/edit and natural local due time, actual API/SQLite/engine/readback, the linked SDK messages and UI history, and an inert disabled twin. It never invokes manual trigger or an artificial clock. Exact owned root/schedule cleanup and before/after signed bundle integrity are required.
- `docs/testing/results/2026-10-20-synthetic-natural-once-recon.md`: credential-free observation summary.

## Checks

- Prior private observation passed **1/1** on signed 5dff (1.6m test/2.2m total, CLI exit 0), with `completed_no_op`, one linked Luna answer `19`, zero tool parts, disabled twin zero runs/roots, and no cleanup errors. This is Recon, not checked-in test Confirm. The reused loan was scrubbed with unchanged source hashes.
- The earlier 3.3s attempt failed only its incorrect blanket permission preflight before schedule write or model turn; its separate failed log remains preserved.
- `npm run build:guard -- ./apps/web/node_modules/.bin/tsc -p /private/tmp/rhythm-natural-once-contract-tsconfig-20261020.json` — exit 0, strict packaged test and app sources.
- `python3 ../../tools/build/guard.py --repo ../.. -- ./node_modules/.bin/playwright test -c tests/packaged/packaged-playwright.config.ts --list packaged-ai-private-natural-once.spec.ts` from `apps/web` — exit 0, one discovered case.
- First checked-in case native Confirm: **FAILED before schedule creation or model turn** (6.4s). The private DB had zero natural-schedule rows. Its `finally` cleanup assertion initially replaced the original exception in the Playwright report. Log `/private/tmp/rhythm-private-5dff-natural-once-checked-confirm-20261020.log`; report `/private/tmp/rhythm-natural-once-confirm-5dff-uMMkdX/report.json`. Whole loan O2JguI was scrubbed with unchanged source hashes.
- The test now catches and rethrows its original body error after cleanup, attaches only a credential-free phase/status summary, and reports cleanup errors separately. No outcome assertion was relaxed. The private no-model/no-write Tasks GET/reload/body diagnostic passed **1/1** (223ms test/36s total): both reloads returned GET200 with an array of 9, CDP loading finished and loader matched the current document, and both body reads succeeded. Receipt `/private/tmp/rhythm-natural-once-tasks-catalog-diagnostic-20261020/observation-2c9ed64b-20b4-41a0-8d80-a56203cc4482.json`; synthetic actor fixture dnGKOh was auto-removed. This did **not** reproduce the masked failure or justify changing the body-read assertion.
- The fresh checked run with original-error preservation reproduced the **test authoring race** before any schedule/model turn: `initialResponse.json()` failed with `Protocol error (Network.getResponseBody): No resource with given identifier found` because the response belonged to a document navigated away from. Log `/private/tmp/rhythm-private-5dff-natural-once-primary-error-confirm-20261020.log`; report `/private/tmp/rhythm-natural-once-primary-error-5dff-YRdSM1/report.json`. Its loan was scrubbed with unchanged source hashes (`/private/tmp/rhythm-natural-once-primary-error-5dff-YRdSM1/scrub.json`). The earlier no-model probe's successful body reads were a non-reproduction, not contrary proof.
- The new test uses the existing Skills new-main-frame-commit plus post-commit request-identity barrier for **both** Tasks collection reloads. It still requires an actual GET200/readable array, the exact synthetic bearer (asserted as a boolean so failure output cannot print it), real UI/API/SDK linkage, and strict owned cleanup. Guarded strict TypeScript and Playwright discovery exit0.
- Fresh independent checked native Confirm now **PASSED 1/1**, 0 skipped/unexpected/flaky/errors, 142.152s total, CLI exit0 on exact signed5dff. The sanitized attachment reports natural `completed_no_op`, one enabled run, zero disabled runs, answer `19`, zero SDK tool parts, both local/SDK input/output links, zero manual triggers, unchanged bundle and CodeDirectory hashes, and exact cleanup success. Log `/private/tmp/rhythm-private-5dff-natural-once-document-confirm-20261020.log`; report `/private/tmp/rhythm-natural-once-document-5dff-3mCsyr/report.json`. Whole fixture ccpLNU was scrubbed with `sourceHashesUnchanged:true` (`/private/tmp/rhythm-natural-once-document-5dff-3mCsyr/scrub.json`).

## Notes

GitNexus `impact -r Rhythm hasEffectiveNoToolsBoundary --include-tests` and the added reload-capture helper returned UNKNOWN because these test-only symbols are new and the index trails this worktree by 319 commits; the indexed unrelated `responseFor` returned LOW/0 callers. Manual blast radius is this new spec only; no production or shared test symbol was edited. Existing schedule timing/storage tests remain useful and the checked-in case now confirms one natural Once dispatch and its disabled control. The first two checked failures remain test-authoring RED evidence, not product failures. Recurrence, restart, retry, sleep/wake and hosted behavior remain open.
