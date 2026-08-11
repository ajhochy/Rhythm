---
date: 2026-08-09
repo: Rhythm
branch: feat/artifact-viewer
pr: null
issues: [AV-04]
status: ready_for_verification
tags: [run, desktop_flutter, live-artifacts, evidence]
---

# AV-04 evidence repair (c10 scope scan, c20 persistence ordering)

Evidence-only. No product code changed — `live_artifacts_controller.dart` was
restored byte-identical (`shasum 1163fffe4f10f7824d82d1d5a79d71d4d5f804f0`)
after the red-baseline experiments below.

## Files

- `apps/desktop_flutter/test/features/live_artifacts/av04_final_repair_contract_test.dart`
- `docs/ai/contracts/live-artifacts-av04.json`
- removed: `apps/desktop_flutter/test/features/live_artifacts/failures/` (4 generated golden diff images, untracked)

## c20 persistence ordering

The prior c20 evidence only asserted `maxInFlight == 1` and that the *next*
request payload was `[]`. Neither statement is the contract: both pass under a
naive coalescer that drops later mutations, and neither inspects what the server
row ends up holding.

The fake `UserPreferencesDataSource` is now a server row model:

- a PATCH is attributed to the user its auth header identifies **at issue time**
  (`authenticatedUserId`), so a stale save drained after a user switch is
  observable as a write against the *new* user;
- the payload lands in `stored[userId]` **at completion time**, so out-of-order
  completion corrupts final state rather than merely reordering a log;
- completion is **newest-first** — the adversarial order. A correct serialized
  queue only ever has one request in flight, so this is identical to FIFO for
  it; a concurrent implementation reorders and persists a stale order.

Three tests now assert the applied payload sequence and the final persisted
ordered IDs, not concurrency counters:

| Test | Asserts |
|---|---|
| a delayed close then reopen still persists the latest ordered IDs | applied `[['a'], [], ['a']]` in that order; `stored[1] == ['a']`; tabs `['a']`; no persistence error |
| a failed save still ends with the latest ordered IDs persisted | failed payload never applied; applied `[['a','b'], ['b']]`; `stored[1] == ['b']`; error surfaced then cleared |
| a queued user A save cannot be issued against or alter user B | issued `[(1, ['a1']), (2, ['b'])]` — A's queued `['a1','a2']` is dropped, never sent under B's auth; `stored[2] == ['b']`; `stored[1] == ['a1']` |

### Red baseline

Each new assertion was proven load-bearing by breaking the controller,
observing the failure, and restoring it. Three independent failure modes:

1. **Serialization removed** (`_saveTail` chain → `Future.sync`):
   `Expected: <1> Actual: <3>` (maxInFlight); `Expected: [['a1']] Actual:
   [['a1'], ['a1', 'a2']]`; applied order inverted to
   `Expected: [['a','b'], ['b']] Actual: [['b'], ['a']]`.
2. **Stale-user guard removed from the queued save** (queue kept):
   `Expected: [['a1'], ['b']] Actual: [['a1'], ['a1', 'a2'], ['b']]` — A's tab
   order transmitted under B's auth header.
3. **Naive coalesce** (skip enqueue while a save is in flight):
   `Expected: [['a'], [], ['a']] Actual: [['a']]`;
   `Expected: [['a','b'], ['b']] Actual: []`. This is the mode the previous
   `maxInFlight == 1` assertion passed.

Baseline 2 fails only the cross-user test and baseline 3 fails only on the
applied/persisted assertions, so the three tests are not redundant.

## c10 scope scan

Explicit review of every file this branch adds or modifies (16 Dart/TS files;
`git status -uall`), plus a pattern scan for `webview`, `web_view`,
`InAppWebView`, `JavascriptChannel`, `PlatformView`, `dart:js`, `iframe`,
`bridge`, `propresenter`, `planning_center`, `pco`, `mcp`, `gallery`,
`scheduler`, `activeTabId`, `active_tab_id`, `reorder`, `rename`.

| Excluded | Finding |
|---|---|
| WebView / artifact JS / bridge | No match anywhere under `lib/features/live_artifacts/`. No platform-view, JS channel, or `dart:js` reference. Tab bodies render Flutter placeholder states only. |
| New dependency | `pubspec.yaml`, `pubspec.lock`, `apps/api_server/package.json` all unmodified (`git status` empty for those paths). |
| PCO / ProPresenter | Only pre-existing `planning_center_signal` strings at `dashboard_view.dart:1749,1767`, outside the diff hunks. The sole Planning-related change is hiding a duplicate `RhythmBadge` (c11). |
| MCP | No MCP file touched; `apps/mcp_server/` unmodified, tool count unchanged. |
| Gallery / local agent endpoints | Data source calls only `GET /live-artifacts?type=html`, `GET /live-artifacts/{id}`, `PATCH /users/me/preferences`. |
| Scheduler | No scheduler file touched. |
| Active-tab persistence | Only `artifactTabIds` (ordered open IDs) is persisted. `restore()` sets `_selectedId = null`, so the active tab is never written or restored. |
| Tab reorder / rename | No reorder or rename affordance, API, or handler; order is insertion order only. |
| Destructive migration | None. `artifact_tab_ids_json` already exists from AV-01 (`migrations.ts`, `postgres_bootstrap.ts`); this branch only reads/writes it. Corrupt/legacy values degrade to `[]` rather than erroring. |

## Checks

- PASS — focused contract (31 tests, normal goldens):
  `cd apps/desktop_flutter && PATH=/Users/ajhochhalter/development/flutter/bin:$PATH flutter test test/features/live_artifacts/av04_final_repair_contract_test.dart test/features/live_artifacts/av04_review_contract_test.dart test/features/live_artifacts/av04_toolbar_contract_test.dart test/features/live_artifacts/dashboard_artifact_tabs_test.dart`
- PASS — `dart format . --set-exit-if-changed`
- PASS — `flutter analyze --no-fatal-infos` (exit 0)
- PASS — `flutter test` (full suite)
- PASS — `git diff --check`
- PASS — golden failures directory absent after a normal golden run.

## Notes

No sandbox was needed: every new test is a deterministic in-process controller
test driven by `pumpEventQueue()`, with no timers, sockets, or engine.

The `failures/` directory is regenerated by `flutter test` on any golden
mismatch and is not git-ignored, so it can reappear as untracked noise. Left
alone deliberately — adding an ignore rule is a repo-wide change outside this
repair.
