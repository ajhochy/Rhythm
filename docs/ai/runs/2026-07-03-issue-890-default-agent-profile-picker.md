---
date: 2026-07-03
repo: Rhythm
branch: workflow/run-2026-07-03
pr: []
issues: [890]
status: verification-gate PASSED, not yet folded/committed
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# 2026-07-03 — Issue #890: default agent profile configurable via app-level picker

## Summary

New sessions previously defaulted to Secretary via a hardcoded preference in
`AgentsController._resolveDefaultAgentIdForCreate()` (#889). This adds a
client-side, app-level "Default profile" override, configurable from the
Agent Profile manager sheet. Secretary remains the SEEDED fallback — the
picker overrides it when set and still valid. No backend changes
(Flutter-only; the branch also carries unrelated #856/#889 backend work,
untouched by this run).

## Files added

- `apps/desktop_flutter/lib/app/core/services/default_agent_profile_service.dart`
  — new `ChangeNotifier` mirroring `ThemeModeService`'s shape, backed by
  `shared_preferences` (key `default_agent_ocagent`). API: `defaultOcAgent`
  getter (null = unset), `load()`, `setDefault(String? ocAgent)` (persists,
  clears the pref on null, no-ops without notifying when unchanged).
- `apps/desktop_flutter/test/app/core/services/default_agent_profile_service_test.dart`
  — 6 tests: unset-by-default, persisted-value read-back, set persists +
  survives reconstruction, `notifyListeners` fires on change / not on no-op
  set, `setDefault(null)` clears the persisted key.
- `apps/desktop_flutter/test/features/agents/default_profile_picker_test.dart`
  — 3 widget tests (added during verification-gate, see Notes) pumping
  `AgentProfilesManagerSheet` with fake `AgentConfigsController` /
  `DefaultAgentProfileService`: dropdown lists selectable profiles + a
  "Secretary (default)" fallback item; a real tap-select persists through a
  freshly-constructed service instance re-reading `shared_preferences`; a
  persisted override pointing at a removed/unknown profile renders as unset
  instead of a dangling selection.

## Files modified

- `apps/desktop_flutter/lib/features/agents/controllers/agents_controller.dart`
  — constructor gains optional `String? Function()? configuredDefaultAgentResolver`
  (kept distinct from the existing `_managerAgentNameResolver` — different
  concern per explicit dispatch). `_resolveDefaultAgentIdForCreate()`
  resolution order is now: (1) the configured-default resolver's value, ONLY
  if it matches an `authorized` catalog entry with non-empty `agent`; else
  (2) Secretary (`_secretaryAgentSlug`, unchanged #889 behavior); else (3)
  first authorized catalog entry (#653, unchanged).
- `apps/desktop_flutter/lib/main.dart` — loads `DefaultAgentProfileService`
  before `runApp` alongside the other client prefs, threads it through
  `RhythmApp` / `_RhythmAppState` / `_RhythmAppContent`, registers it as a
  `ChangeNotifierProvider.value`, and wires
  `configuredDefaultAgentResolver: () => defaultAgentProfileService.defaultOcAgent`
  at the existing `AgentsController` construction site (next to the #745
  `managerAgentNameResolver` wiring).
- `apps/desktop_flutter/lib/features/agents/views/_agent_profile_sheet.dart`
  — new `_DefaultProfilePicker` widget rendered at the top of
  `AgentProfilesManagerSheet` (`showAgentProfilesManagerSheet`): a
  `DropdownButton` listing `AgentConfigsController.sessionSelectableAgents`
  plus a "Secretary (default)" item for `null`/unset. Reads
  `DefaultAgentProfileService` via `context.watch`; `onChanged` calls
  `context.read<DefaultAgentProfileService>().setDefault(value)`. A
  persisted override that no longer matches a selectable profile falls back
  to showing "unset" instead of a dangling selection.
- `apps/desktop_flutter/test/features/agents/agents_controller_test.dart` —
  new group `createSession default agent — configured override (#890)`, 6
  cases: resolver → authorized catalog entry wins over Secretary; resolver →
  unauthorized/unknown ocAgent falls through to Secretary; same falling
  through further to first-authorized when Secretary also absent; resolver →
  null preserves both existing #889 Secretary and first-authorized fallback
  behaviors; no resolver argument at all (constructor param omitted, not
  `() => null`) also preserves existing behavior. The pre-existing 3-case
  `createSession default agent (#889)` group is untouched and still passes.

## Checks run

- `dart format` on all changed/added files — clean; full-repo
  `dart format --set-exit-if-changed .` — 382 files, 0 changed.
- `flutter analyze --no-fatal-infos lib/app/core/services lib/features/agents test`
  — **0 errors, 0 warnings** (104 pre-existing info-level lints, unrelated;
  101 before this run's 3 new widget-test file lints).
- `flutter test test/features/agents/agents_controller_test.dart
  test/app/core/services/default_agent_profile_service_test.dart
  test/features/agents/default_profile_picker_test.dart` — **59/59 pass**
  (50 + 6 + 3).
- Full `flutter test` (whole suite, since `main.dart` was touched) —
  **813/813 pass**, 0 fail.
- `ai-workflow checks --level issue` and `--level pr` — both green (flutter
  analyze + dart format + api_server tsc --noEmit + api_server vitest all
  pass; api_server untouched by this change, confirms no cross-package
  regression).
- Fail-before/pass-after: `git stash` on `agents_controller.dart` alone,
  re-ran `agents_controller_test.dart` — compile error (`No named parameter
  with the name 'configuredDefaultAgentResolver'`) confirming the new tests
  exercise real new surface, not a tautology; `git stash pop` restored the
  fix, re-run confirmed 50/50 (59/59 combined) green again.
- verification-gate: **PASS** — see full evidence block in the session
  transcript; branch `workflow/run-2026-07-03`, commit `7ef7692ac0a`.

## Notes / decisions

- Kept `configuredDefaultAgentResolver` as a wholly separate constructor
  param from `managerAgentNameResolver` per explicit dispatch instruction
  (different concerns: one drives manager-preamble routing eligibility, the
  other is a pure new-session default preference).
- Made an invalid/removed override silently fall through to Secretary rather
  than erroring, consistent with how the existing Secretary/first-authorized
  fallback chain already degrades gracefully.
- **verification-gate follow-up (widget test + a real tooling gotcha):** the
  coding-agent run originally covered the picker only via
  controller/service-level tests (per the dispatch's "if a full widget test
  is too heavy..." allowance). During verification-gate a real widget test
  was added (`default_profile_picker_test.dart`) to satisfy the Behavioral
  Evidence Rule with actual `tester.tap` events and fresh-instance
  `shared_preferences` re-reads as the outcome assertion. A first attempt at
  that test also tried to capture a `RenderRepaintBoundary.toImage()` PNG
  screenshot for visual evidence (Required Evidence #8) — **this hung
  indefinitely** under `flutter test`'s `--enable-software-rendering`
  headless harness in this environment (confirmed via `ps` showing a live
  `flutter_tester` process pegged for 7+ minutes on that one file; killing
  it and removing the `toImage()` call resolved it immediately). The 3
  behavioral tests (no screenshot) are the load-bearing UI evidence instead.
  **Tooling note for future test authors in this repo:** avoid
  `RenderRepaintBoundary.toImage()` inside `flutter test` here — use
  `flutter run -d macos` + a manual/computer-control screenshot if a true
  pixel capture is ever required.
- Residual risk: the picker has not been live-smoked in a running
  `flutter run -d macos` session against the real local agent server.
  Recommended manual check: open Agent Profiles → confirm the picker lists
  selectable profiles, pick one, close/reopen the sheet, and confirm the
  selection persists across an app restart.
