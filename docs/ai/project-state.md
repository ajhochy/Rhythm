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
- PR: draft requested; URL pending
- Merge remains a manual human action after review and physical-device smoke.

## In progress

- Commit and push the CI-only title-input synchronization repair.
- Require a green Mobile CI run, then open the draft stacked PR.

## Risks / known issues

- Issue #1280 still needs the signed physical-iPhone multiline composer smoke:
  growth, shrink-on-delete, paste, and scrolling beyond the 132-point cap.
- The Agents overflow-menu screenshot is browser-rendered rather than a native
  iPhone capture; the view is nonblank and the permanent category row is gone.
- Initial aggregate verification exposed two non-reproducible shared-state /
  timing failures. Both exact files passed in isolation, both full failed
  commands passed independently, and the complete PR matrix passed on rerun.
- GitHub Mobile CI consistently exposed stale controlled-input state in the
  existing issue #1172 lifecycle test. The test now flushes the filled title
  before submission; no product assertion was removed or weakened.
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
- Issue #1172 CI repair: focused scenario 10/10 passed; full mobile foundation
  passed all 69 browser cases in suite order.
- GitNexus exact-base scope: LOW risk, 0 affected execution processes.

## Next step

Review the draft PR, repeat issue #1280 and the Agents header checks on a
physical iPhone, then merge manually if CI and smoke remain green.
