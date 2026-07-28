---
date: 2026-07-24
repo: Rhythm
branch: codex/1135-audit-profile-lock
pr: null
issues: [1135]
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Issue 1135 — audit-locked agent profiles

## Files changed

- Added additive SQLite/Postgres `agent_configs` lock metadata and an append-only
  `agent_config_security_events` audit table.
- Added admin/system-only security-lock, reviewed-reenable, and event-list routes.
- Made the lock authoritative in registry listing, file projection/sync, primary
  session create/resume, WebSocket turns, schedules, runner preflight, and
  delegation.
- Added contract, repository, controller, runner, delegation, schema-parity, and
  live behavioral coverage.
- Recorded the transition contract in
  `docs/ai/decisions/2026-07-24-audit-locked-agent-reenable.md`.

## Checks run

- `npm run build` — PASS.
- `ai-workflow checks --level issue` — PASS (Flutter analyze/format and
  api_server TypeScript checks).
- `ai-workflow checks --level pr` — PASS, including the complete
  api_server Vitest suite. Two aggregate attempts had unrelated transient HTTP
  failures: an `issue_895_agent_approvals.test.ts` empty body and an
  `opc_mcp_oauth_routes.test.ts` five-second timeout. Their exact isolated runs
  passed 5/5 and 3/3 without changes; clean restarted aggregate runs passed.
- Focused Vitest gate covering issue 1135, repository, registry, runner,
  delegation, projection sync, schema parity, and migration guards — PASS:
  10 files / 110 tests.
- Contract validation — PASS: 6 integration criteria, 0 `not_tested`.
- Vendored fork `bun run build --single` — PASS.
- Live behavioral test against a rebuilt fork and api_server with isolated
  database/home/vault state and schedules disabled:
  `RHYTHM_SANDBOX_DIR=/tmp/rhythm-sandbox-1135-final
  RHYTHM_API_PORT=4798 RHYTHM_OPENCODE_PORT=4797 RHYTHM_LIVE_E2E=1
  npx vitest run src/__tests__/live_e2e_1135_disabled_agent.test.ts` — PASS,
  1 file / 2 tests. `/health` reported OK and `/opencode/health` reported ready
  before the test; cleanup removed the sandbox and released both ports.

## Notes

- The live test observed ordinary disable/re-enable, security lock, direct
  `enabled=1` database drift, registry exclusion, primary-invocation denial,
  stale/generic re-enable rejection, exact reviewed re-enable, and current
  database model/prompt projection.
- Failure triage was required for a fresh worktree's missing fork dependencies,
  Bun 1.3.14 trying to refresh one Bun 1.3.13 lock entry, detached-process
  lifetime in the command harness, a full-module test mock missing the new pure
  helper export, two aggregate-only HTTP-test flakes, and a relative cleanup
  path. Dependency setup used `bun install --no-save`; the generated lockfile
  drift was reverted. The final lifecycle owned the server in one shell and used
  an absolute cleanup path.
- No follow-up issue was filed: all six acceptance criteria passed without
  blocked, unverified, pending, or skipped entries.
- Production schema changes are additive. They still require normal migration
  review before the draft PR is merged because production is Postgres.
