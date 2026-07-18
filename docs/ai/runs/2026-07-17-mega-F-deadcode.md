---
date: 2026-07-17
repo: Rhythm
branch: mega/F-deadcode
pr: (none — draft PR not opened per dispatch instructions)
issues: [1075]
status: complete
tags: [run, Rhythm]
---

# Wave F — #1075 (OCU-34) dead-code sweep

Final cluster of mega-PR `mega/opencode-utilization-1042-1108`. Worktree:
`/Users/ajhochhalter/Documents/rhythm-worktrees/mega-F`, branched from
`origin/mega/opencode-utilization-1042-1108` (all earlier waves 0/1/1b/2/3
already merged into that branch).

## Per-symbol status

| Symbol | Status | Reason |
|---|---|---|
| `listProviders` (api_server, `opencode_client_service.ts`) | **Removed** | Zero production callers; only referenced in test mocks/dedicated unit tests. Method + its 2 dedicated test blocks deleted; mock stub line removed from 17 other test files. |
| `fetchChildSessions` (flutter, `agents_data_source.dart` + `agents_repository.dart`) | **Removed** | Defined + wrapped but never called from `agents_controller.dart` or any production consumer (child navigation uses `fetchChildMessages`). Removed from both prod files + 13 test-fake `@override` blocks + 1 stale doc-comment + 1 orphaned call-count tracking field. |
| `dispatchCommand` (flutter, `agents_data_source.dart` + `agents_repository.dart`) | **Removed** | Confirmed via grep: only defined + wrapped in `lib/`, never called by the controller. The controller's `sendCommand` dispatches via the WS `session.command` frame directly (`_repository.send(...)`), not through this method. **Verified NOT the same symbol as** `OpencodeClientService.dispatchCommand` (api_server) which IS live — called by `ws_gateway.ts` line 204 to service the WS `session.command` path from the server side. That server-side method and its tests (`opc_m3_4_command_dispatch.test.ts`, `opencode_client_typed_wrappers.test.ts`, etc.) were **left untouched** — this is the #1052-adjacent dispatch path the issue told us to preserve. Removed 14 dead `@override` stubs from flutter test fakes. |
| `SessionModelPicker` (flutter, `views/_session_model_picker.dart`) | **Removed** | Never instantiated (only referenced in its own stale integration-note comment); superseded by `UnifiedAgentModelPicker`. Deleted the widget class, `_ModelPickerButton`, `_ModelPickerEntry`, `_ApplyAsDialog`, and the `OnModelPicked` typedef. **Kept** the `ModelPickerApplyAs` enum in the same file — `_unified_agent_model_picker.dart` still imports it (`import '_session_model_picker.dart' show ModelPickerApplyAs;`) and has its own private `_ApplyAsDialog`/`_ApplyAs` usage, so the enum is genuinely shared, not dead. Fixed 3 stale doc-comments elsewhere referencing the deleted class name (`agents_controller.dart` x2, `_permission_mode_picker.dart` x1) to point at `UnifiedAgentModelPicker` instead. |

## Files changed (40)

api_server (19):
```
apps/api_server/src/__tests__/agent_sessions.test.ts
apps/api_server/src/__tests__/agent_sessions_mcp_role.test.ts
apps/api_server/src/__tests__/agents_capabilities_routes.test.ts
apps/api_server/src/__tests__/agents_models_catalog.test.ts
apps/api_server/src/__tests__/agents_ws_e2e.test.ts
apps/api_server/src/__tests__/background_status.test.ts
apps/api_server/src/__tests__/issue_631_contract.test.ts
apps/api_server/src/__tests__/issue_632_contract.test.ts
apps/api_server/src/__tests__/issue_637_contract.test.ts
apps/api_server/src/__tests__/issue_638_contract.test.ts
apps/api_server/src/__tests__/issue_639_contract.test.ts
apps/api_server/src/__tests__/issue_653_contract.test.ts
apps/api_server/src/__tests__/issue_674_contract.test.ts
apps/api_server/src/__tests__/issue_677_contract.test.ts
apps/api_server/src/__tests__/opc_m1_5_resume_contract.test.ts
apps/api_server/src/__tests__/opencode_auth_routes.test.ts
apps/api_server/src/__tests__/opencode_client_service.test.ts
apps/api_server/src/services/__tests__/scoped_by_default.test.ts
apps/api_server/src/services/opencode_client_service.test.ts
apps/api_server/src/services/opencode_client_service.ts
```

desktop_flutter (21):
```
apps/desktop_flutter/integration_test/follow_up_smoke_test.dart
apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart
apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart
apps/desktop_flutter/lib/features/agents/repositories/agents_repository.dart
apps/desktop_flutter/lib/features/agents/views/_permission_mode_picker.dart
apps/desktop_flutter/lib/features/agents/views/_session_model_picker.dart
apps/desktop_flutter/test/features/agents/agent_trigger_watcher_test.dart
apps/desktop_flutter/test/features/agents/agents_controller_test.dart
apps/desktop_flutter/test/features/agents/inspector_terminal_mounted_test.dart
apps/desktop_flutter/test/features/agents/issue_626_chip_status_flip_test.dart
apps/desktop_flutter/test/features/agents/issue_717_text_attachments_test.dart
apps/desktop_flutter/test/features/agents/issue_867_session_agent_binding_test.dart
apps/desktop_flutter/test/features/agents/new_session_dialog_error_test.dart
apps/desktop_flutter/test/features/agents/opc_713_create_loading_test.dart
apps/desktop_flutter/test/features/agents/opc_instant_new_session_test.dart
apps/desktop_flutter/test/features/agents/opc_m3_4_command_dispatch_test.dart
apps/desktop_flutter/test/features/agents/opc_m3_5_todo_panel_test.dart
apps/desktop_flutter/test/features/agents/opc_m3_6_child_sessions_test.dart
apps/desktop_flutter/test/features/agents/opc_m4_1_attachments_test.dart
apps/desktop_flutter/test/features/agents/opc_m4_4_agent_selection_test.dart
```

