---
date: 2026-10-09
repo: Rhythm
branch: fix/scheduled-dayflow-memory-router-20261008
pr: 1611
issues: []
status: READY_FOR_VERIFICATION
tags: [run, Rhythm]
---

## Assigned scope / ownership

Same original Memory worker be4164f1 under Router parent/root 8adb6035.
Parent explicitly released the narrow source repair diagnosed in external receipt
`memory-be4164f1-final-r5-readonly-diagnosis-8c612782.md`.
Only two source/test files changed in this continuation:

- `apps/api_server/src/services/memory_retrieval.ts`
- `apps/api_server/src/__tests__/memory_relevance_admission.test.ts`

Plus this uniquely named canonical run note and external handoff receipt.
Temporary preserving harness/evidence is under the manager TMPDIR and retained.
No mobile source/test edit, no original 26-case contract edit, no unrelated memory
source edit, thresholds, policy, models, permissions, or authority changes.
Root retains all other source, Dayflow/guard/fixture/runtime ownership.
No commits/pushes/merges, installs, API/engine/provider launches, real network,
model/spend, protected journals, private evaluation, or host4001/4096 action.

## Phase 0 — retained actual RED, not a new failing run

Loaded acceptance-contract first, then coding-agent. Used the parent-authorized
existing RED rather than generating another test/harness mirror:
`/private/tmp/sdmr-grid-sandbox/final-r5-memory-units-2.log`.
Log SHA256 before edits:
`8c612782ffe9e55253023cdbf9f42f8b42cf47f88f55227042a8be090c9c8db7`.
Observed historical result: 93 PASS / 3 FAIL / six files. Mobile line297 expected
native query length97, received80. Relevance B1 expected resume/two priors;
B2 expected bare resume native search. This was NOT presented as a fresh RED.

Verified pre-edit blobs match the independently diagnosed source:

| File | Before blob |
|---|---|
| memory_retrieval.ts | 5b5005e085afd13690b1d4792ebefafd112bb70f |
| memory_relevance_admission.test.ts | 40446320871c005b969133eacc082819a75217a7 |
| mobile_automatic_memory_assembly.test.ts | 095d6ab36c3482041c6c8097e43bccc1358ce424 |
| memory_current_task_preferences.test.ts | 79fa05dc4f4ee37b827a618cd2812a0fb6761ae1 |

Contract: existing mobile exact97/<=128 assertions plus current-task 26 cases
are retained; substantive continuation queries stay <=80; B1/B2 oracles corrected
to explicit nearest-task/substantive-query values. Added a >80-character substantive
prior within existing B1 to catch accidentally restoring128 for continuations;
its evidence must still be exactly current+nearest prior, not the older camera task.
The existing test counts remain unchanged.

## Phase 1 — bounded impact review before symbol edits

MCP GitNexus impact calls (repo Rhythm; file path hint
`apps/api_server/src/services/memory_retrieval.ts`; direction upstream;
summaryOnly true): compactAutomaticNativeQuery and resolveAutomaticMemoryQuery.
Both returned target not found, risk **UNKNOWN**. No trustworthy graph blast count,
no LOW-risk inference, no reindex/install. Reported UNKNOWN to the parent-facing
session and reviewed exact callers manually.

Helper call sites before edits: resolver line340, hybrid native retrieval line1227,
rank-only rerank line1849. Resolver consumers: buildMemoryPreface and the automatic
preparation module; transport consumers remain WS, mobile, delegation and server
preparation. AgentRunner direct build retains its unchanged options. The intended
change surface is only default/continuation cap and two test oracles. No indexed
HIGH/CRITICAL result was returned. Concrete risk: default restoration accidentally
lifting continuation limit or changing native/FTS relevance/authorization. Existing
mobile, rerank, relevance and 26-case contracts cover those distinctions.

## Phase 2 — minimal delta

Production delta only:

1. Restore `AUTOMATIC_NATIVE_QUERY_MAX_CHARS` to128.
2. Add private `AUTOMATIC_CONTINUATION_QUERY_MAX_CHARS = 80`.
3. Private compact helper takes `maxChars`, default128; both cap comparisons use it.
4. Only continuation resolver passes80. All default native/rerank callers unchanged.

B1 exact expected query is `calibrate violet telescope optics`, evidence exactly
`resume\nCalibrate violet telescope optics`. Async/system frames and unrelated
camera prior remain in the fixture; current/no-prior and history/evidence bounds
remain asserted. Long substantive telescope prior additionally asserts continuation
mode, <=80 query, and exact nearest-task evidence.
B2 retains persisted prior/current inputs, canonical note, admitted-ID and
continuation-mode assertions; expected native query is the exact substantive
telescope query with explicit <=80 assertion. No admission/fence/budget assertion
removed or relaxed. Mobile exact97/<=128 is byte-unchanged.

## Preserving runner / validation

All harness files and logs retained under:
`/private/tmp/sdmr-grid-sandbox/tmp/memory-cap-be4164f1-20261009/`.

Supported Vite config-loader runner, thread pool, one worker, caches disabled.
Custom global setup creates and provides a fresh run root and registers NO
teardown. Original `vitest.setup.ts` still runs unchanged, maintaining per-file
DB/vault/account isolation and PORT0. Vite pre-transform recognizes exactly one
literal fixture teardown in each of the relevance/mobile test files and replaces
only that cleanup statement with retention logging. Assertions, setup, production
code and all filesystem APIs remain intact; no fs monkeypatch/no-op guard is used.
No original/global fixture rm/rmdir hook is executed.

