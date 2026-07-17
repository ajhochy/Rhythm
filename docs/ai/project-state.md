# Project State

## Current focus

Epic #1116 (Self-Improvement Engine) mega-PR — all 13 child issues implemented, integrated,
and verified green on `workflow/skill-discovery-cost-2026-07-16`. About to push + open the PR.

## Active branch / PR

- Branch: `workflow/skill-discovery-cost-2026-07-16` (mega branch, integrated from 6 clusters).
- PR: pending (push + open next). Will carry `Closes #N` for #1109 #1110 #1111 #1112 #1113 #1114
  #1115 #1053 #1054 #1055 #1056 #1090 #1067 (epic #1116 + #1098 auto-close via children).

## In progress

- Push mega branch → CI gate → open PR → human merge → trigger release build.

## Risks / known issues

- **#1110 exact live token number not captured** — behavior verified (structural 9/9 test hooks on real
  code + A1 live cheap-model); the exact cost total was blocked by sandbox creds isolation. Capture in
  the real app post-merge if a hard number is wanted.
- **Pre-existing test pollution** — `issue_723_mcp_remove_reconcile.test.ts` writes the real
  `~/.config/opencode/opencode.json` (`foo`/`npx foo-mcp`) on full-suite runs under real HOME. Run
  api_server suites under a sandboxed `HOME` until fixed (follow-up).
- **Pre-existing flaky tests** — `issue_895_agent_approvals` + a research-job vault test fail ~1/2 runs,
  pass on re-run. Watch CI; re-run on that signature.
- **`task_4cc07f52`** — the older #1039/#1040 undici fix in `api_server/server.ts` may be inert (same
  global-`fetch` pattern #1115 proved doesn't work). Separate investigation.
- #1067 fork regen is inert until #1068 (out of scope) and ships only on a fork rebuild (release build).

## Test status

Integrated mega branch (sandboxed HOME): api_server `tsc` clean + `vitest` **2877 passed** / 32 skipped /
0 failed; mcp_server `tsc` clean + `vitest` **80 passed**; desktop_flutter `flutter analyze` clean +
`flutter test` **875 passed**; opencode_fork `bun test` **366 pass** + `openapi.json` 133 ops. Per-issue
live e2e verified (see docs/ai/runs/2026-07-16-epic-1116-mega-pr.md).

## Next step

`git push` the mega branch, watch CI to green, open the PR (draft), hand off for human merge. After the
user merges, trigger `desktop_release.yml` (patch bump from latest tag; rebuilds bundled Node + opencode fork).
