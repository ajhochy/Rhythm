# Project State

## Current Status
Implementing Opencode engine — replacing CLI-subprocess AI agents with @opencode-ai/sdk embedded in apps/api_server.

## Issues Remaining
- #564: Install SDK + OpencodeClientService (next)
- #565: Init SDK on startup + health endpoint
- #566: Replace capabilities with SDK providers
- #567: Replace PTY with SDK sessions
- #568: Bridge Opencode SSE events through WS
- #569: Auth endpoints (OAuth + API key)
- #570: Flutter auth UI
- #571: Remove old PTY code
- #572: Remove CliDeck
- #573: Update Flutter data sources

## Spec
`docs/superpowers/specs/2026-05-13-opencode-engine-design.md`

## Plan
`docs/superpowers/plans/2026-05-13-opencode-engine-implementation.md`

## Branch Strategy
One branch per issue: `opencode-engine-issue-XXX`

## Known Context
- apps/api_server is a Node.js/Express TypeScript process spawned locally by Flutter
- Agent sessions currently use node-pty to spawn claude-code/codex/opencode as CLI subprocesses
- Key file to modify: pty_runner.ts, agent_sessions_controller.ts
