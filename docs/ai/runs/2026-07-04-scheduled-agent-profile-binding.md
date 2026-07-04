---
date: 2026-07-04
repo: Rhythm
branch: feature/config-doctor-agent
pr: null
issues: []
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Scheduled agent profile binding

## Files changed

- `apps/mcp_server/src/tools/agentSchedule.ts` and focused MCP test: expose and
  forward `agentConfigId`.
- api_server scheduled-task contract tests: prove REST create/list/trigger and
  scheduler dispatch retain `AI-Trend-Researcher`, with generic fallback.
- `apps/api_server/src/services/opencode_agent_writer.ts` and tests: prevent
  workflow-orchestrator self-delegation and ensure `permission.write: allow`.
- Local contract, design, plan, project-state, and decision records.

## Checks run

- MCP typecheck and full suite: 68/68 passed.
- api_server typecheck and full suite: 2398 passed, 1 skipped.
- `ai-workflow checks --level issue`: passed.
- `ai-workflow checks --level pr`: passed.
- Isolated API smoke: create → trigger-now → list preserved the profile id.
- Live health after restoration: API, OpenCode engine, and capabilities healthy.
- GitNexus working-tree detection: LOW risk, no affected execution flows.

## Notes

- No schema migration was required; the column, repository, REST API, listing,
  and scheduler launch path already supported `agentConfigId`.
- The isolated smoke briefly displaced the live engine's fixed-port child.
  The live API server was restarted with its original database and memory-vault
  configuration, and all documented health probes returned healthy afterward.
- The external agent-stack repository was not changed.

