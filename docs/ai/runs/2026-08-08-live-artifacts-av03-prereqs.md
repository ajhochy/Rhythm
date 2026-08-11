---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-03]
status: READY_FOR_VERIFICATION
tags: [run, api_server, sandbox, live-artifacts]
---

# AV-03 prerequisite recovery

## Worktree and required paths

- `pwd`: `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-artifact-viewer`
- Verified: `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-artifact-viewer/docs/ai/contracts/live-artifacts-av03.json`
- Verified: `/private/var/folders/f0/kwf9lqtx57qgt3j4rbtvg1ym0000gn/T/opencode/rhythm-artifact-viewer/apps/mcp_server/src/tools/__tests__/liveArtifacts.test.ts`

## Files

- Added `docs/ai/contracts/live-artifacts-av03-prereqs.json`.
- Updated AV-02 create validation/persistence/storage cleanup and its focused tests.
- Updated `tools/dev/sandbox.sh` and the existing sandbox lifecycle fake.
- No MCP tool/index/security-graph, Flutter, PCO, schema, Gallery, or global logger/error-handler files changed.

## Contract

Initial failing run:

```text
cd apps/api_server && npx vitest run src/__tests__/live_artifacts.test.ts src/__tests__/opc_rhythm_mcp_ensure.test.ts --no-file-parallelism
```

Failed as intended: P1 collaborator list returned `[]`; P2 returned `201` for
invalid collaborators; P4 lacked `ensure_rhythm_mcp`.

`docs/ai/contracts/live-artifacts-av03-prereqs.json`: P1–P5 are `pass`.

## Checks

- `npx vitest run src/__tests__/live_artifacts.test.ts src/__tests__/opc_rhythm_mcp_ensure.test.ts src/__tests__/issue_1186_sandbox_foreground.test.ts --no-file-parallelism` — PASS, 38 tests.
- `node_modules/.bin/tsc --noEmit` — PASS.
- `npm run build` — PASS.
- `tools/dev/sandbox.sh up && status && down` — PASS. The safe config inspection confirmed `RHYTHM_API_URL=http://127.0.0.1:4098`, a non-empty sandbox session token, and no token in `api_server.log`; output used only `token redacted`. The sandbox directory and generated storage were removed. The pre/post `:4096` listener identity was unchanged.
- `git diff --check` — PASS.
- `npm test -- --fileParallelism=false` — FAIL: 12 pre-existing/unrelated failures in memory, agent-research, delegation, and audit-lock suites. Its three sandbox-foreground failures were due to the fixture not providing the now-required sandbox session; after updating that focused fake, the sandbox suite passed above.

## Risk

- New AV-02 files are not indexed; manual trace was `POST create → validate all workspace collaborators → immutable storage → repository transaction → collaborator rows`.
- GitNexus `detect_changes(scope: all)` reported LOW risk and no affected processes; it only saw pre-existing indexed AV-01 symbols, not new AV-02 symbols.
