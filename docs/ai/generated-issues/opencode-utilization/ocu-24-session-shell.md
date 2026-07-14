---
date: 2026-07-11
repo: Rhythm
branch: ocu-24-session-shell
status: ready-for-coding
issues: [1065]
order: 24
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m5-files-vcs]
---

# OCU-24 — session.shell — quick-run command recorded in transcript

## Summary
POST /session/:id/shell runs a non-interactive command through the session so the invocation and output become part of session history (distinct from the PTY terminal, which is ephemeral and off-transcript). The SDK method session.shell is declared (d.ts:618) but was never wrapped. Product shape: user runs a quick command the agent can see and react to.

## Scope (in)
- Wrap session.shell in opencode_client_service
- Route POST /agent-sessions/:id/shell {command}
- Flutter: "!"-prefix in the composer runs the rest as a shell command for the session (mirrors common CLI conventions)
- Rendered via the existing bash-tool TerminalOutputView renderer when the resulting message arrives on the stream
- Permission semantics follow the engine (shell runs under session permissions — document that plan/deny-all modes will ask/deny)
- Support escape: "\!" in messages sends literal "!" as text

## Non-goals (out)
- No PTY changes
- No command history/recall UI
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/routes/agent_sessions_routes.ts
- apps/api_server/src/controllers/agent_sessions_controller.ts
- apps/desktop_flutter/lib/features/agents/views/agents_view.dart (composer + renderer dispatch)

## Acceptance criteria
- !ls -la in the composer produces a transcript entry with output
- The agent's next turn can reference that output (it's in history — live-verify)
- Permission mode plan blocks it with the standard ask/deny flow
- Plain messages starting with "!" escaped via "\!" send as text
- flutter analyze clean

## Required tests
- Wrapper/route contract tests
- Widget test for !-prefix parsing including escape sequences

## Dependencies
None
