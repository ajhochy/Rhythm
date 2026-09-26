---
date: 2026-09-23
repo: Rhythm
branch: swarm/issue-1575
pr: 1544
issues: [1575]
status: needs_context
tags: [run, api_server, mcp_server, issue-1575]
---

# Issue #1575 — async delegation isolated worktree

## Files

- Added `docs/ai/contracts/issue-1575.json`.
- Added focused API and MCP contract tests, plus a maintained env-gated API live
  contract. Repair attempt 1 changes only the API controller validation.

## Acceptance contract (Phase 0)

The contract maps all six supplied acceptance criteria to focused tests.

Repair attempt 1 added `issue-1575-c7` before changing the controller. It
failed as required:

```sh
npm test -- src/__tests__/issue_1575_async_delegation_worktree.test.ts
# FAIL: issue-1575-c7 expected next(BAD_REQUEST); calls: 0
```

Initial dependency state prevented a test run (`vitest: command not found`), so
dependencies were installed in this worktree only and `better-sqlite3` rebuilt.
The real failing contract evidence before implementation was:

```sh
npm --prefix /private/tmp/rhythm-swarm-1575/apps/api_server test -- src/__tests__/issue_1575_async_delegation_worktree.test.ts
# FAIL: issue-1575-c2 expected createWorktree('/repo/manager', { name: 'issue-1575-child' }); calls: 0
# FAIL: issue-1575-c3 child cwd was '/repo/manager'; worktree metadata was null

npm --prefix /private/tmp/rhythm-swarm-1575/apps/mcp_server test -- src/tools/issue_1575_agentDelegation_worktree.test.ts
# FAIL: request body omitted isolateWorktree and worktreeName
```

## Impact (Phase 1)

All analysis used GitNexus repository `Rhythm`:

- `delegateToAgentAsync` in
  `apps/api_server/src/services/agent_delegation_service.ts`: **LOW**, 1 direct
  caller (`apps/api_server/src/contract/issue_1175_security_review.test.ts`),
  no affected processes.
- `AgentDelegationController.delegateAsync`: **LOW**, 0 direct callers, no
  affected processes.
- `registerAgentDelegationTools`: **LOW**, 3 direct callers (MCP index and two
  focused tests), no affected processes.
- `AgentSessionsRepository.upsertChildSession` in
  `apps/api_server/src/repositories/agent_sessions_repository.ts`: **CRITICAL**,
  6 direct callers, 123 total impacted symbols through depth 3, six affected
  modules, and two affected process families: `createMobileGatewayRouter`
  (three process hits, earliest step 1) and `distillFromSession` (one hit,
  earliest step 1).

## Implementation

- Did not modify `upsertChildSession` or `setWorktree`.
- `delegateToAgentAsync` now creates an optional worktree from the stored parent
  cwd, uses one effective cwd for create/upsert/stream/prompt, and writes its
  returned metadata through the existing `setWorktree` helper after enqueue.
- `rhythm_delegate_async` forwards the two optional fields through the existing
  signed payload and controller; the controller accepts no caller-provided cwd.
- Repair attempt 1: `delegateAsync` now rejects a supplied non-boolean
  `isolateWorktree` with `400 BAD_REQUEST`; omitted remains false and literal
  booleans keep their existing behavior.

## Checks

- Initial contract failure (before product edits): API 2 failed / 1 passed;
  MCP 1 failed. See the commands and excerpts above.
- Final contract:
  `npm --prefix /private/tmp/rhythm-swarm-1575/apps/api_server test -- src/__tests__/issue_1575_async_delegation_worktree.test.ts`
  → 4 passed.
- Final MCP contract:
  `npm --prefix /private/tmp/rhythm-swarm-1575/apps/mcp_server test -- src/tools/issue_1575_agentDelegation_worktree.test.ts`
  → 1 passed.
- Affected existing coverage: API repository/security contracts → 19 passed;
  MCP delegation coverage → 3 passed.
- Builds: `npm --prefix apps/api_server run build` and
  `npm --prefix apps/mcp_server run build` passed.
- Fork source build could not run in this worktree because its dependencies are
  absent (`Cannot find module '@opencode-ai/script'`). The sandbox reused the
  already-built `/Users/ajhochhalter/Documents/Rhythm/.../opencode` binary only
  after `git diff --quiet 788e7ccc -- apps/opencode_fork` confirmed identical
  fork source.

## Prior candidate sandbox evidence (superseded)

Used only the supplied read-only fixture root/config/database and sandbox
`/private/tmp/rhythm-swarm-1575-sandbox` on ports 4298/4297/4299. The final
`tools/dev/sandbox.sh up/status/down` completed; no live port was contacted.

