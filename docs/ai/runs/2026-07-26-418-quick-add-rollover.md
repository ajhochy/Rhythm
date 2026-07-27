---
date: 2026-07-26
repo: Rhythm
branch: codex/418-quick-add-rollover
pr: null
issues: [418]
status: passed
tags: [run, Rhythm]
---

# Quick Add date rollover

## Files

- `apps/mobile_flutter/lib/features/tasks/views/quick_add_view.dart`
  now refreshes only the implicit "today" due-date default when the retained
  Add tab is re-entered, when the app resumes, and immediately before save.
- Explicit user date choices, including clearing the due date, remain stable
  across tab and lifecycle changes.
- `apps/mobile_flutter/test/features/tasks/quick_add_rollover_test.dart`
  covers tab re-entry, foreground resume, save serialization, and the explicit
  no-date case with a deterministic clock.
- `apps/mobile_flutter/test/features/tasks/quick_add_rollover_live_test.dart`
  is gated by `RHYTHM_LIVE_E2E`; it drives the real mobile controller,
  repository, data source, and sandbox HTTP API, then reads the saved task back.
- `docs/ai/contracts/issue-418.json` maps the rollover, explicit-date, and live
  persistence acceptance criteria to their durable tests.

## Checks

- `cd apps/mobile_flutter && flutter test` — PASS: 4 tests passed and the gated
  live test skipped.
- `cd apps/mobile_flutter && flutter test
  test/features/tasks/quick_add_rollover_test.dart
  test/features/tasks/quick_add_rollover_live_test.dart` — PASS: 3 tests passed
  and the gated live test skipped.
- `cd apps/mobile_flutter && dart format . --output=none
  --set-exit-if-changed` — PASS: 38 files checked, zero changes.
- `cd apps/mobile_flutter && flutter analyze --no-fatal-infos` — BLOCKED by the
  pre-existing `lib/app/theme/app_theme.dart:43` use of `CardThemeData`, which
  the installed Flutter 3.24.5 / Dart 3.5.4 SDK does not provide. The final
  analyzer output contains no finding in the files changed for #418.
- `cd apps/api_server && ./node_modules/.bin/tsc --noEmit` — PASS.
- `cd apps/api_server && ./node_modules/.bin/vitest run
  src/__tests__/issue_755_role_separation.test.ts` — PASS: 21/21. This isolated
  rerun cleared the unrelated timeout seen once during the concurrent full
  agent-stack PR gate.
- `RHYTHM_SANDBOX_DIR=/private/tmp/rhythm-418-live-sandbox
  tools/dev/sandbox.sh up`, followed by
  `cd apps/mobile_flutter && flutter test
  test/features/tasks/quick_add_rollover_live_test.dart
  --dart-define=RHYTHM_LIVE_E2E=true
  --dart-define=RHYTHM_LIVE_E2E_ISOLATED=true
  --dart-define=RHYTHM_LIVE_URL=http://127.0.0.1:4098
  --dart-define=RHYTHM_LIVE_SESSION_TOKEN=<generated-sandbox-session-token>`
  — PASS: 1/1 against the built fork engine and api_server. `/health` and
  authenticated `/auth/me` passed; Quick Add created a task with due date
  `2026-05-06`; a real `GET /tasks` read back the same persisted due date.
- `python3 scripts/run_ai_workflow.py checks --level issue` and
  `python3 scripts/run_ai_workflow.py checks --level pr` — environment-blocked
  because the workflow includes the shipping desktop client, whose current
  dependencies require Dart >=3.7 while this machine has Dart 3.5.4. Its
  `npx --no-install tsc` invocation also could not resolve the worktree-linked
  binary; direct api_server `tsc` passed as recorded above.
- GitNexus `detect-changes --scope compare --base-ref origin/main` — attempted,
  but unavailable for this worktree because it has no registered branch index;
  the registry contains three other same-name Rhythm indexes and refused the
  ambiguous target. The mandatory pre-edit impact check was run against the
  available index; see Notes.
- `git diff --check` — PASS.

## Notes

- Root cause: `QuickAddViewState` was retained by the shell and initialized its
  due date only once. Crossing midnight left yesterday's default in memory.
- The production behavior still uses the device-local `DateTime.now`; the
  injectable clock exists only to make midnight rollover deterministic.
- GitNexus reported `QuickAddViewState` as CRITICAL with 2,171 upstream impacts
  and 32 processes, but its examples were unrelated opencode, desktop, and API
  symbols. Exact Dart methods were unindexed. This corrupt/stale result was
  reported before editing; the concrete source dependency is the mobile
  `AppShell` key call.
- The first successful live run exposed #1186: after the API logged a clean
  SIGTERM shutdown, sandbox engine PID 80518 remained on port 4097, reparented
  to PID 1. Its executable and HOME both resolved to this exact sandbox before
  termination. `sandbox.sh down` then removed the sandbox. The final passing
  run used a run-local ownership-checked fallback; ports 4097/4098 were free
  afterward, and live API PID 965 on 4001 plus engine PID 1011 on 4096 were
  unchanged.
- Sandbox builds rewrote `apps/opencode_fork/bun.lock`; it was restored to the
  branch baseline after every run. Temporary dependency symlinks were not part
  of the implementation and were removed before handoff.
