---
date: 2026-07-28
repo: Rhythm
branch: codex/mobile-1172-agents-activity
pr: 1165
issues: [1226]
status: pass
tags: [run, Rhythm]
---

# Issue #1226 trusted boundary live verification

## Files

- `apps/api_server/src/__tests__/issue_1175_trusted_mcp_proof_live.test.ts`
- `apps/mcp_server/src/security/security_context.ts`
- `apps/mcp_server/src/security/external_content_boundary.ts`
- `apps/mcp_server/src/tools/_tool.ts`
- `apps/api_server/src/controllers/external_content_security_controller.ts`
- `apps/api_server/src/services/external_content_security_service.ts`
- `apps/api_server/src/security/trusted_mcp_call.ts`

## Checks

- Built the fork offline by setting `MODELS_DEV_API_JSON` to the repository's
  `packages/opencode/test/tool/fixtures/models-api.json`.
- Built `apps/api_server` and `apps/mcp_server`.
- Started the isolated sandbox through `tools/dev/sandbox.sh up --foreground`
  with API `54175`, engine `55175`, and state under
  `/private/tmp/rhythm-issue1226-live`.
- Ran:

  ```bash
  RHYTHM_LIVE_E2E=1 \
  RHYTHM_LIVE_E2E_ISOLATED=1 \
  RHYTHM_LIVE_URL=http://127.0.0.1:54175 \
  RHYTHM_LIVE_ENGINE_URL=http://127.0.0.1:55175 \
  RHYTHM_LIVE_DB_PATH=/private/tmp/rhythm-issue1226-live/rhythm.db \
  RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-issue1226-live \
  npx vitest run \
    src/__tests__/issue_1175_trusted_mcp_proof_live.test.ts \
    --reporter=verbose --testTimeout=60000
  ```

- Result: PASS, 1/1 test in 16.929 seconds.
- Stopped and removed the sandbox through the exact scoped
  `tools/dev/sandbox.sh down` command. API and engine listeners were removed.

## Notes

- The local Anthropic SSE fixture caused the real fork to issue
  `rhythm_create_task` and `rhythm_list_tasks` calls.
- The MCP server forwarded the fork-generated Ed25519 proof and original
  arguments to the API. No private signer was created in the test process.
- Valid task consume and task-list taint requests returned 200 and 201.
- Replayed and altered requests returned 403.
- The valid write created the expected task, and the valid read persisted a
  `task.list` taint for the real engine session.
