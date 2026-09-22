---
date: 2026-09-22
repo: Rhythm
branch: feat/prompt-existing-session
pr: TBD
issues: []
status: awaiting-review
tags: [run, rhythm]
---

# Prompt an existing agent session (endpoint + MCP tool)

## Files

- `apps/api_server/src/database/migrations.ts` — `agent_prompt_injections`,
  append-only (delete trigger), SQLite-only.
- `apps/api_server/src/repositories/agent_prompt_injections_repository.ts` — new.
  `record()` before dispatch, `settle()` after, `listForSession()`.
- `apps/api_server/src/controllers/agent_sessions_controller.ts` — `prompt()`
  (202) and `promptLog()`. `prompt()` delegates to `handleInputFrame` with a
  socket shim that turns the gateway's error frames into a 502.
- `apps/api_server/src/routes/agent_sessions_routes.ts` —
  `POST /:id/prompt`, `GET /:id/prompt-log`.
- `apps/mcp_server/src/tools/agentSessions.ts` — `rhythm_prompt_session`, gated
  on the new `session.prompt` outbound action, routed at `RHYTHM_AGENT_URL`.
- `session.prompt` registered in the three mirrored action lists
  (`external_content_boundary.ts`, `external_content_security_service.ts`,
  `external_content_security_controller.ts`).

## Checks

- `tsc --noEmit` — clean, both `api_server` and `mcp_server`.
- `apps/mcp_server` vitest — 188 passed, 2 skipped.
- `apps/api_server` vitest (non-live) — 6104 passed, 27 skipped, **1 failed**:
  `workflow_failure_signal_extractor.test.ts > stale-redo`. Pre-existing
  full-suite flake: passes in isolation both with and without this branch's
  changes, and touches none of the files here.
- New: `issue_1577_prompt_existing_session.test.ts` — 4 tests. Asserts the
  prompt reaches `promptAsync`, the audit row attributes an **unrelated** caller
  (a regression toward parentage-gating fails here), empty prompts 400 without
  dispatching or auditing, the delete trigger fires, and `prompt-log` serves it.

## Notes

- No live smoke. Session `325e03e3` is a live orchestrator with in-flight
  children and the running :4001 server is the old build; restarting it to test
  would have disturbed it. The test drives the real Express app end to end.
- Endpoint is local-agent-server only. See the decision record for why
  Cloudflare/production cannot host it.
- Adjacent open issues, untouched here: #1576 (routed models break provenance —
  same provenance gap this log addresses for a different path), #1575 (child
  sessions inherit the manager's cwd).
