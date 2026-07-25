---
date: 2026-07-24
repo: Rhythm
branch: codex/1134-email-injection-boundary
pr: null
issues: [1134]
status: ready-for-isolated-live
tags: [run, Rhythm, security]
---

# #1134 session-bound email injection boundary

## Files

- Replaced process-global MCP taint and list-based approval lookup with trusted
  engine request metadata plus local api_server persistence.
- Added additive SQLite taint-event/state tables and security-binding columns
  on `agent_approvals`.
- Bound human approvals to session, agent, action, canonical payload digest,
  taint UUID/source turn, expiry, and atomic single use.
- Kept Gmail's raw scanner before model delivery; a failure to persist taint
  also blocks delivery. Audit records contain no raw email.
- Split `.mcp-roles/email-assistant.mcp.json` into read-only triage and new
  `.mcp-roles/email-outbound.mcp.json` for fresh-context writes.
- Added API adversarial/replay tests, MCP handler tests, engine metadata tests,
  acceptance contract, and an env-gated live stdio test.
- `apps/mcp_server/src/index.ts` tool count is unchanged: zero tools added or
  removed.

## Checks

- Red contract before implementation:
  `cd apps/api_server && npx vitest run src/__tests__/issue_1134_external_content_security.test.ts`
  — 4/4 failed with missing-route 404s.
- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit` — pass.
- `cd apps/api_server && npx vitest run src/__tests__/issue_1134_external_content_security.test.ts src/__tests__/gmail_signals.test.ts src/__tests__/issue_895_agent_approvals.test.ts`
  — 14/14 pass.
- `cd apps/mcp_server && npm run typecheck && npm test` — 94/94 pass.
- `cd apps/opencode_fork/packages/opencode && bun run typecheck` — pass.
- `cd apps/opencode_fork/packages/opencode && bun test src/mcp/security_context.test.ts src/session/mcp_allowlist.test.ts test/session/mcp_allowlist_e2e.test.ts`
  — 14/14 pass.
- `cd apps/api_server && npx vitest run --maxWorkers=1` — full suite pass
  after upgrading c6 to the real-engine path: 360 files / 3184 tests passed;
  31 files / 50 env-gated tests skipped.
- Final focused rerun:
  `cd apps/api_server && npx tsc --noEmit && npx vitest run src/__tests__/issue_1134_external_content_security.test.ts src/__tests__/gmail_signals.test.ts src/__tests__/obsidian_write_grants.test.ts`
  — 12/12 pass.
- Final MCP focused rerun:
  `cd apps/mcp_server && npm run typecheck && npx vitest run src/tools/__tests__/email_injection_gate.test.ts src/security/__tests__/context_scanner.test.ts src/security/__tests__/security_context.test.ts src/tools/__tests__/google.test.ts`
  — 21/21 pass.
- Final fork rerun:
  `cd apps/opencode_fork/packages/opencode && bun run typecheck && bun test src/mcp/security_context.test.ts`
  — pass.
- `ai-workflow checks --level pr` — every non-API check passed on both runs
  (Flutter analyze/format/test, API typecheck/lint/build, MCP
  typecheck/test/build, fork typecheck/session tests). Its parallel API step
  hit unrelated cross-file flakes in different files on the two runs;
  `agents_models_catalog` 20/20, `opc_m4_3_mcp_routes` 19/19, and
  `agent_local_auth_bypass` 2/2 each passed immediately in isolation. The
  complete single-worker suite above passes.
- `node .gitnexus/run.cjs detect-changes --scope staged --limit 1000 --repo /Users/ajhochhalter/Documents/rhythm-worktrees/run0724-1134`
  — 31 indexed files / 78 symbols, zero affected execution processes, LOW risk.
- `git diff --check` — pass.

## Notes

- The root coordinator prohibited this workstream from starting/stopping the
  sandbox. Criterion c6 is implemented but remains pending until the root runs:

  ```bash
  cd apps/mcp_server && npm run build
  cd ../api_server
  RHYTHM_LIVE_E2E=1 \
  RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
  DB_PATH=/tmp/<sandbox>/rhythm.db \
  npx vitest run src/__tests__/live_e2e_1134_external_email_boundary.test.ts
  ```

- The test registers this checkout's built MCP server with the real sandbox
  fork engine, creates/deletes its own agent profile/session, drives real model
  turns over the api_server WebSocket gateway, and starts only an inert loopback
  Gmail/message fixture. It refuses `:4001`.
