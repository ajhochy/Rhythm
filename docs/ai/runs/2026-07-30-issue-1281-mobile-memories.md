---
date: 2026-07-30
repo: Rhythm
branch: codex/fix-mobile-memories-tool
pr: null
issues: [1281]
status: verified
tags: [run, Rhythm, mobile, memory]
---

# Issue #1281 — mobile Memories false-empty

## Files

- `apps/api_server/src/repositories/agent_memory_repository.ts` — include
  instance-global owner-NULL vault memories alongside the authenticated
  reader's private rows in both SQLite and Postgres list queries.
- `apps/api_server/src/contract/issue_1281_mobile_memories.test.ts` — paired
  admin HTTP contract with a global-memory row and a foreign-owner control.
- `apps/mobile/tests/contract/issue-1281-mobile-memories.test.mjs` — proves
  the mobile adapter preserves the server's real array row shape and reserves
  empty for a successful `[]`.
- `apps/api_server/src/__tests__/issue_1175_pairing_tool_auth_live.test.ts` —
  adds the observable global-memory list assertion to the env-gated live
  paired-device flow.
- `docs/ai/contracts/issue-1281.json` — two automated acceptance criteria.

## Checks

- Red contract:
  `npx vitest run src/contract/issue_1281_mobile_memories.test.ts --no-file-parallelism`
  — 1/1 failed as expected; HTTP status was 200 and body was `[]` despite a
  seeded owner-NULL memory.
- Green contracts: API 1/1 and mobile 1/1.
- Focused regressions: API 7/7; mobile Tools/classification 14/14.
- Static: `npx tsc -p tsconfig.json --noEmit` (API) and
  `npm run typecheck` (mobile) passed; mobile lint passed.
- Builds: API build passed; fork `bun run build --single` passed and its
  binary smoke reported the branch version.
- Live:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1
  RHYTHM_LIVE_URL=http://127.0.0.1:42198
  RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-dev-sandbox-issue-1281/rhythm.db
  RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-dev-sandbox-issue-1281
  npx vitest run src/__tests__/issue_1175_pairing_tool_auth_live.test.ts
  --no-file-parallelism`
  — 1/1 passed against the rebuilt API/fork sandbox. A final fresh run also
  returned HTTP 200 from `/health`, `/opencode/health`,
  `/agents/capabilities`, and `/mobile-gateway/health`; the sandbox was
  removed and left no listeners on its three isolated ports.
- Full API first attempt: 3769 passed / 119 skipped / 5 unrelated timeout
  failures plus one worker-start error. Exact rerun: 3779 passed / 119 skipped
  / 0 failed. Isolated prior failures: sandbox foreground 7/7, curated MCP
  4/4, Gmail signals 5/5.
- Mobile Jest: 4/4 passed.
- `PLAYWRIGHT_FAKE_PORT=45196 PLAYWRIGHT_WEB_PORT=45197
  ai-workflow checks --level pr` — passed every Flutter, API, MCP, fork, and
  mobile gate. The first aggregate runs exposed an unrelated issue-653
  shared-state mismatch and a sibling-worktree Playwright port collision;
  issue-653 passed 5/5 in isolation, mobile Playwright passed 69/69 on
  dedicated ports, and the final full aggregate rerun passed.
- GitNexus staged `detect-changes` against this exact worktree: 7 files,
  11 indexed symbols, 0 affected execution processes, low risk.

## Notes

The mobile normalizer was a known-working control: it retained the actual
server row shape before any implementation change. The root cause was the
server list predicate, which filtered authenticated callers to
`owner_user_id = caller` and therefore dropped the vault's normal owner-NULL
rows. Search already used the correct own-or-global visibility rule.

No production data, installed app, port 4001, protected mobile session
security/ownership services, push, or merge was touched.