`git diff --stat`: 40 files changed, 10 insertions(+), 715 deletions(-).

## Checks run

**Grep-zero-refs proof** (final state, from repo root of the worktree):

```
$ grep -rn "listProviders" apps/api_server/ apps/desktop_flutter/
(no output — exit 1)

$ grep -rn "fetchChildSessions" apps/desktop_flutter/
(no output — exit 1)

$ grep -rn "dispatchCommand" apps/desktop_flutter/
apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart:2553:
  /// The WS gateway will call `opencodeClient.dispatchCommand(sdkId, command,
  (doc-comment about the server-side OpencodeClientService.dispatchCommand method — a
  different, live symbol, intentionally kept; not the deleted flutter method)

$ grep -rn "class SessionModelPicker\|SessionModelPicker(" apps/desktop_flutter/
(no output — exit 1)
```

**api_server:**
- `npm run build` (tsc -p tsconfig.json + postbuild) — exit 0.
- Targeted: `npx vitest run` on the 2 files with dedicated `listProviders` unit
  tests + all 17 files whose mocks referenced it + `opc_m3_4_command_dispatch`,
  `opc_m4_1_file_attachments`, `opc_m4_4_agent_selection`,
  `opencode_client_typed_wrappers`, `opc_711_anthropic_permission_mode` (server-side
  `dispatchCommand` regression guard, unchanged but re-verified) — **22 files, 211
  tests, all passed**.
- Full suite: `npm test` — 3001 passed, 38 skipped, **18 pre-existing failures**
  in 6 `memory_*` vault-filesystem test files (`memory_write_vault_first`,
  `memory_vault_authority`, `memory_update_edit_in_place`,
  `memory_merge_on_capture`, `memory_injection_index`,
  `memory_consolidation_drafter`) — unrelated to #802/#803/#805/#808/#859/#862
  memory-vault work, not touched by this change. Confirmed pre-existing by
  running the same file (`memory_write_vault_first.test.ts`) against the
  **unmodified** main worktree (`/Users/ajhochhalter/Documents/Rhythm`,
  same commit) — identical 6/15 failures there too.

**flutter:**
- `flutter pub get` — ok.
- `flutter analyze --no-fatal-infos` — **exit 0**, 0 errors/warnings, 273
  pre-existing infos (verified none are new / none touch the edited symbols —
  spot-checked every info line referencing an edited file, all are unrelated
  pre-existing lints at different line numbers: `prefer_const_constructors`,
  `overridden_fields`, `unnecessary_brace_in_string_interps`).
- `dart format <20 changed files> --set-exit-if-changed` — exit 0, 0 changed.
- `flutter test` on the 14 affected test files (agents_controller_test,
  opc_m3_6_child_sessions_test, opc_m3_4_command_dispatch_test,
  opc_m3_5_todo_panel_test, opc_m4_4_agent_selection_test,
  opc_m4_1_attachments_test, agent_trigger_watcher_test,
  inspector_terminal_mounted_test, issue_626_chip_status_flip_test,
  issue_717_text_attachments_test, issue_867_session_agent_binding_test,
  new_session_dialog_error_test, opc_713_create_loading_test,
  opc_instant_new_session_test) — **126 tests, all passed**.

**GitNexus `detect_changes` (scope: all, worktree: mega-F):**
```
risk_level: low
changed_files: 40
changed_symbols: 1 (AgentsController — doc-comment touch only)
affected_processes: []
```
Matches expectation for a pure-deletion sweep: no execution flow impacted.

## Notes

- Per AGENTS.md verification matrix (`docs/ai/current-plan-mega-1042-1108.md`
  §6), #1075 is the one item in this set explicitly exempted from the live
  e2e / behavioral-verification gate — "pure deletion, no new behavior";
  existing suites + grep-zero-refs are the guard. No live e2e run performed
  (correctly, per plan).
- Did **not** touch `session.shell` d.ts doc block (reserved for #1065, out of
  scope per the issue's non-goals).
- Did **not** touch the vendored `opencode_fork` package's own
  `keymap.dispatchCommand` (TUI command-shim, unrelated symbol, out of scope —
  never part of this issue's file list).
- Also removed 2 now-orphaned fields in `opc_m3_6_child_sessions_test.dart`
  (`stagedChildren`, `fetchChildSessionsCallCount`) that existed solely to
  support the deleted `fetchChildSessions` and had zero remaining references
  once it was gone.
- No sandbox (`tools/dev/sandbox.sh`, :4098) interaction was required for this
  run — pure `tsc`/`vitest`/`flutter analyze`/`flutter test`, no live-server
  behavioral test applicable per the exemption above. Sandbox was left running
  and untouched.
- Did not open a PR (dispatch instructions: do not push/PR/merge). Worktree
  and branch left in place for the orchestrator to review/merge into the
  mega-PR branch.

## Next step

Hand off to `verification-gate`.
