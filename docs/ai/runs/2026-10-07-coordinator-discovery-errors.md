---
date: 2026-10-07
repo: Rhythm
branch: codex/coordinator-conversation-20261007
pr: null
issues: []
status: unverified
tags: [run, rhythm, coordinator]
index: "[[Rhythm]]"
---

# Coordinator discovery errors

## Files

- `apps/opencode_fork/packages/opencode/src/session/prompt.ts` — classify deferred MCP execute/describe names from the fresh permitted inventory before reporting an allowlist denial.
- `apps/opencode_fork/packages/opencode/test/session/mcp_allowlist_e2e.test.ts` — cover a cold excluded server whose name must not be probed merely to improve an error message.

## Checks

- PASS `bun test test/session/mcp_allowlist_e2e.test.ts -t 'Coordinator discovery errors'` — 2 passing contracts.
- PASS `bun test test/session/mcp_allowlist_e2e.test.ts` — 24 passing integration cases.
- PASS `bun test src/session/mcp_deferred_tools.test.ts` — 19 passing helper cases.
- PASS `bun run typecheck` after the orchestrator isolated this worktree's fork dependency graph. Initial linked dependencies crossed into the donor worktree and produced duplicate protected-client identities; the donor was not changed. Evidence: `fork-typecheck-isolated-final.log` in the task evidence directory.
- PASS independent root run `bun test src/session/mcp_deferred_tools.test.ts test/tool/coordinator-task-permissions.test.ts` — 21 cases, including real Task permission retention through depth three and resume.

## Notes

Unknown names now report unknown/current-inventory; a permitted registered alias tells the caller to use its canonical name; a cached known but excluded canonical name remains an allowlist denial. A cold excluded server is never started only to classify its canonical name, so it reports unknown/current-inventory without leaking a denied alias. No execution path or grant filtering changed.