Authenticated API dispatch returned `dispatched` for child
`c0955a94-2f41-4289-8b74-64de681ea7cd`. A subsequent real API read reported:

```json
{
  "childCwd": "/private/tmp/rhythm-swarm-1575-sandbox/home/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/issue1575-1790215772045",
  "worktreeName": "issue1575-1790215772045",
  "worktreePath": "/private/tmp/rhythm-swarm-1575-sandbox/home/.local/share/opencode/worktree/a4784d9c54aa2929a09fdab2213ff827a3cb60a5/issue1575-1790215772045",
  "worktreeBranch": "opencode/issue1575-1790215772045"
}
```

This was first-candidate evidence and is not counted as repair-attempt-1 live
verification. The product code contains no `removeWorktree` call; the contract
also asserts that omission.

## Repair attempt 1 verification (2026-09-23)

- API unit contract: `npm test -- src/__tests__/issue_1575_async_delegation_worktree.test.ts src/__tests__/issue_1575_async_delegation_worktree_live.test.ts`
  → **5 passed, 2 skipped** (the two live tests are env-gated).
- API build: `npm run build` → **passed**.
- Live sandbox used only `/private/tmp/rhythm-swarm-1575-repair2-sandbox`,
  fixture `/private/tmp/rhythm-open-issue-swarm-fixture`, and ports
  `4998/4997/4999`; it was stopped with `tools/dev/sandbox.sh down`.
- `issue-1575-c6` live failure/preservation command → **1 passed**. The real
  engine returned `502 SDK_ERROR` for a non-git worktree request; the test
  proved its dirty marker remained and `/children` stayed empty.
- Full live `issue-1575-c4/c6` attempt → **failed**: c4 created the actual
  server worktree and child, but no CWD report arrived within 180 seconds.
  Sandbox logs show the isolated fixture has no usable Gemini credentials
  (`CredentialsBridge ... no creds available`). c4 is therefore `UNVERIFIED`
  and listed in `not_tested`, not recorded as a pass.
- Astra rerun remains mandatory; this environment provides no Astra execution
  interface, so it was not run or claimed.

## Handoff

NEEDS_CONTEXT — provide a sandbox fixture with an authenticated runnable
provider (and run Astra verification) to execute `issue-1575-c4`. No commit,
push, merge, stash, or clean was performed.

## Repair 2 (2026-09-24)

### Defects

- P1: a late/repeated `session.created` upsert replaced child-owned
  `worktree_name`, `worktree_path`, and `worktree_branch` with the parent's
  values. Existing non-null child values now win on the update path.
- P2: async delegation persisted the worktree triple only after a successful
  prompt enqueue. The triple is now written immediately after the child row is
  created, before stream subscription and enqueue.

### Files

- `apps/api_server/src/repositories/agent_sessions_repository.ts`
- `apps/api_server/src/services/agent_delegation_service.ts`
- `apps/api_server/src/__tests__/issue_1575_async_delegation_worktree.test.ts`
- `apps/api_server/src/repositories/agent_sessions_repository.test.ts`
- `docs/ai/contracts/issue-1575.json`
- `docs/ai/runs/2026-09-23-issue-1575-contract-and-impact.md`

### Checks

- Before the product repair:
  `npx vitest run src/__tests__/issue_1575_async_delegation_worktree.test.ts src/repositories/agent_sessions_repository.test.ts`
  -> **3 failed, 32 passed (35 total)**. The failures were the enqueue-failure
  null triple and both late-upsert parent-overwrite assertions.
- After the product repair, the same combined command -> **35 passed (35)**.
- Required focused command:
  `npx vitest run src/__tests__/issue_1575_async_delegation_worktree.test.ts`
  -> **7 passed (7)**.
- Touched repository test:
  `npx vitest run src/repositories/agent_sessions_repository.test.ts`
  -> **28 passed (28)**.
- No file matched
  `src/__tests__/agent_sessions_repository*.test.ts`; the repository test is
  located at `src/repositories/agent_sessions_repository.test.ts` and was run
  directly above.
- Requested literal typecheck:
  `npx tsc --noEmit -p tsconfig.json` -> **did not reach TypeScript** because
  `/Users/ajhochhalter/.local/bin/npx` attempted to fetch the registry package
  `tsc` and failed with `ENOTFOUND registry.npmjs.org`.
- Installed-compiler offline equivalent:
  `npm --prefix . exec --offline --package=typescript -- tsc --noEmit -p tsconfig.json`
  -> **exit 0** with TypeScript 5.9.3 and no diagnostics.

No sandbox, API server, Playwright, Flutter, or `RHYTHM_LIVE_E2E` command was
run. Criterion `issue-1575-c4` (live child-observed cwd) remains **UNVERIFIED**.
