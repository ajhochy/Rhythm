# Project State

## Current focus

2026-07-31: corrective work for the second physical-iPhone Agents smoke is
verified locally on the stacked rollup branch. The first Chats page now contains
the globally newest exact-owner human sessions across active registered projects
and projectless desktop “All Sessions” chats. Opening a discovered chat performs
the exact owner-authorized lookup before the slower scoped catalog and proceeds
directly to its bounded transcript page. Scheduled/background/system executions
remain outside Chats. See
[runs/2026-07-31-issue-1285-global-first-page-direct-open.md](runs/2026-07-31-issue-1285-global-first-page-direct-open.md).

## Active branch / PR

- Branch: `codex/mobile-fixes-rollup`
- Base: `origin/codex/fix-session-isolation-runtime-performance`
- PR: [#1284](https://github.com/ajhochy/Rhythm/pull/1284) (draft)
- Merge remains a manual human action after review and physical-device smoke.

## In progress

- Commit and push the verified c12/c13 corrective delta to draft PR #1284.
- Relaunch one exact-PR desktop build and install one exact-PR iPhone build.
- Re-smoke newest-session stability and interactive projectless desktop chat open.

## Risks / known issues

- The new deterministic/live contracts pass, but the corrected native build has
  not yet been driven on the physical iPhone.
- GitNexus rates the working corrective delta LOW (9 files / 10 indexed symbols /
  0 affected processes). The PR-to-integration-base aggregate is MEDIUM (107
  files / 204 symbols / 3 existing gateway flows); the comparison to `main` is
  CRITICAL/noisy because this branch intentionally inherits a large integration
  stack.
- Issue #1280 still needs its physical-iPhone multiline composer smoke.
- `.proof/i1235/ui/agents-tab.png` and `.proof/i1235/ui/tool-brain.png` contain
  pre-existing user-owned modifications and remain excluded from this commit.

## Test status

- `ai-workflow checks --level issue` — PASS: Flutter analyze/format plus API and
  MCP typechecks.
- `ai-workflow checks --level pr` — PASS: Flutter tests; API lint, serial Vitest,
  and build; MCP tests/build; fork typecheck/session tests; mobile static,
  contract, fake-server, and web e2e suites.
- Corrective contracts — RED first, then PASS: atomic opener 12/12; API owner
  discovery 4/4; progressive mobile session discovery 2/2.
- Fresh isolated real fork/API/gateway behavior — PASS 1/1: global activity
  ordering, projectless transcript read and prompt, and cross-owner denial.
- Exact-source health probes — PASS: `/health`, `/opencode/health`,
  `/agents/capabilities`, and `/mobile-gateway/health` all returned healthy data.
- Smoke completeness scan found no Blocked, UNVERIFIED, Pending, or manual-only
  entries; all 13 issue #1285 contract criteria are recorded as pass.
- `git diff --check` — PASS.

## Next step

Commit/push the corrective delta, watch CI, then replace the running desktop and
iPhone builds once and have the user verify that the true newest chat is present
immediately and that active desktop/projectless chats open and accept input.
