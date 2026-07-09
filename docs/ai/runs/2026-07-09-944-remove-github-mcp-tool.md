---
date: 2026-07-09
repo: Rhythm
branch: issue-944-remove-github-mcp-tool
pr: 963
issues: [944]
status: verified
tags: [run, Rhythm]
---

# #944 — remove GitHub issue tool from rhythm MCP

## Re-scope

Issue #944 asked to plumb `GITHUB_TOKEN` into the api_server env so
`rhythm_create_issue` stops failing. AJ re-scoped it on 2026-07-09: **delete
the GitHub surface from the rhythm MCP instead** — agents already file issues
via the `gh` CLI in their bash tool (authenticated, proven in the issue's own
diagnosis), so the MCP tool was a duplicate write-path needing its own token
plumbing.

## Files

- `apps/mcp_server/src/tools/githubIssues.ts` — deleted (the only GitHub
  tool, `rhythm_create_issue`; added in #870)
- `apps/mcp_server/src/tools/githubIssues.test.ts` — deleted
- `apps/mcp_server/src/index.ts` — registration removed; tombstone comment
- `apps/mcp_server/src/__tests__/mcp_capabilities_and_tool_registration.test.ts`
  — registrar entry removed (test still mirrors index.ts exactly)
- `apps/mcp_server/package.json` — version 0.6.1 → 0.6.2 (next npm publish
  carries the removal; the #814 pin reads this file, and its test mocks the
  read, so nothing else moves)

## Checks

- GitNexus impact (pre-edit): `registerGithubIssueTools` upstream = LOW,
  2 direct callers (index.ts + own test), both inside the removal scope.
  `detect_changes` skipped — fresh worktree isn't indexed; `git diff --stat`
  confirmed the change surface = the 5 files above.
- `tsc -p tsconfig.json --noEmit` — clean.
- `vitest run` (apps/mcp_server) — 15 files, 72/72 pass (includes the #864
  registration-parity guard).
- **Live behavioral check (real entry point, no mock):** spawned the BUILT
  `dist/index.js` over stdio via the MCP SDK `StdioClientTransport`, called
  `tools/list` — `rhythm_create_issue` absent, no tool name matching
  github/create_issue. PASS. Command: `node scratchpad/list_mcp_tools.mjs`
  (spawns `node dist/index.js` with `RHYTHM_API_TOKEN=smoke-token`).
  No RHYTHM_LIVE_E2E-gated test added — asserting the permanent absence of a
  deleted tool is a tombstone test; the #864 parity guard already pins the
  registered set to index.ts.

## Notes

- No `.mcp-roles` profile, api_server allowlist, or skill referenced
  `rhythm_create_issue` (repo-wide grep) — removal is contained to
  `apps/mcp_server`.
- No env plumbing to clean up: `RHYTHM_GITHUB_TOKEN`/`GITHUB_TOKEN` was read
  only inside the deleted tool (that's why it never worked from the app).
- Deploy note: the bundled-payload path picks this up on the next release
  build automatically; the pinned-npx fallback needs `npm publish` of 0.6.2
  (manual, AJ's call — same flow as the 0.6.1 publish on 2026-06-29).
