---
date: 2026-07-11
repo: Rhythm
branch: ocu-34-dead-code-cleanup
status: ready-for-coding
issues: [1075]
order: 34
depends_on: []
tags: [issue, Rhythm, opencode-utilization, m7-hygiene]
---

# OCU-34 — Dead-code cleanup — listProviders, fetchChildSessions, dispatchCommand, SessionModelPicker

## Summary
Audit-confirmed dead code. api_server: listProviders wrapper (opencode_client_service.ts:784) has zero production callers (tests only). Flutter: fetchChildSessions (agents_data_source.dart:495 + agents_repository.dart:150) never called (child navigation uses fetchChildMessages); dispatchCommand (agents_data_source.dart:586 + agents_repository.dart:169) never invoked (slash commands go over WS); SessionModelPicker view (_session_model_picker.dart) not instantiated (superseded by UnifiedAgentModelPicker).

## Scope (in)
- Delete the four items + their tests/references (incl. the doc-comment references to SessionModelPicker)
- Confirm-by-grep zero remaining references before each deletion
- If OCU-11 has NOT landed, still delete dispatchCommand (its replacement path is the existing WS dispatch, not this method)

## Non-goals (out)
- Do NOT remove the session.shell d.ts doc block (OCU-24 wires it)
- No other refactors

## Likely files
- apps/api_server/src/services/opencode_client_service.ts
- apps/api_server/src/services/opencode_client_service.test.ts
- apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart
- apps/desktop_flutter/lib/features/agents/data/agents_repository.dart
- apps/desktop_flutter/lib/features/agents/views/_session_model_picker.dart (delete)

## Acceptance criteria
- grep proves zero references to each removed symbol
- api_server tsc + full tests green
- flutter analyze green
- App builds and the agents surface works (children navigation, slash commands, model picker unaffected)

## Required tests
- Existing suites are the guard; no new tests

## Dependencies
None
