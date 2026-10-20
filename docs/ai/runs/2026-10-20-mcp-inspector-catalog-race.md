---
date: 2026-10-20
repo: Rhythm
branch: test/feature-playwright-2026-10-19
pr: null
issues: []
status: unverified
tags: [run, Rhythm]
---

# MCP inspector transient connected/empty catalog

## Files

- `apps/opencode_fork/packages/opencode/src/mcp/index.ts`: when retiring a connected client, change its status to `configured` in the same state update that removes its cached tool definitions; publish the replacement's `connected` status only when the new client and definitions have been stored. Failed status remains intact.
- `apps/opencode_fork/packages/opencode/test/mcp/lifecycle.test.ts`: hold an old client's `close()` during replacement and assert that a `connected` status never coexists with an empty catalog, then assert the new catalog is available after replacement.
- `apps/api_server/src/routes/opencode_mcp_routes.ts`: status and catalog use two engine requests, so re-read status after a connected bundled Rhythm server has no catalog IDs; re-read the catalog if it remains connected, and return explicit 503 when the catalog is still absent. Other valid 0-tool MCP servers retain their behavior.
- `apps/api_server/src/__tests__/opc_m4_3_mcp_routes.test.ts`: cover the interleaving, persistently unavailable catalog, and a transition to `configured`; give existing connected Rhythm fixtures a real tool ID.
- `apps/api_server/src/__tests__/mcp_names_alignment.test.ts`: give its connected Rhythm fixture a real catalog ID while retaining the exact name-set assertions.

## Checks

- Packaged RED at source revision `9dff6ab3761ea3c29a729d3c77804d8f0bf34efe`: `/private/tmp/rhythm-ai-fixture-XfwxrT/recon.json` shows UI GET `/opencode/mcp` at 108023.8 ms returned `rhythm` `connected` with 0 tools, while raw engine default and packaged API-server directory GET `/mcp/tools` returned 114 by 108035.9 ms and a new authenticated API GET returned 114 by 108200 ms. Exact private-home and deleted owned-session directories were `configured` with 0; the UI request carried no directory header/query. The 0 result is transient, not a lasting directory selection mismatch. The engine log under that fixture recorded repeated successful 114-tool client creations around the same time. The original UI request's catalog fetch error status was not captured because the API route swallows catalog errors, so the live observation alone does not prove the precise internal transition.
- Deterministic RED under `npm run build:guard --`: held the old mock MCP client's `close()` during replacement; `mcp.status()` returned `connected` and `mcp.catalog()` returned `[]`. Full output: `/private/tmp/rhythm-mcp-catalog-red-20261020.log`.
- GREEN same focused command: 1/1 passed. Full output: `/private/tmp/rhythm-mcp-catalog-green-focused-20261020.log`.
- Related fork MCP lifecycle and HTTP tests: 40/40 passed under the guard. Full output: `/private/tmp/rhythm-mcp-catalog-green-related-20261020.log`.
- Fork `bun run typecheck` passed under the guard; `/private/tmp/rhythm-mcp-catalog-typecheck-20261020.log`. `git diff --check` passed.
- API route RED under the guard: first status `connected`, first catalog empty, second catalog `rhythm_ping`; the old route returned HTTP 200 with `connected` and `tools: []`. Full output: `/private/tmp/rhythm-mcp-api-snapshot-red-20261020.log`.
- API route GREEN: route/name-alignment tests 29/29 passed under the guard, `/private/tmp/rhythm-mcp-api-related-green-20261020.log`. API `tsc -p tsconfig.json --noEmit` passed under the guard, `/private/tmp/rhythm-mcp-api-typecheck-20261020.log`.

## Notes

- GitNexus upstream impact reported LOW and zero indexed callers for `closeClient`; `createAndStoreInState` and `storeClient` were not found. The Rhythm index is 275 commits behind this worktree, so manual review identified the relevant calls in MCP add/connect/disconnect/ensureClient, catalog, and the engine HTTP endpoints. No HIGH/CRITICAL result was reported.
- GitNexus could not index the anonymous API GET handler (UNKNOWN). Manual route consumers are the MCP inspector and profile catalog clients. `detect_changes --scope unstaged` reported LOW, two indexed symbols and zero processes but missed the anonymous route; manual diff review covers it.
- Packaged green on a binary built from this source is still required before calling the inspector behavior fixed. The full API suite rerun is separately pending after integrated source freeze. No process or model was started by this source repair; packaged Recon was run by the integration owner against the prior build.
