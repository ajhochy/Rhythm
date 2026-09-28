---
date: 2026-09-19
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: 1544
issues: []
status: repairing
tags: [run, Rhythm]
---

# Mobile CI OpenCode contract synchronization

## Files

- Explicitly classified the newly generated `GET /mcp/tools` operation as intentionally omitted from Mobile and denied by the generic gateway. Rhythm API consumes its live tool IDs for server-side MCP grant validation; the Mobile MCP screen does not consume the raw IDs.
- Regenerated the mobile shipping contract and API gateway manifest from the reviewed classification. Advanced their operation count from 136 to 137 and the OpenAPI fingerprint to `7e730bf5f4d349273df5dcd723eea9d8920df48d6ced50b57f6e41a592eb8872`. Updated the paired Mobile and gateway fingerprints and fixed-count assertions; no completeness or denial assertion was removed. Added `/mcp/tools` to the proxy's explicit-denial regression.

## Checks

- Mobile CI [35453310777](https://github.com/ajhochy/Rhythm/actions/runs/35453310777) at `979e3efe` was **cancelled** during Playwright test 68/72 when the newer-head run started. Issue-1172 lifecycle and issue-1174 chat-maintenance each failed once and passed their first retry before cancellation. Neither emitted a final assertion failure for that run. Log: `.proof/mega-2026-09-18/mobile-ci-35453310777.log`.
- Mobile CI [35453668353](https://github.com/ajhochy/Rhythm/actions/runs/35453668353) at `8ba09fd` failed immediately at `npm run contract:check`: `Missing mobile classification for mcp.tools`. Log: `.proof/mega-2026-09-18/mobile-ci-35453668353.log`.
- After regeneration: `npm run contract:check`, `npm run test:contract`, and `node --test tests/issue-1174-opencode-parity-contract.test.mjs` passed (3/3 parity checks). `npm run lint` passed with zero errors and three existing warnings; `npm run typecheck` passed; `npm test -- --runInBand` passed 32 suites/133 tests.
- `npm run test:pairing-compatibility` initially failed on the stale gateway fingerprint, then passed after updating the paired value. `npm run test:paired-host` and `node --test tests/contract/ios-account-connect.test.mjs` passed. API `npm run build` and `npm test -- --run src/services/__tests__/mobile_pairing_service.test.ts src/__tests__/issue_1169_mobile_opencode_proxy.test.ts` passed (24/24).
- `git diff --check` passed. The initial GitNexus invocation selected the wrong repository and reported no changes. The integration review repeated `node .gitnexus/run.cjs detect_changes --scope all --repo /Users/ajhochhalter/Documents/Rhythm/.mega-wt/integration --limit 8`: ten files, two symbols (`MOBILE_GATEWAY_COMPATIBILITY` and the test's `stubs`), zero affected processes, LOW risk. The correct worktree selector is its absolute path.

## Decisions

- Keep `/mcp/tools` denied to Mobile: this operation supplies raw tool IDs for server-side grant validation and has no Mobile consumer. Preserve the generic gateway's complete explicit classification and denial checks.
- Update both pairing fingerprints together; existing compatibility enforcement remains in place, so deployment must use matching Mobile and backend contracts.
- Re-run CI and qualification-only signing on the resulting source commit. Earlier signed artifacts remain provisional.
