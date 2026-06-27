# P2-2: Wire extractor into AgentRunner + WS turn (non-blocking)

## Goal

After `AgentRunner.run()` completes and after `ws_gateway.handleSessionInput` turns resolve, count rounds-or-tools on the session and queue the skill extractor WITHOUT AWAITING it. Fire-and-forget: the turn must resolve immediately, and any extractor failure must never block or reject the user-facing turn.

## Context

Phase 2's self-improvement loop depends on wiring the extractor (P2-1) into two execution points:
1. After `AgentRunner.run()` completes (batch-style agent runs)
2. After `ws_gateway.handleSessionInput` processes a user turn (interactive agent sessions)

Both must count rounds-or-tools, determine eligibility, queue the extractor, and move on without waiting. Failures are logged but swallowed.

## Likely files

- `apps/api_server/src/services/agent_runner.ts` (post-run hook, ~line 290–309 area where `effectiveSystemPrompt` is built, and line 404 where `opencodeClient.prompt` is called)
- `apps/api_server/src/services/ws_gateway.ts` (`handleSessionInput` completion, ~line 207 or 573–583 where prompts are forwarded)

## Acceptance Criteria

- [ ] **AgentRunner wiring:**
  - After `AgentRunner.run()` resolves, count rounds-or-tools in the session (via `agent_session_messages` query)
  - If ≥2 rounds/tools, invoke `skillExtractor.distillFromSession(sessionId)` WITHOUT awaiting
  - Use `Promise.prototype.then().catch()` or fire-and-forget pattern (no await, no .catch that throws)
  - Failures logged at error level, never propagated to caller
  - Turn result is unaffected (returned immediately whether extractor queues or not)

- [ ] **WS gateway wiring:**
  - In `handleSessionInput` after the prompt is forwarded and turn completes, count rounds-or-tools
  - If ≥2 rounds/tools, queue extractor (same fire-and-forget pattern as AgentRunner)
  - Failures logged, never bubble up to the WebSocket client

- [ ] **Non-blocking vitest:**
  - Test confirms a turn resolves/returns without awaiting distill (measure that the return happens before the extractor completes)
  - Injected throwing extractor (e.g., throws within 100ms) does NOT reject the turn result
  - Extractor is called only when ≥2 rounds/tools (not called for short conversations)

- [ ] **Logging:** Both call sites log at debug/info level: `"Queuing skill extractor for sessionId X"` on queue, and error level on failure: `"Skill extractor failed: ..."`.

- [ ] **tsc + vitest:** `tsc --noEmit && npx vitest run` passes; no regression.

## Dependencies

- **P2-1:** `SkillExtractor` service must exist.

## Out of Scope

- Awaiting or blocking on extractor completion (fire-and-forget only).
- Per-user queuing/rate-limiting (extractor runs immediately per session).
- Retries on extractor failure (log once and move on).
