---
date: 2026-08-08
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-03]
status: green
tags: [run, mcp_server, live-artifacts]
---

# AV-03 — Agent live-artifact MCP tools

## Files

- Added `apps/mcp_server/src/tools/liveArtifacts.ts` and its Worship Calendar fixture/tests.
- Added one `registerLiveArtifactTools` call in `apps/mcp_server/src/index.ts`.
- Extended the existing external-content/action graph on MCP and API sides.

## Contract

Before implementation, `cd apps/mcp_server && node --test
src/tools/__tests__/liveArtifacts.contract.test.mjs` failed: 7 failed / 1 passed.

After implementation, `npx vitest run
src/tools/__tests__/liveArtifacts.test.ts
src/security/__tests__/external_content_role_graph.test.ts` passed: 10 tests.
`npm run typecheck`, `npm run build`, and `cd apps/api_server &&
node_modules/.bin/tsc --noEmit` passed. `npm run lint` is not defined by
`apps/mcp_server/package.json` (non-zero: Missing script: lint).

## C8 — resolved (was reported as a blocker)

The `tools: []` reading was a wrong-surface conclusion, not a defect. `GET
/opencode/mcp` builds each entry's `tools` array from `opencodeClient.listToolIds()`
→ the engine's `GET /experimental/tool/ids` → `ToolRegistry.ids()`, which returns
**built-in + plugin tools only**. MCP tools are never in that registry; they are
assembled at session-prompt time by `MCP.tools()`
(`apps/opencode_fork/packages/opencode/src/mcp/index.ts`). Measured on the live
sandbox engine:

```
GET http://127.0.0.1:4097/experimental/tool/ids
["invalid","question","bash","read","glob","grep","edit","write","task",
 "webfetch","todowrite","websearch","skill","apply_patch","gemini_quota"]
```

No MCP server's tools appear there — for any server — so the empty array proves
nothing about the rhythm MCP server. Ruled out by direct inspection: stale
`dist` (the engine launches `apps/mcp_server/dist/index.js` from this worktree,
rebuilt with `registerLiveArtifactTools`), wrong command/cwd, startup failure
behind a `connected` status, token/env mismatch, and schema rejection.

The surface that does prove it is a prompt against a real engine session, the
pattern `issue_1175_trusted_mcp_proof_live.test.ts` established. Added
`apps/api_server/src/__tests__/live_artifacts_mcp_live_e2e.test.ts`; against the
sandbox the engine advertised 102 tools (90 `rhythm_*`) including all five new
tools, then drove `create` → `update_state` → `get` as real MCP calls and read
the changed field back over HTTP at the incremented revision under one stable ID.

Two harness facts the test has to handle, both found here:

- `ensureRhythmMcp` defaults `RHYTHM_AGENT_URL` to `http://localhost:4001` — the
  DESKTOP api_server — so the outbound-approval bridge must be repointed at the
  sandbox before any write tool runs.
- The copied desktop DB predates AV-02 and has zero `workspaces` /
  `workspace_members` rows, so the test seeds and removes its own workspace.

## Checks

- `RHYTHM_LIVE_E2E=1 … npx vitest run src/__tests__/live_artifacts_mcp_live_e2e.test.ts
  --no-file-parallelism`: 1 file / 1 test passed (11.58s).
- `apps/api_server`: `node_modules/.bin/tsc --noEmit` exit 0.
- Live desktop DB checked after the run: no `live_artifacts` table at all, 0
  `av03%` workspaces, 0 `AV03%` agent_sessions — no leakage out of the sandbox.

## Impact

- `index.ts`: LOW graph impact, but top-level startup scope handled additively.
- `authorizeOutboundAction`: MEDIUM, 13 direct callers; reused unchanged.
- `scanContextContentAndRecordExternalContentTaint`: MEDIUM, 12 direct callers; reused unchanged.
- `ExternalContentSecurityController`: LOW; additive source/action mapping only.
- MCP registration accounting — two different counts, measured first-hand:
  - **Registrar calls** in `apps/mcp_server/src/index.ts` (`^register…(server`):
    **23 → 24 (+1)**. AV-03 adds exactly one `registerLiveArtifactTools` line.
  - **Tool names** advertised by the assembled server: **85 → 90 (+5)**. The one
    new registrar registers five tools.
  An earlier version of this note said "20 → 25 (+5)", which conflated the two
  and matched neither. The 90 figure agrees with the live run, where the engine
  advertised 90 `rhythm_*` tools.

