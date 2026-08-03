---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-mobile-session-claim-gap
pr: null
issues: [1279]
status: verified
tags: [run, Rhythm]
---

# Issue #1279 — desktop mobile-session visibility

## Files

- `apps/api_server/src/repositories/mobile_opencode_ownership_repository.ts`
  — shares the existing `agent_sessions` SDK-owner lookup with a new exact
  owner/project reader.
- `apps/api_server/src/services/mobile_opencode_security.ts` — preserves
  explicit ownership first, then applies the desktop fallback to sessions only.
- `apps/api_server/src/contract/issue_1279_desktop_session_visibility.test.ts`
  — contract coverage for owner, user, project, explicit-claim, and PTY gates.
- `apps/api_server/src/__tests__/issue_1279_mobile_gateway_live.test.ts` —
  env-gated real API + fork gateway behavior.
- `docs/ai/contracts/issue-1279.json` — six passing acceptance criteria.

## Checks

- Pre-change:
  `npx vitest run src/contract/issue_1175_corrective_security.test.ts --no-file-parallelism`
  — PASS, 3/3 (restricted first attempt could not bind localhost; escalated
  rerun passed).
- Contract red:
  `npx vitest run src/contract/issue_1279_desktop_session_visibility.test.ts --no-file-parallelism`
  — expected FAIL, 1 failed / 5 passed; owner A received `[]`.
- Contract green: same command — PASS, 6/6.
- Related ownership/security set — PASS, 61 passed / 1 env-gated live test
  skipped across 10 files.
- `npx tsc -p tsconfig.json --noEmit` — PASS.
- `npm run build` — PASS.
- `bun run build --single` — PASS after rerunning with the network access its
  `models.dev` build input requires.
- Isolated sandbox (`API :4098`, engine `:4097`) status — both listeners owned
  by the scoped sandbox.
- Live:
  `RHYTHM_LIVE_E2E=1 ... npx vitest run src/__tests__/issue_1279_mobile_gateway_live.test.ts --no-file-parallelism`
  — PASS, 1/1; A/P visible, B/P hidden, A/Q hidden, no explicit claim created.
- Sandbox cleanup: PASS; `/private/tmp/rhythm-dev-sandbox-issue-1279` removed.
- Baseline `ai-workflow checks --level issue` — PARTIAL: Flutter analyze,
  Flutter format, and api_server TypeScript passed; the unrelated mcp_server
  step failed because that package does not have a local TypeScript compiler
  and `npx tsc` resolves the placeholder package.

## Notes

- `isResourceExplicitlyOwnedBy` remains claim-table-only.
- PTY ownership is unchanged.
- No production port, production database, push, PR, or merge was used.
