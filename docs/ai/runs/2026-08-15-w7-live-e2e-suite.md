---
date: 2026-08-15
repo: Rhythm
branch: self-improvement-engine-foundation
pr: https://github.com/ajhochy/Rhythm/pull/1398
issues: [W7]
status: written-not-executed
tags: [run, Rhythm]
---

# W7 live behavioural suite — written, not yet executed

`apps/api_server/src/__tests__/live_e2e_self_improvement_foundation.test.ts`,
787 lines, covering plan W7 steps 2–9.

## State

| Step | Status |
|---|---|
| 2 shadow generation mutates nothing | `it.skip` — needs W5 |
| 3 legacy scope revert fails closed | implemented |
| 4 V2 snapshot + concurrent edit conflicts | implemented |
| 5 canonical usage blocks "unused" | implemented |
| 6 unavailable telemetry authorises nothing | implemented |
| 7 one terminal outcome + append-only feedback | `it.skip` — needs W4 |
| 8 system session cannot harvest | implemented, weakest |
| 9 retry prose vs real repeated failure | implemented |

## Checks

- skips clean with no env flag: 1 file / 8 tests skipped, exit 0
- `tsc --noEmit`: clean
- full suite after merge: 5005 passed, 170 skipped, 0 failed

## The honest limitations

**The suite has never been run against a backend.** It was written under a
no-server constraint, so every fixture shape — producer-schema tool parts, the
observation floors, the `unreadable-source` trigger, the retry timeline's
non-overlap rule — is validated by reading the validators, not by running
against them. Expect the first sandbox run to surface fixture corrections in
steps 5, 6 and 9.

**Step 8 can pass vacuously.** It asserts only an absence: a system session
produces no harvested draft. The honest positive control needs a live LLM
distiller that may decline, score low, or hit a duplicate title, plus a harvest
cooldown and the #746 cold-start deferral — any of which makes the control
flaky. Two vacuity causes are mitigated (it asserts >= 2 output rounds through
the real messages route), but if `queueSkillExtraction` is deferred by the
cold-start window the test passes without proving anything, and no HTTP surface
exposes that window. Steps 5, 6 and 9 carry real positive controls; step 8 does
not. Treat it as the weakest assertion in the suite.

**Steps 5/6/9 run the whole optimizer.** `buildOrgAuditSnapshot` has no
narrower entry point — `POST /agent-org-optimizer/run` is the only route. Each
of those tests therefore triggers a full pass, and any config mutation its
auto-apply lane makes to unrelated sandbox profiles is not undone. Tolerable
only because the sandbox DB is disposable.

## Where the plan and the shipped API disagree

- Step 4 says revert "reports conflict". The controller has three failure
  outcomes: `unsafe-legacy-scope` and `conflict` both surface as 409, while
  `reconciliation-required` surfaces separately. The plan's single word hides a
  three-way distinction.
- Step 3's fail-closed behaviour holds only from `status='active'`; other
  statuses reject earlier for a different reason. The test pins `active` so it
  exercises the snapshot guard rather than the status guard.
- Step 5's gate is broader than telemetry: `detectTightenGaps` also requires
  >= 10 executed sessions and >= 7 days of profile age, so the fixture must
  back-date `created_at` directly in SQLite.
- Step 9: no proposal kind is named `retry-loop`. The generator emits
  `create-recipe` titled `Recipe: reduce retry loops (<profile>)`.

## How to run it

```bash
tools/dev/sandbox.sh up --foreground
cd apps/api_server
RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
DB_PATH=/tmp/rhythm-dev-sandbox/rhythm.db \
RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox/rhythm.db \
  npx vitest run --reporter=verbose \
    src/__tests__/live_e2e_self_improvement_foundation.test.ts
tools/dev/sandbox.sh down
```
