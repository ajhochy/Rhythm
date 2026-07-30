# Project State

## Current focus

2026-07-30: second repair of MSP-002's Mobile CI foundation regression. The
direct web E2E agent catalog now includes Secretary, matching the paired mobile
profile catalog and allowing the shared Secretary-first creation sheet to
enable Create.

## Active branch / PR

- Branch: `codex/msp-002-profile-first-sessions`.
- PR: #1266.
- Prior repair commits: `c1ad4cd6b`, `3e66d526a`, `4defc1e77`,
  `afb38e92d`.
- Run:
  [runs/2026-07-30-msp-002-second-foundation-e2e-repair.md](runs/2026-07-30-msp-002-second-foundation-e2e-repair.md).

## In progress

- The MSP-002 c1 contract now pins Secretary in both fake-server capability
  sources: paired `/mobile-gateway/profile-catalog` and direct `/agent`.
- The second repair is locally verified and awaiting the orchestrator's full
  Playwright rerun before PR smoke can be considered complete.

## Risks / known issues

- Full Playwright cannot run in this sandbox. Every fresh failure artifact
  showed the same disabled Create action and Secretary-unavailable message;
  the orchestrator must confirm the direct catalog repair clears the failures.
- The fake-server self-test cannot bind loopback in this sandbox (`listen
  EPERM` on `127.0.0.1:4196`), so it exits before assertions.
- GitNexus MCP/CLI remains unavailable (`.gitnexus/run.cjs` absent); change
  scope was audited through direct call-site and git-diff inspection.
- Signed native MSP-002 accessibility/layout smoke remains pending from the
  original workstream.

## Test status

- Mobile TypeScript: passed.
- Mobile ESLint: passed.
- MSP-002 + MSP-001 session-profile contracts: 13/13 passed.
- Chat composer Jest: 4/4 passed.
- `git diff --check`: passed.
- Fake-server self-test: environment-blocked at loopback bind.
- Full Playwright foundation: pending orchestrator rerun.

## Next step

Push the focused second-repair commits, then rerun the full Mobile CI
Playwright foundation suite. Confirm the New chat sheet shows Secretary
selected, Create enabled, and all previously blocked chat-driving specs
proceed to their own assertions.
