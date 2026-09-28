---
date: 2026-09-21
repo: Rhythm
branch: mega/2026-09-18-mobile-electron-hermes
pr: null
issues: [1550, 1551, 1555]
status: complete
tags: [run, Rhythm]
---

# Electron Agent Settings — "fix this in Flutter instead" capability gap

Exploration and issue-writing only. No product code touched.

## Files read

- `apps/web/src/components/tools/AgentSettingsTool.tsx` — gap notices at `:114`, `:116`, `:118`, `:437`, `:461`, `:462`; "Configure in Flutter Agent settings" at `:99-100`, `:407-408`
- `apps/desktop_flutter/lib/features/agents/views/_agent_settings_sheet.dart` — `_BehaviorSection` `:165`, `_KeybindsSection` `:214`, `_OpencodeServerSection` `:394`
- `apps/desktop_flutter/lib/features/settings/services/destructive_modal_service.dart`, `keybinds_service.dart`, `opencode_server_service.dart`
- `apps/desktop_flutter/lib/features/agents/views/_permission_card.dart:128`
- `apps/desktop_flutter/lib/main.dart:144-152`, `apps/desktop_flutter/lib/app/core/server/api_server_controller.dart:33`
- `apps/web/src/gateway/user-preferences.ts`, `apps/web/src/pages/settings/index.tsx:212-227`, `apps/web/src/components/Composer.tsx`
- `apps/electron/src/agent-server.mjs`, `apps/electron/src/preload.cjs`
- `apps/api_server/src/app.ts`, `routes/system_routes.ts`, `routes/users_routes.ts`, `controllers/users_controller.ts:76-108`, `services/opencode_health.ts`, `services/opencode_client_service.ts`

## Checks

- No commands run against the user's live app, api_server (:4001) or engine (:4096). Static reads only.
- `gh issue list --search` run before filing; #1514 is the parent UI issue and is referenced, not duplicated.
- Label `electron-parity` created on `ajhochy/Rhythm`.

## Notes

The gap notices' premise is wrong. They claim missing server endpoints, but all three capabilities are `shared_preferences` values local to the Flutter client. There is no `/agent-settings` router and never was; the settings were never server-backed in any client.

- **Behavior** (#1550) — `shared_preferences['agent_destructive_modal_enabled']`, read only by `_permission_card.dart`. Electron already has an equivalent per-device store (`user-preferences.ts`).
- **Keybindings** (#1551) — four unvalidated `keybind_*` strings that *nothing in Flutter reads*. Meanwhile Electron already ships a working `sendKey` preference on its own Settings page. The Agent Settings notice contradicts a feature the same app already has.
- **Runtime** (#1555) — Flutter has no restart at all; its section is just a remote-URL text field. The notice's redirect to Flutter is false. Two runtimes with different owners: :4001 is owned by Electron main (`agent-server.mjs`), :4096 by the api_server (`OpencodeClientService`). Engine restart is feasible server-side; api_server restart must be Electron IPC, never HTTP, or it reproduces the PR #1508 health-flap → SIGKILL shape.

Common risk flagged in all three: building only one side creates two stores for one setting, silently divergent between clients.
