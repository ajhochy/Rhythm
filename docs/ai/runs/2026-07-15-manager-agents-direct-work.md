---
date: 2026-07-15
repo: Rhythm
branch: fix/manager-agents-direct-work
pr: 1097
issues: []
status: verified
tags: [run, Rhythm, agents, routing]
index: "[[Rhythm]]"
---

# Manager agents perform in-scope work directly

## Files

- `apps/api_server/src/services/opencode_agent_writer.ts` — replaced the shared
  delegation-first hub preamble with direct-first routing and four explicit
  delegation exceptions; preserved profile-specific coding handoffs.
- `apps/api_server/src/services/__tests__/opencode_agent_writer.test.ts` — added
  focused shared-preamble regression assertions.
- `apps/api_server/src/services/__tests__/opencode_agent_writer_projection.test.ts`
  — generated Secretary, Theologian, and Coding Workflow fixtures and asserted
  direct-work language plus exact delegate task maps.
- `apps/api_server/src/__tests__/live_e2e_manager_direct_routing.test.ts` — added
  a gated live HTTP resync test against the isolated backend.
- `docs/ai/contracts/issue-0-manager-routing.json` — recorded the unnumbered
  request's executable acceptance contract.

## Checks

- Baseline: `ai-workflow checks --level issue` — passed after allowing Flutter
  to update its SDK cache; Flutter analyze, Dart format, and API typecheck green.
- Contract red: `cd apps/api_server && npx vitest run src/services/__tests__/opencode_agent_writer_projection.test.ts src/services/__tests__/opencode_agent_writer.test.ts`
  — expected pre-implementation failure: 2 failed, 24 passed.
- Contract green: same command — 2 files passed, 26 tests passed.
- `cd apps/api_server && node_modules/.bin/tsc --noEmit` — passed.
- `cd apps/api_server && npm run build` — passed.
- Isolated live behavior: rebuilt the fork and API with `tools/dev/sandbox.sh up`,
  then ran
  `HOME=<sandbox>/home DB_PATH=<sandbox>/rhythm.db RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 ./node_modules/.bin/vitest run src/__tests__/live_e2e_manager_direct_routing.test.ts`
  — 1 file passed, 1 test passed. `secretary`, `theologian`, and
  `workflow-orchestrator` were resynced through the real HTTP endpoint; direct
  wording and exact allowlists were observed. Sandbox cleanup passed.
- Terminal issue gate: `MEMORY_VAULT_SUBDIR=memory ai-workflow checks --level issue`
  — passed (Flutter analyze, Dart format, API typecheck).
- Terminal PR gate: `MEMORY_VAULT_SUBDIR=memory ai-workflow checks --level pr`
  — passed, including the full API Vitest suite.
- Terminal API build: `cd apps/api_server && npm run build` — passed.
- Terminal live probe: after polling `/opencode/health` until its JSON status was
  `ready`, `/health` returned `ok`, `/opencode/health` returned `ready`, and the
  gated manager resync test passed (1 file, 1 test). The isolated sandbox was
  removed and ports 4097/4098 were free afterward.
- GitNexus `detect-changes` against `origin/main`: low risk, 4 tracked files,
  one changed production symbol (`buildHubRoutingPreamble`), and zero affected
  execution flows. `git diff --check` passed.

## Notes

- GitNexus upstream impact before edits: `injectManagerPreamble` LOW (1 direct,
  18 total, 2 processes); `writeAgentProfileFile` MEDIUM (11 direct, 21 total,
  2 processes).
- The first fork build attempt was blocked from `models.dev`; rerunning with
  network approval succeeded. A detached sandbox process was reaped by the exec
  boundary, so the passing live test kept sandbox startup, test, and cleanup in
  one controlled command. No `better-sqlite3` ABI mismatch occurred.
- Repair loop: the first full PR gate exposed the known host environment issue
  where `MEMORY_VAULT_SUBDIR` is exported as an empty value; focused memory tests
  reproduced the path mismatch and passed with the repository-documented
  `MEMORY_VAULT_SUBDIR=memory` value. No product change or new follow-up issue was
  needed; `docs/ai/generated-issues/api-server-vitest-memory-vault-env.md` already
  tracks it. The first immediate engine probe also caught startup initialization;
  the terminal probe explicitly waited for JSON status `ready` before testing.
- No generated files under the real `~/.config/opencode/agents/` were edited or
  resynced. No permissions, MCP/skill scope, models, visibility, merge, or deploy
  authority changed.
- Published commit `e9ac62684` on `fix/manager-agents-direct-work` and opened
  draft PR #1097. No merge or deployment was performed.