OS profile retains every approved `test-runner-strict-v5.sb` rule (no unlink,
rmdir, rename-away exceptions; protected evidence, host data, journals and Codex
write denies), adding only `deny network*`. No permission/network expansion.
Approved base SHA256: 849f1404e655b8c58a521643f5648dbc881fb347a18fdc12f5d433209e9a7f92.
Derived profile SHA256: d199e646b33657a17c0ac888cd1258dd1b47bd1a6d21d2d213e8368328985ff7.

Initial profile spelling `(include ...)` was unsupported: sandbox refused before
starting tests/typecheck. Retained logs `units-attempt-1.log` and `tsc-attempt-1.log`,
and retained that initial profile as `preserving-unit-initial-unsupported.sb`.
Corrected by reproducing all approved rules explicitly plus network denial.
Next guarded run passed74 and tsc emitted no errors, but zsh rejected shell
capture variable `status` as read-only; those logs remain retained, no invented
captured exit0. Subsequent commands used `rc` and recorded actual exit0.
An attempted read-only diff against the earlier hash-only blob could not use it
as an object-db snapshot; that no-index output was not used as incremental evidence.
Source edit scope is recorded above and final tracked diff/whitespace checked.

Final exact commands (cwd = assigned worktree/apps/api_server):

```sh
/usr/bin/sandbox-exec -f /private/tmp/sdmr-grid-sandbox/tmp/memory-cap-be4164f1-20261009/preserving-unit.sb /usr/bin/env -i HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db DB_CLIENT=sqlite PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin node ./node_modules/vitest/vitest.mjs run --config /private/tmp/sdmr-grid-sandbox/tmp/memory-cap-be4164f1-20261009/vitest.config.mts --configLoader runner > /private/tmp/sdmr-grid-sandbox/tmp/memory-cap-be4164f1-20261009/units-freeze.log 2>&1
# Capture immediately with rc=$?; append EXIT_STATUS; return that rc.
/usr/bin/sandbox-exec -f /private/tmp/sdmr-grid-sandbox/tmp/memory-cap-be4164f1-20261009/preserving-unit.sb /usr/bin/env -i HOME=/private/tmp/sdmr-grid-sandbox/home TMPDIR=/private/tmp/sdmr-grid-sandbox/tmp DB_PATH=/private/tmp/sdmr-grid-sandbox/rhythm.db DB_CLIENT=sqlite PATH=/Users/ajhochhalter/.local/bin:/opt/homebrew/bin:/usr/bin:/bin node ./node_modules/typescript/bin/tsc --noEmit > /private/tmp/sdmr-grid-sandbox/tmp/memory-cap-be4164f1-20261009/tsc-freeze.log 2>&1
# Same rc capture, append EXIT_STATUS, return rc.
```

Actual final results: **74 PASS / six files / no skipped selected cases**, exit0;
shared tsc --noEmit exit0. File counts: relevance17, mobile5, current-task26,
rerank11, ranking-smoke10, default-smoke5. Existing mobile now executes and passes
its subsequent provenance assertions too (not merely pre-failure assertions).
All foreign, lifecycle, Dayflow, budget, timeout, canonical-update, receipt-prune
and authority assertions in these selected files passed. Final run root retained:
`/private/tmp/sdmr-grid-sandbox/tmp/memory-cap-retained-gC6fSI`.

Full96+26 **NOT RUN**: the remaining semantic48 file has a deliberate canonical
delete/symlink-swap case at lines711–733. This preservation harness does not replace
that behavioral deletion with a no-op or skip assertions. No full122 PASS claim.
The 74 checks cover all assigned cap repair criteria plus both native call lanes;
the root may separately own a genuinely preserving full-suite recipe. Historical
79 PASS and failed final-r5 logs remain distinct unmodified evidence.

Final log SHA256: units-freeze
39c71e7f2bcac41b2ab3ceb5f45fe306ba5c848613e63d47c7a56772ee78f16e;
tsc-freeze 5d3ef99083b15a7dc019919549d09b4968089a3cf8d3d6ccb989589362a532ed.
Harness SHA256: config7ae59067d9d9cdc97a958b2c2fae193b10bdcb4ad39d2b1e601ff31eed3458c7;
global setup0342bd8295c2c4969327b7913050841a14cdc5b26e2c467410366263f04911b7.

## Frozen handoff / quiescence

| Owned file | Final Git blob | Final SHA256 |
|---|---|---|
| memory_retrieval.ts | 6242afb2ec55a107a15a5bc496c9bc4bf82580b1 | 7ae32e601556d59ef111cab71f73dfeaea107e4e03f4a087579e9866ceb7aec9 |
| memory_relevance_admission.test.ts | fce648f0edc4c14a833bd0f0f9f966ab8ee7f5d5 | b2f6832a8eb3b06f147fd1e0bb30d6561c045b011b5ce79082d7bce63a6abb7c |

Unchanged mobile blob095d6ab36c3482041c6c8097e43bccc1358ce424; unchanged26-case
blob79fa05dc4f4ee37b827a618cd2812a0fb6761ae1. No new public exports/options.
Tracked owned diff whitespace clean; note/harness untracked whitespace checked
separately. No project-state update and no old note/log rewriting.

READY_FOR_VERIFICATION for narrow repair only. Writer quiescent after final
receipt/hash confirmation; root consumes this freeze before rebuilding/loading.
No prompt/queue notification sent while root is busy. Final LIVE API/provider
consumption/provenance/continuation remains **NOT QUALIFIED** until root rebuilds
verified source and runs actual SDMR suite with its separately owned transport
guard repair. Existing runtime/old build and host source are not qualified by units.
