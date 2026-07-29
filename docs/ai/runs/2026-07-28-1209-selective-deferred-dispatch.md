---
date: 2026-07-28
repo: rhythm
branch: issue/1209-bm25-skill-scorer
pr: null
issues: [1209]
status: verified-upstream
tags: [run, rhythm]
---

# Issue #1209 — selective deferred MCP dispatcher

## Files

- `tool_surface_estimator.ts` identifies authorized servers with at least 30
  estimated tools as fat and estimates the eager-versus-deferred schema cost.
- `opencode_client_service.ts` carries `deferredServers` on both session create
  and per-turn PATCH for every provider.
- The fork session schema and prompt resolver accept selective deferred servers,
  retain eager schemas for other servers, and keep the existing dispatcher
  execute-time allowlist check.

## Tool-surface measurement

Profile: checked-in `.mcp-roles/worship-production.mcp.json`.

Command: `cd apps/api_server && node --import tsx --input-type=module -e <measurement>`

- Before: 99 tools / 12,375 estimated schema tokens.
- Fat server selected by estimator: `ableton-mcp` (44 tools).
- After: 7,000 estimated schema tokens (non-fat eager schemas + builtins + one
  dispatcher schema).
- Estimated savings: 5,375 tokens (43.43%).

## Checks

- API focused contracts: 71 passed.
- Fork deferred helper: 12 passed with
  `bun test --config=/dev/null src/session/mcp_deferred_tools.test.ts`.
- Orchestrator verification reconciliation: API build exit 0, fork
  `build --single` exit 0, and 3,636 tests passed. The unrelated #1134 and
  sandbox-foreground failures were load flakes and passed in isolation.

## Notes

The authorization lists remain unchanged. `deferredServers` only chooses the
presentation mode for tools already admitted by `servers`/`tools`. Malformed
allowlists remain rejected by the fork schema, and the dispatcher rechecks the
same allowlist at execution time. The existing whole-allowlist `deferred: true`
Gemini workaround is unchanged.

## Verification reconciliation

The earlier local sandbox diagnostics were superseded by the orchestrator's
full verification environment. The only real regression was the BM25 0.5
relative threshold dropping a genuinely relevant secondary skill; the repair
and derivation are recorded in the BM25 run log and `.proof/i1209`.
