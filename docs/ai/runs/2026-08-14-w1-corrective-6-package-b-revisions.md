---
date: 2026-08-14
repo: Rhythm
branch: self-improvement/revision-lifecycle-corrections
pr: null
issues: [W1-corrective-6]
status: pending
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# W1 corrective-6 package B — monotonic revisions

## Files changed

- Added revision-zero schema/bootstrap mapping for `agent_org_proposals` and `agent_configs`.
- Added proposal/config revision row mapping and revision-incrementing mutation primitives.
- Added proposal status, atomic scope transition, config scope, and intermediate human-claim CAS fences.
- Added SQLite migration/concurrency/trigger tests and PostgreSQL SQL-shape/zero-row parity tests.

## Checks run

- Runtime: `PATH=/opt/homebrew/opt/node@22/bin:$PATH`; `node --version` → `v22.23.1`.
- RED B1: `node node_modules/vitest/vitest.mjs run src/__tests__/w1_corrective_6_revisions.test.ts` → 3 expected failures (missing schema/model revision and `0→1→2`).
- RED B2/B3: same command → 2 expected failures (measuring ABA writer committed; atomic revision miss mutated rows).
- RED B4: same command → 5 expected failures (the preceding two plus missing config revision/schema/API).
- RED B5: same command → 3 expected failures (missing strict approved-claim primitive).
- RED explicit atomic seam: focused approved/apply test → `TypeError: transitionScopeAtomicallyAtRevisionsAsync is not a function`.
- GREEN focused matrix: six files, 180 passed.
- GREEN W1 non-socket gate: thirteen files, 375 passed, 1 existing skip.
- Parent independent probe: exit 0; omitted scope binding rejected and stale revision-2 writer rejected after measuring revision returned to the same status at revision 4. The two package-C projection races remain reproducible.
- Parent atomic trigger probe: exit 0; BEFORE/AFTER target trigger failures and exact-binding miss retained zero effects. Committed tests additionally cover proposal triggers.
- Static/build: `npm run lint` exit 0 (repository script is a TODO echo); `node_modules/.bin/tsc --noEmit` exit 0; `npm run build` exit 0.
- Exact `bash /tmp/run-rhythm-w1-gate.sh` attempted twice. The unchanged real-server route suite cannot bind an ephemeral listener in this managed sandbox (`EPERM listen`), so it times out before its first test; a minimal Node listener reproduces the same `EPERM`. The other 13 gate files pass above.
- `git diff --check 5b3ab26ed025321985b623c02494c5c48c8b82c6` clean.
- Pre-commit `/tmp/git_added_scan.py` reports zero committed added lines because the change is not committed yet; rerun is required after commit.
- GitNexus `detect-changes --scope all`: 8 tracked files, 46 symbols, 6 affected flows, HIGH risk. The flows are config seed/update/security row mapping; full tests/build cover the type-compatible revision-bearing return narrowing.

## Notes

- Migration numbers: none. This repository uses idempotent structural blocks in `migrations.ts` and `postgres_bootstrap.ts`; the new block is labeled `W1 corrective-6 package B`.
- PostgreSQL parity tests first ran green after the shared SQLite/PostgreSQL implementation was present; subsequent SQL-shape assertions lock placeholder/value order, revision increment, and zero-row behavior.
- Build initially failed because config read signatures still returned the legacy optional-revision interface. Failure triage aligned `list`, `listEnabled`, and `getById` to the mapper-guaranteed revisioned subtype; static/build and both test matrices then passed.
- Raw agent-config writers outside `AgentConfigsRepository`: one-time migration/bootstrap seed/repair SQL, plus the intentional cross-table atomic update in `AgentOrgProposalsRepository`. No service/controller runtime raw writer was found.
- No live database, network, persistent server, controller/service lifecycle, projection writer, W2/W3, push, PR, or merge action was performed.

## Package-C handoff

- Switch generic lifecycle writes to `updateStatusAtRevisionAsync` with the exact returned proposal revision.
- Use `claimScopeApprovedWithSnapshotAsync`; supply the canonical strict v2 snapshot verifier callback, then carry its returned revision into `transitionScopeAtomicallyAtRevisionsAsync` for `approved→applied`.
- Carry the target config revision into atomic scope transitions and projection jobs. Use `compareAndSetScopeFieldAtRevision` for independent fixed-column writes.
- Remove service use of the deprecated legacy claim/atomic compatibility paths after the lifecycle is wired.
- Fence latest-state profile projection/reconciliation with `AgentConfig.revision`; package B intentionally does not implement projection locks or reconciliation state.
- The independent probe still demonstrates stale file projection after a newer DB write on both apply and revert paths; those are package-C responsibilities.

## Parent verification and correction

- Parent RED: the new real-SQLite `applied -> approved` compensation test failed with `Unsupported atomic scope proposal transition` after a successful revision-bound `approved -> applied` commit.
- Parent GREEN: the atomic target+proposal primitive now supports only the paired `applied -> approved` compensation transition; the generic status updater still rejects that backward transition. The focused test passes `1/1`, and the complete revision suite passes `20/20`.
- Parent Node 22 gate outside the worker sandbox: `14/14` files passed, `399` tests passed, `1` existing skip; the real HTTP route suite bound successfully.
- One intervening full-gate run returned a transient `405` for one injected-failure route case. The isolated real route matrix immediately passed `4/4` with the expected `500` and zero effects; the complete gate rerun then passed as above.
- Parent TypeScript build passed. The established local-operator actor sentinel `0` remains valid; only negative, non-integer, or unsafe numeric actors are rejected.
- Parent removed an out-of-scope rewrite of `docs/ai/project-state.md`; this package-specific run note retains the implementation evidence without erasing unrelated campaign state.
