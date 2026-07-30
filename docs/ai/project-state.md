# Project State

## Current focus

2026-07-30: repair MSP-002's Mobile CI foundation regression without changing
the finalized profile-first session UX. The local repair is committed; the
orchestrator's 69-spec Playwright rerun is pending.

## Active branch / PR

- Branch: `codex/msp-002-profile-first-sessions`.
- PR: #1266.
- Repair commits: `c1ad4cd6b` (`fix(mobile): seed Secretary in E2E profile
  catalog`) and `3e66d526a` (`test(mobile): make profile catalog self-check
  order-independent`).
- Run:
  [runs/2026-07-30-msp-002-foundation-e2e-repair.md](runs/2026-07-30-msp-002-foundation-e2e-repair.md).

## In progress

- The fake mobile gateway now exposes Secretary with the existing
  `openai/gpt-4.1-mini` E2E defaults.
- MSP-002 c1 guards the harness catalog so the shared create sheet cannot
  regress to a disabled Create action.
- Push and the full Playwright foundation rerun remain.

## Risks / known issues

- Full Playwright cannot run in this sandbox; the orchestrator must confirm
  the repaired branch returns from 41/69 to 69/69.
- GitNexus MCP/CLI was unavailable (`.gitnexus/run.cjs` absent and the package
  not cached), so impact and change scope were audited through direct
  call-site and git-diff inspection.
- The fake-server self-test cannot bind loopback in this sandbox (`listen
  EPERM`); a minimal standalone Node listener fails identically before any
  fixture assertion runs.
- Signed native MSP-002 accessibility/layout smoke remains pending from the
  original workstream.

## Test status

- Mobile TypeScript: passed.
- Mobile ESLint: passed.
- MSP-002 + MSP-001 session-profile contracts: 13/13 passed.
- MSP-001 fake-gateway contract: 3/3 passed.
- Chat composer Jest: 4/4 passed.
- `git diff --check`: passed.
- Fake-server self-test and full Playwright foundation: pending orchestrator
  rerun in a loopback-capable environment.

## Next step

Push the repair commits, then rerun `npm run test:fake-server:self` and Mobile
CI `verify:foundation` / all 69 Playwright specs. Confirm the creation sheet
opens with Secretary selected and Create enabled.
