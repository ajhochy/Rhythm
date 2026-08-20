---
date: 2026-08-19
repo: Rhythm
branch: codex/mega-h1-flutter-fixes
pr: null
issues: [1421, 1381, 1445, 1074]
status: ready_for_verification
tags: [run, Rhythm]
---

# Files

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart`
- `apps/desktop_flutter/lib/app/core/server/api_server_service.dart`
- `apps/desktop_flutter/lib/main.dart`
- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`
- Focused tests under `apps/desktop_flutter/test/`.
- Acceptance contract and this run note.

# Checks

- Baseline `flutter analyze --no-fatal-infos`: exit 0, 311 pre-existing info-level issues.
- Failing acceptance run:
  `flutter test test/features/agents/agents_controller_test.dart test/features/live_artifacts/issue_1381_artifact_persistence_test.dart test/app/core/server/api_server_environment_test.dart test/features/agents/agent_profile_permissions_and_picker_test.dart`
  - 73 passed, 4 failed as intended before implementation.
  - #1421: expected available `rhythm-setup`/`research`, got hardcoded `secretary`.
  - #1445: expected `RHYTHM_RELAY_URLS`, got null.
  - #1074: expected deny-all warning, found none.
- #1381 existing navigation/remount regression test passed.
- Final focused acceptance run: 77/77 passed.
- `dart format . --set-exit-if-changed`: exit 0, 507 files checked, 0 changed.
- Final `flutter analyze --no-fatal-infos`: exit 0, 311 info-level issues,
  identical count to baseline (no new analyzer findings).
- Final `flutter test`: 1223/1223 passed.
- Post-log relay environment test: 14/14 passed.
- `git diff --check`: exit 0.
- GitNexus compare-to-main change detection: low risk, 8 Flutter files,
  13 changed symbols, 0 affected execution processes.

# Notes

- #1073 backend exists: `agent_configs.core_permissions_json` is exposed as
  `corePermissionsJson`, validated by `agent_configs_controller.ts`, persisted
  by the repository, and already loaded/saved by the Flutter profile sheet.
- No sandbox or live ports were used.
- #1381's shipping fix and focused regression were already present on this
  base: app_shell owns the shared controller and remounting Dashboard does not
  reset it. This bucket retained that implementation and verified it.
- #1445 uses the documented cloud uplink candidate
  `wss://api.vcrcapps.com/relay/uplink`; an explicit `RHYTHM_RELAY_URLS`
  override remains authoritative so operators can prepend the LAN candidate.
- Manual verification remains for the instant-create SnackBar, app-restart tab
  restoration, and live relay startup/failure logs. The bucket explicitly did
  not launch the app, sandbox, api_server, or engine.
