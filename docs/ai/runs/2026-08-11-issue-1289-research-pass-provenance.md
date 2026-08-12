---
date: 2026-08-11
repo: Rhythm
branch: mega-ws/research
pr: null
issues: [1289]
status: local-verified
tags: [run, Rhythm]
---

# Issue #1289 — research pass provenance

## Files

- Added the versioned `rhythm_complete_research_pass` MCP contract and approval classification.
- Reworked specialist indexing to accept only scheduled/project evidence, normalize curated URLs, validate confined real Markdown files and hashes, retain honest partial captures, and idempotently persist artifacts/sources.
- Kept ownerless legacy provenance representable with SQLite/Postgres nullability parity.

## Checks

- `cd apps/api_server && node_modules/.bin/tsc --noEmit` — pass.
- `cd apps/api_server && npm run build` — pass.
- `cd apps/api_server && node_modules/.bin/vitest run src/__tests__/contract/issue_1288.test.ts src/__tests__/contract/issue_1289.test.ts src/__tests__/specialist_research_indexer.test.ts src/__tests__/migrations_replay_guard.test.ts src/__tests__/migrations_self_heal.test.ts` — 19 passed.
- `cd apps/mcp_server && node_modules/.bin/tsc --noEmit && npm run build` — pass.
- `cd apps/mcp_server && node_modules/.bin/vitest run --exclude src/__tests__/api_client.test.ts --exclude src/tools/__tests__/orgOptimizer.test.ts` — 176 passed, 2 env-gated skipped.

## Notes

- Full API/MCP runs confirmed the documented sandbox limitation: socket-binding suites fail with `listen EPERM` or their dependent timeout. The orchestrator must run socket/live suites outside this sandbox.
- The #1300 env-gated real sandbox E2E remains the milestone-level live behavioral gate; it was not run here by instruction.
