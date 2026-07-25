---
date: 2026-07-24
repo: Rhythm
branch: codex/1157-anthropic-tool-schema
pr: null
issues: [1157]
status: complete
tags: [run, Rhythm]
---

# Issue #1157 — Anthropic tool-schema sanitization

## Files

- `apps/opencode_fork/packages/opencode/src/provider/transform.ts`
- `apps/opencode_fork/packages/opencode/test/provider/transform.test.ts`
- `apps/api_server/src/__tests__/fixtures/issue_1157_invalid_schema_mcp.mjs`
- `apps/api_server/src/__tests__/issue_1157_anthropic_tool_schema_live.test.ts`
- `docs/ai/contracts/issue-1157.json`

## Checks

- `bun test test/provider/transform.test.ts` — PASS, 231 tests.
- `bun run typecheck` — PASS.
- `bun test test/session/llm.test.ts` — PASS, 15 tests.
- `bun run build --single` — PASS; standalone binary smoke returned its version.
- `npx tsc --noEmit` — PASS.
- `npm run build` in `apps/api_server` — PASS.
- Without `RHYTHM_LIVE_E2E=1`, the live test loads and skips — PASS.
- Isolated branch server:
  `RHYTHM_SANDBOX_DIR=/tmp/rhythm-dev-sandbox-1157 RHYTHM_SANDBOX_API_PORT=4198 RHYTHM_SANDBOX_ENGINE_PORT=4197 tools/dev/sandbox.sh up`
  — PASS; rebuilt this branch's fork and API server, with health at `127.0.0.1:4198` and engine at `127.0.0.1:4197`.
- Live behavior:
  `RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 RHYTHM_LIVE_URL=http://127.0.0.1:4198 RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:4197 RHYTHM_SANDBOX_OPENCODE_JSON=/tmp/rhythm-dev-sandbox-1157/home/.config/opencode/opencode.json DB_PATH=/tmp/rhythm-dev-sandbox-1157/rhythm.db npx vitest run src/__tests__/issue_1157_anthropic_tool_schema_live.test.ts`
  — PASS, 1/1. The real engine loaded the MCP fixture, sent its tool to a strict local Anthropic-compatible endpoint without a top-level combiner, and persisted the endpoint's assistant response.

## Notes

- The first fixture attempt omitted MCP's required `inputSchema.type: "object"` and correctly failed before model dispatch. A second attempt reused that failed MCP status in the live engine cache. The passing evidence was captured after a fresh sandbox engine launch with the corrected protocol fixture.
- The strict endpoint returns HTTP 400 if any outbound tool retains top-level `anyOf`, `oneOf`, or `allOf`, so this gate would fail against the pre-fix engine.
- The unrelated server on 4098/4097 was never stopped or reused.
