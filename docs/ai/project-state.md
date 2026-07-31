# Project State

## Current focus

2026-07-30: eight independently developed mobile Agents fixes are integrated
on one stacked rollup branch. The rollup covers compact Agents navigation,
composer sizing, desktop/mobile session visibility and live delivery, mobile
memory visibility, profile-scoped mobile session creation, parity residuals,
and startup credential-watcher noise. Details:
[runs/2026-07-30-mobile-fixes-rollup.md](runs/2026-07-30-mobile-fixes-rollup.md).

## Active branch / PR

- Branch: `codex/mobile-fixes-rollup`
- Base: `origin/codex/fix-session-isolation-runtime-performance`
- PR: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft)
- Merge remains a manual human action after review and physical-device smoke.

## In progress

- Review draft PR #1284.
- Run the remaining physical-iPhone smoke checks before merge.

## Risks / known issues

- Issue #1280 still needs the signed physical-iPhone multiline composer smoke:
  growth, shrink-on-delete, paste, and scrolling beyond the 132-point cap.
- The Agents overflow-menu screenshot is browser-rendered rather than a native
  iPhone capture; the view is nonblank and the permanent category row is gone.
- Initial aggregate verification exposed two non-reproducible shared-state /
  timing failures. Both exact files passed in isolation, both full failed
  commands passed independently, and the complete PR matrix passed on rerun.
- GitHub Mobile CI exposed a production refresh race in the shared session
  configuration sheet: live profile/preferences updates could clear a typed
  title while the sheet stayed open. Initialization is now limited to the
  closed-to-open transition, with focused component coverage.
- The PR is intentionally stacked on the session-isolation branch; comparing
  the inherited integration base to `main` is broad and is not this PR's
  review scope.

## Test status

- `ai-workflow checks --level issue`: passed all four configured checks.
- `ai-workflow checks --level pr`: passed every Flutter, API, MCP, fork, and
  mobile stage on the combined branch.
- Full serial API: 3,788 passed / 122 skipped / 0 failed.
- Fork session suite: 383 passed / 4 skipped / 1 todo / 0 failed.
- Fresh isolated live rollup suite: 5 files / 5 behaviors passed.
- Fresh mobile↔desktop parity sandbox: 14/14 feeds matched.
- Health probes: `/health`, `/opencode/health`, `/agents/capabilities`, and
  `/mobile-gateway/health` returned HTTP 200.
- Agents proof: `.proof/i1235/ui/agents-tab.png` (30,624 bytes), visible and
  nonblank with the three-dot header.
- Shared-sheet refresh repair: focused component regression passed; native
  Jest passed 7/7; full mobile foundation passed all 69 browser cases in suite
  order; the complete repository PR matrix passed.
- PR #1284 Server CI and Mobile CI passed on the published branch.
- GitNexus exact-base scope: LOW risk, 0 affected execution processes.

## Next step

Review the draft PR, repeat issue #1280 and the Agents header checks on a
physical iPhone, then merge manually if CI and smoke remain green.
