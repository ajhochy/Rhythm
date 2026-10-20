---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: unverified
tags: [run, Rhythm, electron, colony]
---

# Bot Crossing packaged inventory repair candidate

## Files

- `apps/electron/test/colony-scene-routing-contract.test.mjs` adds a channel regression proving a valid coded worker `oversize` response is delivered to the authorized scene without stopping its service or closing the port; the next request succeeds. No Rhythm Electron production source or packaged acceptance assertion changed in this lane.
- Separate upstream Bot Crossing source worktree `/private/tmp/bot-crossing-inventory-repair-20261020`, exact baseline `2bb12c46b8a7c3392d627acf416cedb857d49dbb`: `server/embedded-service.mjs` coalesces concurrent implicit first-page reads into one pending generation. `test/embedded-service.test.mjs` adds the red/green concurrency and explicit capacity regressions; `test/embedded-inventory-collections.test.mjs` retains the capacity assertion with distinct explicit generations. Upstream run: `docs/ai/runs/2026-10-20-embedded-inventory-concurrency.md` in that worktree.

## Checks

- Parent's original exact packaged app run at source `d7fb554735` failed 4/4 existing Bot Crossing acceptance cases in 139.5 seconds; structured receipt `/private/tmp/rhythm-ai-repair-red.json`, trace `/private/tmp/rhythm-ai-repair-red`. Direct host inventory reported `Colony document revoked`; retained child inventory reported coded `[colony:oversize] Colony operation exceeds its size or capacity limit`. The earlier confirmation trace had retained child `[colony:revoked] Colony channel unavailable`. No reliable per-test main-process stderr receipt survived the packaged runner restart, so the direct-host revocation cause remains unproven.
- Upstream synthetic concurrent first-page test was RED before the source edit: 13 pass / 1 fail, third implicit request refused with `Too many active inventory generations`. After the edit, focused source suites passed 18/18 and full guarded `npm test` passed 297/297; guarded `npm run build` exited 0 with the existing Vite chunk-size warning. Receipts: `/private/tmp/bot-crossing-inventory-focused-green.log`, `/private/tmp/bot-crossing-inventory-full-green.log`, `/private/tmp/bot-crossing-inventory-build.log`.
- `node --test apps/electron/test/colony-scene-routing-contract.test.mjs` passed 7/7. It rules out valid coded `oversize` alone revoking the authorized scene, but does not reproduce the packaged main-process lifecycle.
- A read-only probe of the five enabled real source adapters used a fresh disposable state directory and emitted aggregate counts/bytes only: 7,489 threads, 377 projects, 0 warnings, 14,446,551 serialized snapshot bytes, largest record 68,220 bytes. The unchanged 20,000-record and 32 MiB limits have headroom; no record/path/prompt content was logged.
- `git diff --check` passed in both repair scopes. GitNexus query, context and upstream impact were attempted before changing Rhythm symbols; the available index reflects the original checkout and is stale for this worktree. It returned LOW/zero direct callers for Colony symbols, which is not a reliable current blast-radius estimate. Manual call-path review covers the scene channel, host inventory route and worker service.

## Notes

- The upstream race is a demonstrated cause of coded capacity refusals during concurrent first-page calls. It does not yet explain the separate direct-host `Colony document revoked`; no security revocation policy was relaxed.
- The scene's own `fetchThreads()` pages one generation and cancels it in `finally`. A test observer sharing that generation could interrupt a still-running scene poll if it cancels too early. Searchbox visibility is insufficient as a load signal; the parent native run should observe completed scene inventory/UI state before probing and cancelling an observer generation. No lease semantics were added speculatively.
- Parent review, upstream source commit, clean embedded artifact rebuild, exact Rhythm pin update, guarded local package, and real packaged Bot Crossing rerun are pending. The original checkout, installed app, API, engine and native GUI were not changed by this lane.
