---
date: 2026-07-11
repo: Rhythm
branch: ocu-25-session-init
status: ready-for-coding
issues: [1066]
order: 25
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m5-files-vcs]
---

# OCU-25 — session.init — "Prepare project for agents" action

## Summary
POST /session/:id/init runs the engine's built-in init flow: analyze the project and generate AGENTS.md guidance. Rhythm sessions in fresh directories start with zero project context. Surface init as an explicit action in the session header.

## Scope (in)
- Wrap session.init in opencode_client_service
- Route POST /agent-sessions/:id/init
- Flutter: "Prepare project for agents" action in the session header overflow menu
- Optional: one-time inline suggestion chip when a session's dir lacks AGENTS.md (soft dependency on OCU-19 file proxy; header action works without it)
- Progress rendered through the normal streaming transcript (init runs as a turn)

## Non-goals (out)
- No automatic init on session create
- No AGENTS.md editor
- Local agent-server (port 4001) surface only; no production API changes

## Likely files
- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/routes/agent_sessions_routes.ts
- apps/desktop_flutter/lib/features/agents/views/agents_view.dart
- apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart

## Acceptance criteria
- Action on a repo without AGENTS.md produces a committed-quality AGENTS.md in the session dir and streams progress in the transcript
- Re-running on a repo with AGENTS.md updates rather than duplicates (engine semantics — verify and document)
- flutter analyze clean

## Required tests
- Wrapper/route contract test
- Manual smoke item for the generated file quality

## Dependencies
None
