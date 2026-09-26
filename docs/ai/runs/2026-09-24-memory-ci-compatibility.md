---
date: 2026-09-24
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: [1569]
status: in_progress
tags: [run, rhythm]
---

# Memory safety compatibility repair

## Files

`memoryVaultWriteService.ts` validates the destination before deduplication reads, preserving symlink refusal and avoiding reading the symlink target. The migration test uses the canonical reserved-filename predicate so generated README metadata is not counted as a memory note; exact note counts and relationship assertions remain unchanged.

## Checks

Remote server CI at dcbc9e43 failed three memory tests. The isolated candidate reproduced all three failures, then passed 15 focused tests, 329 tests across 38 memory files, and the API build. Logs: `/private/tmp/rhythm-1569-s5-ci-{red,focused,memory,build}.log`.

Integrated `npm test` in `apps/api_server` passed 6325 tests, skipped 264, and failed one unrelated Engraph concurrent-manager ownership test (206.35 seconds). All three original memory failures passed. Integrated `npm run build` passed. Logs are `s5-ci-integrated-api-full.log` and `s5-ci-integrated-build.log` in the September 24 repair4 evidence directory.

## Notes

This repairs the observed memory CI regressions, not a claim that the full API suite or shared-memory feature is complete. Engraph identity probing is under separate diagnosis. No real vault, credential store, production API, or native Hermes runtime was used for these memory tests. Shared-memory native qualification remains pending.
