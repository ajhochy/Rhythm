---
date: 2026-10-01
repo: Rhythm
branch: codex/opencode-memory-recovery
pr: 1598
issues: [1603]
status: unverified
tags: [run, rhythm]
---

## Files

- `apps/opencode_fork/packages/opencode/src/snapshot/index.ts`: preflight Git blob sizes and bound reads, diff work, and retained patch bytes; expose explicit omission reasons while keeping file status and counts.
- `apps/opencode_fork/packages/opencode/test/snapshot/snapshot-memory.test.ts`: safe synthetic regressions for oversized objects, aggregate patch size, exact small patches, and many-file work limits.
- `apps/opencode_fork/packages/opencode/test/session/summary-memory.test.ts` and `docs/ai/contracts/issue-1603.json`: issue acceptance contracts shared with the summary repair.
- `apps/web/src/gateway/sessions.ts`, `apps/web/src/components/Inspector.tsx`, `apps/mobile/components/chat/chat-cards.tsx`: retain patch and omission metadata and explain an intentionally omitted preview without losing counts.
- Fork and vendored SDK declarations plus fork OpenAPI: carry the additive `patchOmitted` reason; mobile's local diff alias accepts the new field until its published SDK catches up.

## Checks

- Red before repair: `bun test test/session/summary-memory.test.ts test/snapshot/snapshot-memory.test.ts --timeout 30000` — 0 pass, 4 fail. Summary hydrated full history and performed 26 diff calls; snapshot returned a full 300 KiB oversized patch and 1,417,144 aggregate patch bytes in the safe-scale fixture.
- After repair: `bun test test/session/summary-memory.test.ts --timeout 30000` — 2 pass, 0 fail (summary code owned by the integration agent).
- After final repair: `bun test test/session/summary-memory.test.ts test/snapshot/snapshot-memory.test.ts test/snapshot/snapshot.test.ts --timeout 30000` — 57 pass, 1 existing skip, 0 fail, 1433 assertions. The session test includes newer queued user requests after failure and cancellation.
- `bun run typecheck` in the fork, `npm run typecheck` in web and mobile, `./node_modules/.bin/tsc --noEmit -p tsconfig.json` in api_server, and `git diff --check` — pass.
- `npm test -- --runInBand tests/chat/issue-1603-diff-omission.test.tsx` in mobile — 1 pass. Web browser adapter/display regression is written but not run; no web server was started.

## Notes

- GitNexus upstream impact for `diffFull`, `FileDiff`, and the removed `show` fallback was LOW with zero indexed direct callers; its index is behind this worktree, so source consumers were reviewed manually.
- `diffFull` preflights blob sizes before content reads: 256 KiB per blob, at most 8 rows per content batch, 128 KiB per patch, 1 MiB aggregate patch text, 256 patch attempts, 5-second patch work deadline, and bounded diff edit/time options. The complete file list, status, and counts remain available when patch text is omitted. The status/numstat and metadata passes still scale with changed-file count, which is needed to preserve those results.
- The real API/fork sandbox memory and health gate remains pending. No application server or installed app was started for these checks.
