# Flutter: skills picker reads live + writes Rhythm-owned skills

**Order:** 4 · **Depends on:** #2 (`GET/POST/PUT/DELETE /opencode/skills`) · **Milestone:** Unify skills source of truth
**Supersedes:** #777

## Why

`_kAvailableSkills` (`_agent_profile_sheet.dart:33`) is a hardcoded list that drifts from the
engine's real skills; mismatched names silently scope to nothing (#775). The Skills menu
should list the engine's live skills and let users author Rhythm-owned ones into the canonical
store.

## What

Add an `OpencodeSkillsDataSource` (mirror `AgentModelsDataSource`, agent-local base
`http://localhost:4001` via `AppConstants.agentLocalBaseUrl`). Replace `_kAvailableSkills` in
the profile sheet's skills picker with live data. Add create/edit/delete UI for **managed**
skills; external skills are scope-only (read-only).

## Acceptance criteria

1. Opening the Agent Profile sheet renders the skills picker from `GET /opencode/skills`
   (names match the fork's `SKILL.md` `name`s); no hardcoded skill-name array remains in
   `_agent_profile_sheet.dart`.
2. Selecting skills persists `allowed_skills_json` with names that exist in the live set.
3. A **managed** skill shows edit/delete affordances; an **external** skill shows neither
   (read-only, scope-only) — gated on the `managed` flag from #2.
4. Creating/editing a managed skill calls the api_server write endpoint and the new/edited
   skill appears in the picker after save (reload round-trip).
5. **Boundary:** create with an empty name or a name colliding with an existing skill is
   blocked in the UI with a clear message.
6. Changing the production Server URL in Settings does **not** affect the skills picker (it
   uses the agent-local base).

## Likely files

- `apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart` (new)
- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`
- a small managed-skill editor widget (new, under `features/agents/views/`)
- `apps/desktop_flutter/test/features/agents/*` (new widget/controller test)

## Required tests

- Widget/controller test: picker renders live names; managed editable / external read-only;
  save invokes the write endpoint. `dart format .` + `flutter analyze --no-fatal-infos` clean.

## Data-safety / out-of-scope

- Only managed skills are writable/deletable from the UI; never expose external skills as editable.
- MCP picker de-hardcoding is issue 5 (same file — sequence after this).

## Verification

- `flutter analyze --no-fatal-infos`; `flutter test` for the new test.
