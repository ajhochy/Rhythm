---
date: 2026-07-11
repo: Rhythm
branch: ocu-28-telemetry-plugin
status: ready-for-coding
issues: [1069]
order: 28
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m6-platform]
---

# OCU-28 — Rhythm telemetry plugin — tool.execute hooks feeding run-quality

## Summary
Engine plugins can hook tool.execute.before/after — exact per-tool-call telemetry (tool name, duration, success/error) at the source, far more precise than transcript mining. Rhythm already has a run-quality pipeline (run_quality_service.ts + run_quality_routes.ts, "Report Card" UI) and a vendored-local-plugin pattern (rhythm-anthropic-accounts injected by opencode_plugin_config.ts). Ship a rhythm-telemetry plugin that POSTs tool events to the local api_server for run-quality ingestion.

## Scope (in)
- New vendored plugin (js file dir alongside rhythm-anthropic-accounts) registering tool.execute.before/after
- Batches events {sessionID, callID, tool, startedAt, durationMs, status, errorClass} and POSTs to a new local endpoint POST /run-quality/tool-events (fire-and-forget, no engine-blocking, swallow network errors)
- opencode_plugin_config ensures the plugin entry
- run_quality_service ingests + associates with local session ids via opencodeSessionMap lookup exposed through an internal resolver route
- Feature-flag env to disable

## Non-goals (out)
- No UI changes (Report Card reads existing aggregates; wiring new fields into UI is follow-up)
- No OpenTelemetry (separate decision)
- No chat.params/system-transform hooks

## Likely files
- apps/api_server/vendor or plugins dir housing rhythm-anthropic-accounts (mirror its location) — new rhythm-telemetry plugin file
- apps/api_server/src/services/opencode_plugin_config.ts
- apps/api_server/src/routes/run_quality_routes.ts
- apps/api_server/src/services/run_quality_service.ts
- apps/api_server/src/database/migrations.ts (tool_events table, local SQLite)

## Acceptance criteria
- Running any agent turn produces tool-event rows matching the tools shown in the transcript (count + names align, live-verified)
- Engine latency impact imperceptible (async fire-and-forget — no awaits in the hook path)
- Plugin absence/failure never breaks engine startup
- Disable flag works

## Required tests
- Plugin unit test (hook payload → POST shape)
- Ingestion route test
- opencode_plugin_config test for entry management

## Dependencies
None
