---
date: 2026-08-26
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: pending
issues: [1458]
status: ready_for_verification
tags: [run, Rhythm]
---

# Issue #1458 live-gate repair

## Scope and isolation

- Worked only in `/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-s2-verify` at base `a4ee5aae`.
- Initial branch `fix/bridge-stream-reliability-repair` was clean.
- Did not start, stop, or inspect the sandbox and did not touch ports 4001/4096/4098/4097 because S3 owns the sole sandbox.

## Phase 0 — failing acceptance contract

- Added controller coverage for plan, bypassPermissions, omitted/default compatibility, and bypassPermissions on legacy resume.
- Command: `npx vitest run src/__tests__/agent_sessions.test.ts -t '#1458|forwards resolved permission mode'`
- Expected failure observed before production edits: **3 failed, 1 passed, 48 skipped**. Both bypass/default create calls lacked the seventh permission-mode argument; legacy bypass resume called `createSession` with only two arguments.

## Impact analysis

- Invoked GitNexus upstream impact for `AgentSessionsController.create` and `AgentSessionsController.resume` before editing.
- Both returned risk `UNKNOWN`, impacted count 0, and no HIGH/CRITICAL result because the index database is v42 while the connected LadybugDB client storage version is v41:
  `Trying to read a database file with a different version. Database file version: 42, Current build storage version: 41`.

## Files

- `apps/api_server/src/controllers/agent_sessions_controller.ts` — validate to a typed `PermissionMode`, call `createSession` once in each path, and always forward the resolved mode.
- `apps/api_server/src/__tests__/agent_sessions.test.ts` — four focused controller cases plus updated default-call compatibility assertions.
- `apps/api_server/src/__tests__/issue_1458_bypass_engine_permission_live_e2e.test.ts` — deterministic local Anthropic-compatible provider fixture forces the real built-in `read` tool to read a marker outside the session directory.
- `docs/ai/contracts/issue-1458.json` — records repaired focused coverage and pending serial live verification.
- This run note.

## External-directory behavioral strategy

The strengthened live test is behavioral, not a function-called assertion. It creates the bypass session through the real Rhythm API, installs a controlled provider in the isolated engine, forces a real built-in `read` tool call against a sibling directory outside the session cwd, and asserts all of the following observable outcomes:

1. the real engine session stored wildcard `allow`;
2. the provider's second request received the external marker as the real tool result;
3. engine message history records the `read` tool as `completed` with that marker;
4. engine `GET /permission` has no ask for the session.

This passes through built-in external-directory permission evaluation; it does not use the `/session/:id/shell` bypass route. The test was not run in this repair pass because S3 owns the sandbox.

## Checks

- Focused #1458 contract/controller/live-gated files: **56 passed, 1 skipped** (live file skipped without `RHYTHM_LIVE_E2E=1`).
- Focused controller count: `npx vitest run src/__tests__/agent_sessions.test.ts -t '#1458'` — **4 passed, 48 skipped**.
- All S2 focused tests: **151 passed, 5 skipped** across 12 files; skipped tests are env-gated live cases.
- `node_modules/.bin/tsc --noEmit` — **PASS**, no output.
- `git diff --check` — **PASS**, no output.
- GitNexus `detect_changes(scope: "compare", base_ref: "main")` — unavailable with the same v42 index / v41 client mismatch above.

## Handoff

- One focused repair commit: this commit.
- Ready for S3 to rerun the #1458 live gate in its existing isolated sandbox.
