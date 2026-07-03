---
date: 2026-07-02
repo: Rhythm
branch: issue-885-vault-env
pr: null
issues: [885]
status: done
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# #885 — Memory Vault env not injected into spawned api_server

## Files changed

- `apps/desktop_flutter/lib/app/core/services/memory_vault_config_service.dart` (new) —
  persisted setting (SharedPreferences) for the Memory Vault path/subdir. Pure
  `autoDetectDefault()` prefers `~/Documents/Obsidian Vault/AGENT-MEMORY` (subdir `""`)
  when it exists on disk, else falls back to legacy `~/Documents/Memory-Vault` (subdir
  `"memory"`). `expandHome()` mirrors api_server's own `expandHome()` semantics.
  Injectable `directoryExists` seam for testability.
- `apps/desktop_flutter/lib/app/core/server/api_server_service.dart` — extracted a pure
  top-level `buildApiServerEnvironment()` function (base env + fixed keys `PORT`/`DB_PATH`/
  `AGENT_LOCAL` + `MEMORY_VAULT_PATH`/`MEMORY_VAULT_SUBDIR` with explicit-`Platform.environment`-
  wins precedence). `ApiServerService` takes optional `memoryVaultPath`/`memoryVaultSubdir`
  constructor params (default null = back-compat) and uses the builder in its single
  `Process.start` call — the same call site handles both the dev tsx spawn and the bundled
  `dist/server.js` spawn, so both paths are covered without duplicated logic.
- `apps/desktop_flutter/lib/main.dart` — loads `MemoryVaultConfigService` before `runApp`,
  threads it through `RhythmApp`/`_RhythmAppContent` as a `ChangeNotifierProvider.value`,
  and passes `resolvedPath`/`subdir` only into the `agentService = ApiServerService(...)`
  used by `AgentServerController` (the instance that actually calls `.start()` and spawns
  the process hosting `/agent-memory` on :4001). The other `ApiServerService` instance
  (wired to `ApiServerController`) only calls `checkHealth()` against the production URL
  and never spawns — confirmed by reading `api_server_controller.dart` — so it needs no
  vault env and was left untouched.
- `apps/desktop_flutter/lib/features/settings/views/settings_view.dart` — new public
  `MemoryVaultSection` widget (mirrors the existing `AgentServerFailed` public-for-testing
  precedent) under a new "MEMORY VAULT" heading: shows the persisted path, the resolved
  (`~`-expanded) form, and a Save button with a "restart to apply" confirmation message.
- New tests:
  - `test/app/core/services/memory_vault_config_service_test.dart` (11 cases) —
    `expandHome`, `autoDetectDefault` (both branches), `load()` (auto-detect both branches +
    saved-setting override), `save()` (persist + reload + empty-path no-op).
  - `test/app/core/server/api_server_environment_test.dart` (5 cases) — injection from
    setting, explicit-env-wins for both `MEMORY_VAULT_PATH` and `MEMORY_VAULT_SUBDIR`
    independently, null-setting omits the keys entirely (back-compat), fixed keys always set.
  - `test/features/settings/views/memory_vault_section_test.dart` (3 widget tests) — real
    `tester.enterText` + `tester.tap` against the rendered `TextFormField`/`FilledButton`,
    asserting the field's controller value and the saved-confirmation SnackBar text (not a
    mock/spy call count).
- `docs/ai/decisions/2026-07-02-memory-vault-env-injection-scope.md` (new) — records the
  "only inject into the agent-spawning instance" and "no auto-migration of stale legacy
  notes" decisions with alternatives considered.

## Checks run

- `ai-workflow checks --level issue` — flutter analyze (0 errors) / dart format (clean) /
  api_server tsc --noEmit — all PASS.
- `flutter test` (apps/desktop_flutter, full suite) — **793 pass, 0 fail** (18 new for #885).
- `ai-workflow checks --level pr` — same static checks PASS; api_server vitest showed 1
  failure on first run (`issue_755_role_separation.test.ts`, a 5000ms-timeout test unrelated
  to this change — this branch touches zero `apps/api_server` files). Re-ran the file in
  isolation (21/21 pass) and the full api_server suite standalone (234/234 files, 2008 pass /
  1 skipped, 0 fail) — confirmed a load-sensitive flake, not a regression from this change.
- `dart format --set-exit-if-changed lib test` — clean (auto-fixed 2 new test files on first
  pass, verified clean on re-run).

## Notes

- **Decision (no auto-migration):** per the issue's explicit ask, the 3 stale legacy notes
  in `~/Documents/Memory-Vault` are NOT auto-migrated. This run's log entry + the linked
  decision doc are the "one-line surfacing" the issue asked for; the maintainer prunes/
  migrates by hand.
- **Deviation from spec:** none. Auto-detect, explicit-env-precedence, Settings UI
  persistence, and both dev+bundled spawn-path coverage all implemented exactly as scoped.
- **Follow-up filed:** a background task chip was spawned (not a GitHub issue) requesting a
  live `flutter run -d macos` screenshot of the new Settings "MEMORY VAULT" section — the
  coding-agent run could not safely launch the full app in this worktree because a separate
  Rhythm.app instance from the main checkout was already running and sharing the same local
  DB path (`~/Library/Application Support/Rhythm/rhythm.db`) and port 4001. Widget-test
  coverage (real input events + rendered-output assertions) exists as interim evidence; the
  live visual check is still outstanding before this ships in a release build.
- **Residual risk:** changing the path in Settings requires an app/agent-server restart to
  take effect (env vars are read once at process spawn) — surfaced in the Save confirmation
  text, but there's no in-app "restart now" affordance wired to it yet.
- 1 commit on `issue-885-vault-env` (`ea1c53595`), `Co-Authored-By: Claude Fable 5
  <noreply@anthropic.com>`. Not pushed; no PR opened (per this dispatch's "No merge/push"
  constraint — this worktree's output awaits the orchestrating session's PR step).
