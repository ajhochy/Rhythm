---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: repairing
tags: [run, Rhythm]
---

# MCP inspector transient connected/empty catalog

## Files

- `apps/opencode_fork/packages/opencode/src/mcp/index.ts`: when retiring a connected client, change its status to `configured` in the same state update that removes its cached tool definitions; publish the replacement's `connected` status only when the new client and definitions have been stored. Failed status remains intact.
- `apps/opencode_fork/packages/opencode/test/mcp/lifecycle.test.ts`: hold an old client's `close()` during replacement and assert that a `connected` status never coexists with an empty catalog, then assert the new catalog is available after replacement.
- `apps/api_server/src/routes/opencode_mcp_routes.ts`: status and catalog use two engine requests, so re-read status after a connected bundled Rhythm server has no catalog IDs; re-read the catalog if it remains connected, and return explicit 503 when the catalog is still absent. Other valid 0-tool MCP servers retain their behavior.
- `apps/api_server/src/__tests__/opc_m4_3_mcp_routes.test.ts`: cover the interleaving, persistently unavailable catalog, and a transition to `configured`; give existing connected Rhythm fixtures a real tool ID.
- `apps/api_server/src/__tests__/mcp_names_alignment.test.ts`: give its connected Rhythm fixture a real catalog ID while retaining the exact name-set assertions.
- `apps/api_server/src/__tests__/mcp_inspector_catalog_live_e2e.test.ts`: opt-in sandbox-only gate that validates an exact synthetic read-only fixture and actor, replaces the bundled server through the real engine three times, checks every sampled API response for a coherent 114-tool connected result or explicit 503, and verifies the final raw engine catalog. No model or MCP tool is invoked.

## Checks

- Packaged RED at source revision `9dff6ab3761ea3c29a729d3c77804d8f0bf34efe`: `/private/tmp/rhythm-ai-fixture-XfwxrT/recon.json` shows UI GET `/opencode/mcp` at 108023.8 ms returned `rhythm` `connected` with 0 tools, while raw engine default and packaged API-server directory GET `/mcp/tools` returned 114 by 108035.9 ms and a new authenticated API GET returned 114 by 108200 ms. Exact private-home and deleted owned-session directories were `configured` with 0; the UI request carried no directory header/query. The 0 result is transient, not a lasting directory selection mismatch. The engine log under that fixture recorded repeated successful 114-tool client creations around the same time. The original UI request's catalog fetch error status was not captured because the API route swallows catalog errors, so the live observation alone does not prove the precise internal transition.
- Deterministic RED under `npm run build:guard --`: held the old mock MCP client's `close()` during replacement; `mcp.status()` returned `connected` and `mcp.catalog()` returned `[]`. Full output: `/private/tmp/rhythm-mcp-catalog-red-20261020.log`.
- GREEN same focused command: 1/1 passed. Full output: `/private/tmp/rhythm-mcp-catalog-green-focused-20261020.log`.
- Related fork MCP lifecycle and HTTP tests: 40/40 passed under the guard. Full output: `/private/tmp/rhythm-mcp-catalog-green-related-20261020.log`.
- Fork `bun run typecheck` passed under the guard; `/private/tmp/rhythm-mcp-catalog-typecheck-20261020.log`. `git diff --check` passed.
- API route RED under the guard: first status `connected`, first catalog empty, second catalog `rhythm_ping`; the old route returned HTTP 200 with `connected` and `tools: []`. Full output: `/private/tmp/rhythm-mcp-api-snapshot-red-20261020.log`.
- API route GREEN: route/name-alignment tests 29/29 passed under the guard, `/private/tmp/rhythm-mcp-api-related-green-20261020.log`. API `tsc -p tsconfig.json --noEmit` passed under the guard, `/private/tmp/rhythm-mcp-api-typecheck-20261020.log`.
- `node tools/dev/sandbox_fixture.mjs /private/tmp/rhythm-mcp-catalog-fixture-20261020-01` created a synthetic read-only SQLite DB and local MCP config under the shared guard; `/private/tmp/rhythm-mcp-catalog-fixture-20261020.log`. Normal Vitest mode skipped the live test (1 skipped), `/private/tmp/rhythm-mcp-live-normal-skip-20261020.log`.
- The sandbox's first background `up` built fork/API/MCP successfully and briefly reached ready, but the guard terminated its child process when `up` returned. Its API log showed clean SIGTERM; `sandbox.sh down` removed that owned sandbox and preserved sanitized diagnostics in `/private/tmp/rhythm-mcp-catalog-sandbox-20261020-01.evidence.6ugzz6`. This was a harness-lifetime issue, not an MCP failure.
- The supported `tools/dev/sandbox.sh up --foreground` mode rebuilt fork/API/MCP under `npm run build:guard --`, held the owned runtime on API `4098`, engine `4097`, gateway `4099`, and exited 0 after `down`; full launcher log `/private/tmp/rhythm-mcp-catalog-sandbox-foreground-20261020.log`. `sandbox.sh status` while active reported listener PIDs `11030` (API/gateway) and `11078` (engine).
- Live command: from repo root, set `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4098 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4097 RHYTHM_APPROVED_FIXTURE_ROOT=/private/tmp/rhythm-mcp-catalog-fixture-20261020-01 RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-mcp-catalog-fixture-20261020-01/rhythm.db RHYTHM_SANDBOX_OPENCODE_CONFIG=/private/tmp/rhythm-mcp-catalog-fixture-20261020-01/opencode.json RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-mcp-catalog-sandbox-20261020-02 DB_PATH=/private/tmp/rhythm-mcp-catalog-sandbox-20261020-02/rhythm.db DB_CLIENT=sqlite RHYTHM_OPTIMIZER_MODE=shadow`, then `npm run build:guard -- /bin/zsh -f -c 'cd apps/api_server && npx vitest run src/__tests__/mcp_inspector_catalog_live_e2e.test.ts --fileParallelism=false'`. Three runs passed 1/1 with full logs `/private/tmp/rhythm-mcp-catalog-live-green-20261020.log`, `/private/tmp/rhythm-mcp-catalog-live-green-counted-20261020.log`, and `/private/tmp/rhythm-mcp-catalog-live-green-verbose-20261020.log`. Vitest suppresses this suite's console summary, so the captured assertion evidence is 1/1 pass rather than a measured count of in-flight statuses. `sandbox.sh down` completed and preserved sanitized diagnostics in `/private/tmp/rhythm-mcp-catalog-sandbox-20261020-02.evidence.ftehe0`; `/private/tmp/rhythm-mcp-catalog-sandbox-down-20261020.log`.

## Notes

- GitNexus upstream impact reported LOW and zero indexed callers for `closeClient`; `createAndStoreInState` and `storeClient` were not found. The Rhythm index is 275 commits behind this worktree, so manual review identified the relevant calls in MCP add/connect/disconnect/ensureClient, catalog, and the engine HTTP endpoints. No HIGH/CRITICAL result was reported.
- GitNexus could not index the anonymous API GET handler (UNKNOWN). Manual route consumers are the MCP inspector and profile catalog clients. `detect_changes --scope unstaged` reported LOW, two indexed symbols and zero processes but missed the anonymous route; manual diff review covers it.
- Packaged green on a binary built from this source is still required before calling the inspector behavior fixed. The full API suite rerun is separately pending after integrated source freeze. The live sandbox did start only its owned local API and engine and exercised no model, MCP tool, or operator data.
