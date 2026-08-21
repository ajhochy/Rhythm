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

## H1 verification repair attempt 1

### Files

- `apps/api_server/src/services/relay_uplink_client.ts`
- `apps/api_server/src/__tests__/relay_uplink_client_contract.test.ts`
- `apps/api_server/src/server.ts`
- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`
- `apps/desktop_flutter/test/features/agents/agents_controller_test.dart`
- `apps/desktop_flutter/test/features/live_artifacts/issue_1381_artifact_persistence_test.dart`
- `apps/desktop_flutter/test/features/agents/agent_profile_permissions_and_picker_test.dart`
- `apps/desktop_flutter/test/features/agents/goldens/agent_profile_tool_permissions_fully_denied.png` (800x1000)
- `docs/ai/contracts/issue-1421-1381-1445-1074.json`
- This run note.

### Acceptance-first evidence

- `npx vitest run src/__tests__/relay_uplink_client_contract.test.ts` failed
  before implementation: 9 passed, 1 failed; the released-loopback-port client
  emitted zero `failed; retrying` warnings.
- The pre-implementation Flutter acceptance run reached the intended #1074
  failures: no `Read permission actions` semantics node existed and the denied
  permissions golden did not exist. The added #1421 public-create catalog test
  passed against the existing controller implementation, so no forbidden
  controller edit was needed.

### Repair proof

- #1445: each wholly unsuccessful candidate pass emits one sanitized
  `[RelayUplinkClient] uplink pass failed; retrying in <delay>ms` warning. The
  loopback contract observes two retry cycles while the client remains running
  and asserts the warning excludes bearer, URL host/port, and path sentinels.
  Startup separately warns once when URLs exist without a bearer. No reconnect
  behavior changed.
- #1421: the public `createSession(cwd:)` test supplies null/empty configured
  resolvers plus an available `rhythm-setup` catalog profile and observes both
  `agentId` and `profileId` forwarded as `rhythm-setup`. Production
  `agents_controller.dart` was not changed.
- #1381: the widget test uses `FilePickerPlatform` and the public picker ->
  Import HTML -> fixture -> Import journey. Its callback opens the stable
  `stable-imported-artifact-id`, waits for preference persistence, disposes the
  workspace, and remounts `DashboardArtifactWorkspace` with the same parent
  controller; the tab and saved ID remain before and after remount. No live
  artifact production controller/view was changed.
- #1074: every selector receives its tool/pattern row name through semantics;
  Ask/Allow/Deny child controls remain tappable; each segment and Bash remove
  target is at least 44x44; Bash removal is labeled with its pattern. The
  accessibility test changes `read` and removes only `rm *`, then verifies the
  persisted rule. The checked-in 800x1000 golden shows the expanded fully
  denied section.
- Contract hygiene: `issue-1421-c2`, `issue-1381-c2`, and `issue-1445-c2` are
  literal `not_tested` entries with nonempty reasons; #1445 distinguishes the
  automated loopback half from packaged-app/real-remote smoke.

### Checks

- `npx vitest run src/__tests__/relay_uplink_client_contract.test.ts`: 10/10 passed.
- `node_modules/.bin/tsc --noEmit`: exit 0.
- `flutter test --update-goldens test/features/agents/agent_profile_permissions_and_picker_test.dart`: 11/11 passed.
- Focused four-file Flutter command: 80/80 passed.
- `dart format . --set-exit-if-changed`: 507 files, 0 changed.
- `flutter analyze --no-fatal-infos`: exit 0; 311 pre-existing info-level findings.
- `flutter test`: 1226/1226 passed.
- Contract JSON parse + `not_tested` invariant commands: exit 0.
- `git diff --check`: exit 0.
- GitNexus CLI `detect-changes --scope all`: low risk, 8 mapped files, 6
  changed symbols, 0 affected processes.

### GitNexus

- Required re-index command was attempted first but `.gitnexus/run.cjs` was
  absent; documented fallback `npx gitnexus analyze` succeeded (80,792 nodes,
  160,283 edges, 300 flows). MCP graph reads then reported a storage-version
  mismatch, so the matching CLI was used for all required impacts.
- `dialLoop`: LOW, 1 direct caller, 0 processes; `dial`: LOW, 1 direct caller,
  0 processes; `_resolveDefaultAgentForCreate`: LOW, 1 direct caller, 0
  processes; `_PermissionActionSelector`: MEDIUM, 8 direct importers, 0
  processes; `_buildBashPermissionRow`: LOW, 1 direct caller, 1 build process;
  `_buildToolPermissionsSection`: LOW, 1 direct caller, 1 build process.
- Additional edited-symbol checks: server `main` LOW; `_buildPermissionRow` LOW.
  No HIGH/CRITICAL result required scope beyond the triaged plan.

### Notes

- No sandbox, api_server, engine, live relay, commit, push, or PR action was run.
- Forbidden production files remain unchanged: `agents_controller.dart`,
  `live_artifacts_controller.dart`, and `dashboard_artifact_tabs.dart`.
