---
date: 2026-06-27
repo: Rhythm
branch: fix/issue-761-agents-ui-render
pr: 763
issues: [mcp-scope-04]
status: smoke-failed
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Secretary MCP scope — live smoke failure

## Files changed

- `docs/ai/project-state.md` — recorded the live scoping blocker.
- `docs/ai/runs/2026-06-27-secretary-mcp-scope-smoke-fail.md` — this run.
- `.agent-stack/postmortems/2026-06-27-mcp-scope-04.json` — structured
  postmortem.
- `.agent-stack/failure-patterns.md` — appended the C2 pattern.

## Checks run

- Confirmed the running listener is the staged fork binary:
  `0.0.0-fix/issue-761-agents-ui-render-202606272206`.
- Confirmed the live Secretary profile has non-empty MCP and skill allowlists.
- Observed new Rhythm session `98af7177-…` and linked engine session
  `ses_0f4bf8…`.
- Queried both databases: Rhythm persisted no `mcp_role` or allowed-tools JSON;
  opencode persisted `mcp_allowlist = NULL`.
- Observed the completed Secretary response name disallowed MCP servers
  including Ableton, Canva, NFL, and ProPresenter.
- Traced the create flow through Flutter, `AgentSessionsController`, and
  `ws_gateway`.

## Notes

- Flutter sends `agentId: "secretary"` but no explicit legacy `mcpRole`.
- `AgentSessionsController` creates the opencode session immediately and only
  builds `mcpRoleConfig` from `body.mcpRole`.
- `ws_gateway` correctly calls `resolveProfileScope(agentKind)` later, but the
  engine session already exists, so its `wsMcpRoleConfig` is not used by any
  `createSession` call.
- Contract `mcp-scope-04` AC-03 claimed the interactive path was covered by the
  `createSession` choke-point unit test. It did not exercise the real REST-first
  lifecycle, making this a C2 wrong-contract divergence.
- No source fix or external follow-up issue was created in this diagnostic run.
