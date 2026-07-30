# Project State

## Current focus

2026-07-30: second repair of MSP-002's Mobile CI foundation regression. New
session creation now resolves the active project's profile capabilities on
demand before applying the Secretary requirement, removing the startup cycle
that left Create disabled while preserving the no-Secretary safety gate.

## Active branch / PR

- Branch: `codex/msp-002-profile-first-sessions`.
- PR: #1266.
- Prior repair commits: `c1ad4cd6b`, `3e66d526a`, `4defc1e77`,
  `afb38e92d`.
- Run:
  [runs/2026-07-30-msp-002-second-foundation-e2e-repair.md](runs/2026-07-30-msp-002-second-foundation-e2e-repair.md).

## In progress

- The MSP-002 c1 contract now pins Secretary in both fake-server capability
  sources and requires automatic/direct-sheet creation to resolve profiles
  when initial capability hydration is still pending.
- `loadSessionProfiles(projectId)` is shared by `createSession` and the Chats
  creation sheet. Active-project loads also hydrate models/providers, so the
  chat surface can render with the resolved defaults.
- The second repair is locally verified and awaiting the orchestrator's full
  Playwright rerun before PR smoke can be considered complete.

## Risks / known issues

- Full Playwright cannot run in this sandbox. Every fresh failure artifact
  showed the same disabled Create action and Secretary-unavailable message;
  Mobile CI must confirm the direct catalog plus on-demand hydration repair
  clears the failures.
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

Push the focused hydration follow-up and wait for its Mobile CI Playwright
foundation run. Confirm the New chat sheet shows Secretary selected, Create
enabled, and all previously blocked chat-driving specs proceed to their own
assertions.