## Repair pass (2026-08-08, evidence defects)

Five test/evidence defects found by review; no product code changed.

1. **Contract c8 read the wrong file.** It matched `/MCP/` against the AV-02-era
   HTTP-only `live_artifacts_live_e2e.test.ts`, which never drives the engine —
   so it failed (7 pass / 1 fail) and would have proved nothing had it passed.
   It now reads `live_artifacts_mcp_live_e2e.test.ts` across three tests
   asserting the engine-session markers (`/session`, `/session/{id}/message`,
   `RHYTHM_LIVE_ENGINE_URL`), the five advertised `rhythm_rhythm_*` names, the
   `['create','update_state','get']` call order, and revisions 1 then 2.
2. **Registration accounting was wrong** — see the corrected figures above.
3. **The registration guard was stale and passing vacuously.**
   `mcp_capabilities_and_tool_registration.test.ts` claims to mirror index.ts but
   omitted `registerLiveArtifactTools`, so its `toHaveLength(85)` still passed
   and guarded none of the new tools. Added the registrar, re-pinned to a
   measured **90**, asserted the five names explicitly, and added a test that
   the registrar list length equals the count of `register…(server` calls in
   index.ts — the drift that caused this miss now fails loudly.
4. **Live c8 asserted only `old + 1`.** Now asserts the created artifact is at
   state revision **1** and the read-back is **2**, matching AV-02's own route
   test (`live_artifacts.test.ts:87` create → 1, `:227` update → 2).
5. **No AV-03 fail-closed negatives existed.** Added
   `apps/mcp_server/src/tools/__tests__/liveArtifacts.negative.test.ts` (7 tests):
   denied approval and absent trusted session metadata each refuse all three
   writes with **zero mutating calls** to the hosted API, and malformed
   arguments are rejected at the MCP boundary. The malformed cases assert the
   SDK's `-32602 Input validation error` specifically and assert the refusal is
   **not** the "trusted Rhythm session" message — without that discriminator the
   test passed for the wrong reason (the metadata gate), which was verified by
   probing the real `McpServer` before pinning the assertion. Every case asserts
   the bearer token never appears in the tool result.

Also fixed: `apps/mcp_server/vitest.config.ts` now excludes `*.contract.test.mjs`.
The contract harness is a `node --test` file, but Vitest's default include
matches `.mjs`, so `npx vitest run` failed the whole mcp_server suite with "No
test suite found". Suite now runs clean; the harness still runs under `node --test`.

## Repair checks

- `cd apps/mcp_server && node --test src/tools/__tests__/liveArtifacts.contract.test.mjs`: **11 pass / 0 fail**.
- `cd apps/mcp_server && npx vitest run`: **29 files passed, 2 skipped; 169 tests passed, 2 skipped**.
- `cd apps/api_server && npx vitest run src/__tests__/live_artifacts.test.ts src/__tests__/live_artifacts_schema_parity.test.ts`: **24 passed**.
- `cd apps/mcp_server && npm run typecheck` and `npm run build`: exit 0.
- `cd apps/api_server && node_modules/.bin/tsc --noEmit`: exit 0.
- Live c8 re-run through `tools/dev/sandbox.sh up` (API 4098 / engine 4097) with
  the contract's `live_command`: **1 file / 1 test passed (11.84s)** — the
  explicit 1 → 2 revision assertions hold against the real engine. Sandbox torn
  down; desktop DB re-checked afterwards: 0 `live_artifact%` tables, 0 `av03%`
  workspaces, 0 `AV03%` agent_sessions.

## Scope check

`git diff --check` passed. `gitnexus_detect_changes(scope: all, worktree:
this worktree)` reported LOW risk, 7 changed indexed symbols, 0 affected
symbols/processes; new untracked tool/test/contract files are not indexed.
No lockfile appears in `git status --short`.
