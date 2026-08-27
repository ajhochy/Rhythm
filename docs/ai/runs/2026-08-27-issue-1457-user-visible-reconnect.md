---
date: 2026-08-27
repo: Rhythm
branch: fix/bridge-stream-reliability-repair
pr: 1487
issues: [1457]
status: ready-for-verification
tags: [run, Rhythm]
---

# Issue #1457 AC5 — user-visible bridge reconnect

## Files

- `apps/api_server/src/services/opencode_stream_bridge.ts` — emits one `bridge.status=reconnecting` transition when retry begins and one `ready` transition after recovery.
- `apps/api_server/src/contract/issue_1457_global_stream_retry.test.ts` — binds exact status frames and deduped transition order.
- `apps/desktop_flutter/lib/features/agents/models/agent_ws_message.dart` — parses the public bridge-status frame.
- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart` — stores bridge degradation separately from session/turn errors.
- `apps/desktop_flutter/lib/features/agents/views/agents_view.dart` — renders an accessible reconnecting banner in the shipping Agents UI.
- `apps/desktop_flutter/test/features/agents/issue_1457_bridge_status_indicator_test.dart` — drives production parsing/controller/rendering and recovery clearing.
- `docs/ai/contracts/issue-1457.json` — AC5 is now bound and passing.

## Acceptance-contract red

- `cd apps/api_server && npx vitest run src/contract/issue_1457_global_stream_retry.test.ts`
  - Expected failure observed before implementation: AC5 received `[]` instead of the exact reconnecting/ready frames; 1 failed, 7 passed.
- Initial `flutter test ...` attempt could not run because `flutter` was not on `PATH`. The SDK was then resolved at `/Users/ajhochhalter/development/flutter/bin/flutter`; the new widget test was executed after implementation.

## Checks

- `npx vitest run src/contract/issue_1457_global_stream_retry.test.ts src/__tests__/issue_1379_bridge_hub_publish.test.ts src/__tests__/opencode_stream_bridge.test.ts` — PASS, 57/57.
- `npm run build && npx tsc --noEmit` — PASS.
- `/Users/ajhochhalter/development/flutter/bin/flutter test test/features/agents/issue_1457_bridge_status_indicator_test.dart` — PASS, 1/1.
- `/Users/ajhochhalter/development/flutter/bin/dart format <four changed Dart files> --set-exit-if-changed` — PASS after formatting two files.
- `/Users/ajhochhalter/development/flutter/bin/flutter analyze --no-fatal-infos` — exit 0; 319 pre-existing info/warning findings. The one new test warning was removed afterward and the focused widget test was rerun green.
- `git diff --check` — PASS.
- GitNexus impact attempts before implementation and `detect_changes(scope=all)` after implementation — unavailable: LadybugDB file is storage v42 while the connected runner supports v41. Risk remained UNKNOWN; no HIGH/CRITICAL result was returned.

## Notes / handoff

- No sandbox was started, per dispatch; PR #1489 owns physical stream-down verification. Issue #1458's physical stream-down criterion remains untouched/UNVERIFIED.
- Web/Electron parity was not added: those directories are prototypes, not the shipping client, and do not share this Flutter controller/render surface.
- No polling subsystem, session status mutation, or turn error was added. The existing synchronous relay, subscription guard, permission safety, retry, and recovery paths are unchanged except for transition broadcasts.
- Sandbox readiness: code and focused checks are ready for PR #1489's existing sandbox procedure.
- Commit intentionally not created because the active rigid implementation instruction prohibits commits; worktree remains uncommitted for orchestrator verification.
