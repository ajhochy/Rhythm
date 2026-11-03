---
date: 2026-10-10
repo: Rhythm
branch: codex/rhythm-deliverables-completion-20261010
pr: null
issues: []
status: unverified
tags: [run, rhythm]
---

## Files

Three qualification/setup repairs against signed installed candidate source c6002804ecb24142e986d171eb3b36e5178e1e3c:

- `qualification_fixture_bootstrap.ts` adds a projection phase that reads only declared seed IDs and projects their current database rows through the existing canonical boundary. Missing, execution-blocked, failed, or durably unrecorded projections refuse startup. Recovery boots reconcile files without restoring old seed instructions/revisions.
- `server.ts` calls that phase after boot backfills and before engine initialization. Ordinary startup without qualification authority remains a no-op.
- `qualification_fixture_service.ts` configures the real Dayflow source once before authenticated consent and canonical preview/commit, removing the later consent-revoking update. The pinned setup explicitly retains its selected router variant when changing to fixed mode. Production Dayflow gates and router behavior are unchanged.
- `qualification_fixture_setup.test.ts` and `vitest.qualification-setup.config.ts` cover temporary canonical files, in-memory SQLite, real selected-journal consent/import/reader candidates, projection refusal, recovery reconciliation, and pin setup. Engine/model calls are stubbed; no routing quality or installed behavior claim follows.

## Checks

Parent reproduced the frozen installed 14-case command twice: 7 pass / 7 fail. Dayflow creation c2–c7 refused before provider dispatch; pinned c9 preserved model/account but lost effort. The four selected profiles existed in the private database but had no projection records/files/native agent entries. Coordinator setup with SDK null before explicit authored input is intentionally inert.

Before edits, upstream GitNexus impact on the fresh `Rhythm-deliverables-completion` index: exact `QualificationFixtureService.dayflow` HIGH (4 impacted, 1 direct, 3 modules, no indexed process); `runCase` LOW (2/1); server `main` LOW (1/1); `bootstrapQualificationFixture` LOW (0 indexed callers, actual dynamic startup caller inspected). Parent emitted the user-facing HIGH warning before authorizing source edits.

All commands below ran in `apps/api_server` unless noted:

1. `npx vitest run --config vitest.qualification-setup.config.ts --configLoader=runner --no-cache` before product repair: **4 failed / 0 passed**, 1.91s. Exact failures: missing `secretary.md`; blocked-profile reconciliation did not throw; actual Dayflow consent threw `SOURCE_UNVERIFIED`; pinned setup changed `xhigh` to null. An earlier test harness run also had a noncanonical macOS temporary-path failure; canonicalizing the owned test root removed that harness issue before the four expected RED outcomes were captured.
2. Same command after the three repairs: **4 passed**, 1.96s. Extended refusal/read-candidate coverage then ran **7 passed**, 2.39s. One added reader assertion initially used the wrong documented status (`qualified`); it was corrected to the actual reader contract status `available`, retaining the independently observed canonical candidate identity assertion.
3. `npx vitest run --config vitest.coordinator-core.config.ts --configLoader=runner --no-cache`: **147 passed / 16 skipped**, 12 passed / 2 skipped files, 14.05s. Skips remain unverified.
4. `npm run build`: **exit 0**, TypeScript and advisory-copy postbuild. No build warnings/errors.
5. Repository root `git diff --check`: **exit 0**.
6. Repository root `shasum -a 256 docs/ai/contracts/request-deliverables-completion.json tests/contract/request-deliverables-completion.spec.ts`: unchanged frozen hashes `0f62e7628510ec2d42505b19c79965883e894c9f6537411c08b8a3c3b3940056` and `daf485744766dc7a54ed8b760848fb7c69cc8cdeb9881aef029e0c628d3bddce`.

## Notes

Source-only repair handoff remains **UNVERIFIED** for installed behavior. Parent owns independent review, detect-changes, commit/package/install, and rerunning frozen live tests. No current app, runtime, fixture database, installed bundle, provider, approval, original checkout, or user data was mutated during this repair. No commit or push was made.

The existing source-revision bootstrap still requires a fresh session store when first seeding a newly bound candidate revision; this repair does not add an upgrade bypass. Private qualification profile projection must be confirmed through the actual rebuilt engine's native agent inventory. Positive/negative Dayflow admission and correctly pinned exhaustion still require the frozen installed tests. Whole-runtime recovery and genuine human-approved Coordinator execution remain parent-owned live gates.
