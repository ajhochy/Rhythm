---
date: 2026-07-07
repo: rhythm
branch: fix/agent-profile-core-permissions
pr: null
issues: []
status: implemented-needs-verification
tags: [run, rhythm]
---

# Agent profile permission fix

## Files
- `apps/api_server/src/services/opencode_agent_writer.ts` — projects profile-local opencode core permissions for `Theological-Researcher` (`bash`, `read`) and `config-doctor` (`bash`, `read`, `edit`).
- `apps/api_server/src/server.ts` — reprojects Config Doctor and Theological-Researcher agent files on boot.
- `apps/api_server/src/database/migrations.ts` — backfills Config Doctor's prompt so it understands MCP-vs-core permission diagnosis and REST PATCH repair semantics.
- `apps/api_server/src/__tests__/agent_configs.test.ts` and `apps/api_server/src/services/__tests__/opencode_agent_writer_projection.test.ts` — regression coverage.

## Checks
- PASS: `cd apps/api_server && npx vitest run src/__tests__/agent_configs.test.ts src/services/__tests__/opencode_agent_writer_projection.test.ts` (`2 files, 20 tests`).
- PASS: `cd apps/api_server && node_modules/.bin/tsc --noEmit`.

## Notes
- `bash`, `read`, and `edit` are opencode core permissions, not MCP server names. They are now written into projected agent frontmatter only for the two profiles that need them.
- Config Doctor remains narrow on MCP scope (`rhythm`) and uses localhost REST PATCH/resync for profile-scope repairs; null/omitted/`[]` semantics are called out in its prompt.
