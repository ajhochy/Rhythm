# D5 — Manager delegation importer and UI surface

**Labels:** `api-server`, `desktop-flutter`, `agent-profiles`, `p4`
**Design authority:** `docs/ai/decisions/2026-06-24-manager-delegation.md`
**Depends on:** D1-D4

## Goal

Make manager/delegate configuration survive profile re-sync and become visible/editable in the UI.

## Acceptance Criteria

- [ ] `syncOpencodeAgentProfiles` marks `workflow-orchestrator` as a manager.
- [ ] Importer populates `allowed_delegates_json` for the manager with the intended specialist profiles.
- [ ] Re-sync preserves/importer-drives manager/delegate config instead of relying on manual DB edits.
- [ ] `GET /agent-configs` includes `isManager` and `allowedDelegatesJson`.
- [ ] Flutter `AgentConfig` model parses/serializes `isManager` and `allowedDelegatesJson`.
- [ ] Agent profile sheet exposes manager toggle and delegate allowlist controls.

## Likely Files

- `apps/api_server/src/services/agent_profile_sync.ts`
- `apps/api_server/src/controllers/agent_configs_controller.ts`
- `apps/desktop_flutter/lib/features/agent_configs/models/agent_config.dart`
- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`

## Required Tests

- Extend importer hygiene tests.
- Add/update Flutter model/widget tests where practical.
