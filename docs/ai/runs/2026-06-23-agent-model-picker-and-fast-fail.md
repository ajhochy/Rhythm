---
date: 2026-06-23
repo: Rhythm
branch: feature/agent-scheduler
pr: "#734"
issues: []
status: verified
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Agent Model Picker + AgentRunner Fast-Fail

## Files changed

### Part A — Backend fast-fail (`apps/api_server/`)

- `src/services/agent_runner.ts`
  - Added `getNoProgressMs()` (reads `AGENT_RUN_NOPROGRESS_MS`, default 20 000 ms)
  - Added no-progress fast-fail block after `promptAsync`: polls `listMessages` in a loop capped at `min(noProgressDeadline, deadline)`. If zero messages appear within the grace window, aborts the session and returns `status: 'error'` with message "model produced no output — check the agent profile's model". This prevents the 600s silent hang when the model ID is wrong or the provider is unauthenticated.
- `src/__tests__/issue_738_agent_runner.test.ts`
  - Updated test B: now asserts `error.toMatch(/no output/i)` instead of `/timed out/i` (no-progress check fires before the full timeout when both windows are short)
  - Added test G: `AGENT_RUN_NOPROGRESS_MS=100`, `listMessages` returns `[]` → `status: 'error'`, `error.toMatch(/no output/i)`, `abortSession` called
- `src/__tests__/issue_738_fix_model_and_session.test.ts`
  - Updated test 1a: changed `mockResolvedValueOnce([msg])` to `mockResolvedValue([msg])` (no "Once") so the no-progress check and `_waitForAssistantReply` both find the message

### Part B — Flutter model picker (`apps/desktop_flutter/`)

- `lib/features/agent_configs/models/agent_config.dart`
  - Added `modelProvider`, `modelId` nullable String fields
  - Updated `fromJson` to read `modelProvider` / `modelId` keys (matching backend snake-case→camel via the API controller)
  - Updated `toJson` to include `modelProvider` / `modelId`
  - Updated `copyWith` to accept `modelProvider` / `modelId` with sentinel-null pattern
- `lib/features/agents/views/_agent_profile_sheet.dart`
  - Added `AgentModelsDataSource? _modelsDataSource` injectable parameter on `AgentProfileSheet` constructor (default: `AgentModelsDataSource()` in prod, injectable fake in tests)
  - Added `List<CatalogModelEntry> _catalogModels` and `CatalogModelEntry? _selectedModel` state
  - Added `_loadCatalog()` async method: calls `fetchCatalog()`, pre-selects the entry matching `config.modelProvider`/`config.modelId` if set
  - Added `_buildModelSection()` widget: shows a `DropdownButtonFormField<CatalogModelEntry>` with "No preference" option + catalog entries. Shows "Loading models…" banner while catalog is fetching.
  - Added model section to `build()` ListView between manager toggle and MCPs section
  - Updated `_save()` patch/input map: includes `'modelProvider': _selectedModel?.provider` and `'modelId': _selectedModel?.modelId`
- `test/features/agents/agent_profile_model_picker_test.dart` (new)
  - 4 widget tests: MODEL section visible; pre-selects existing model; saving sends modelProvider+modelId; saving with no selection sends nulls

### Part C — Schedule view clarity (`apps/desktop_flutter/`)

- `lib/features/agent_schedules/views/agent_schedules_view.dart`
  - Added `helperText: 'Model is set on the profile'` and `helperStyle` to the Agent Profile `DropdownButtonFormField` decoration in `_ScheduleFormSheet`

## Checks run

| Check | Result |
|-------|--------|
| `api_server tsc --noEmit` | PASS — 0 errors |
| `api_server npm test` | PASS — 966/966 (+1 test G) |
| `dart format . --set-exit-if-changed` | PASS — 0 changed |
| `flutter analyze --no-fatal-infos` | PASS — 0 errors, 0 warnings |
| `flutter test` | PASS — 639/639 (+4 model picker tests) |

## Decisions

- **No-progress window capped by overall deadline**: `noProgressCheckEnd = min(noProgressDeadline, deadline)` ensures the overall 600s cap always wins. This avoids a new independent countdown that could outlast the run's timeout.
- **AgentModelsDataSource injectable**: `AgentProfileSheet` accepts an optional `modelsDataSource` param. Production uses `AgentModelsDataSource()` via the default. This makes the widget testable without a running server, following the same pattern as other data-source-dependent widgets in the codebase.
- **Backend field names**: `model_provider` and `model_id` in SQLite/Postgres; `modelProvider` and `modelId` in the TypeScript model/API response and in the Flutter `fromJson`/`toJson`. Confirmed by reading `AgentConfigsRepository` and `rowToModel` in the Stage 1 commit.

## Notes

- The no-progress loop uses a fixed 500ms poll interval. If `AGENT_RUN_NOPROGRESS_MS` < ~600ms the loop exits after the first sleep without actually calling `listMessages`. Minimum effective value in practice is ~600ms. The default 20s and test-override values (100–200ms) both work correctly because the overall deadline caps the loop.
- `issue_653_contract.test.ts` showed one port-binding race failure on the first `npm test` run after adding the fast-fail. Passed on the second and third runs. Pre-existing flakiness, unrelated to these changes.
