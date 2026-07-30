# Project State

## Current focus

2026-07-30: MSP-002 profile-first mobile sessions and per-session three-dot
configuration are implemented. Focused automated checks are green; signed
native accessibility/layout smoke remains pending.

## Active branch / PR

- Branch: `codex/msp-002-profile-first-sessions`, based on MSP-001 plus the
  MSP-005 composer fix at `4b8e12210d2dffaa3695b9a8d052cc4866fa3567`.
- PR: none.
- Focused commits: contract `66889deb7`, provider seams `6bec3a247`, UI/docs
  `4a81d4a03`.
- Run:
  [runs/2026-07-30-msp-002-profile-first-sessions.md](runs/2026-07-30-msp-002-profile-first-sessions.md).

## In progress

- Implementation and acceptance tests are committed; run-memory/manual-smoke
  documentation is the remaining local commit.
- Branch push is pending.
- Signed native smoke remains pending.

## Risks / known issues

- GitNexus scoped change detection reports HIGH risk: 13 indexed files, 59
  changed symbols, and six affected mobile chat/workspace flows. The CRITICAL
  `main` comparison includes the inherited MSP-001/MSP-005 base and is not
  attributable to MSP-002 alone.
- MSP-004 owns `ensureActiveSession()` opening/navigation. Its empty-workspace
  bootstrap receives Secretary defaults through the unified provider creation
  seam, but it intentionally does not present the MSP-002 picker.
- Signed native accessibility/layout smoke is deferred because the workstream
  forbids starting servers, binding ports 4096–4098, or operating installed
  production state.
- The repo-wide `ai-workflow checks --level issue` gate is environment-blocked:
  Flutter cannot write its SDK cache and missing API/MCP local TypeScript
  binaries trigger blocked package-registry lookups.

## Test status

- MSP-002 automated acceptance contract: 7/7 passed; native criterion c8 is
  documented and pending.
- MSP-005 chat composer Jest suite: 4/4 passed.
- Provider utility regressions passed.
- Mobile TypeScript and ESLint passed.
- `git diff --check` and the direct-creation/entry-point audit passed.
- No server, sandbox, database, or dev port was started or touched.

## Next step

Commit the run-memory/manual-smoke documentation, rerun the focused mobile
checks at the final commit, push the branch, then complete the signed native
smoke in `docs/testing/msp-002-profile-first-sessions-smoke.md`.
