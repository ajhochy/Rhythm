---
date: 2026-07-23
repo: Rhythm
branch: fix/update-checker-version-scheme
pr: https://github.com/ajhochy/Rhythm/pull/1142
issues: []
status: merged
tags: [run, rhythm]
---

## Files

- `apps/desktop_flutter/lib/app/core/updates/update_service.dart` — `_VersionParts.parse` now left-pads any parsed version with fewer than 3 numeric components (fixes legacy "18.NN"/"beta.18.NN" tags reading as newer than "0.18.NN").
- `apps/desktop_flutter/test/update_service_version_scheme_test.dart` — 5-case regression test driving `fetchAvailableUpdate()` through a canned GitHub Releases response shaped like the real last-10-releases window that reproduced the bug.

## Checks

- `flutter pub get` — clean.
- `flutter analyze --no-fatal-infos` — clean (273 pre-existing `info`-level lints elsewhere in the repo; zero warnings/errors; none in touched files).
- `flutter test test/update_service_version_scheme_test.dart` — 5/5 passed.
- `dart format --set-exit-if-changed .` — found a real, reproducible violation in the same 2 files CI's `stable-3.44.7` toolchain flagged (the prior hand-format commit, done without a local Dart SDK, didn't fully match CI's formatter). Fixed forward with commit `f385316c9`, re-verified analyze/tests still pass, re-pushed.
- CI (`Desktop CI` / `desktop-checks`, run 30021027784): dart format ✓, flutter analyze ✓, flutter test ✓, macOS debug build ✓ — full green in 8m38s.
- PR marked ready for review and merged via `gh pr merge --merge --delete-branch` (merge commit `a7bcef961`).

## Notes

- Original fix (commit `8e2138a3b`) was built in a remote container without a Dart/Flutter SDK — hand-traced only. This session verified it end-to-end with a real local Flutter 3.41.6 install in an isolated git worktree (the working checkout was mid-task on an unrelated branch `fix/scheduled-run-permission-bypass-persist` with uncommitted changes, so a plain `git checkout` at repo root was avoided).
- Root cause: `_compareVersions` padded shorter version-number lists with zeros at the END (correct for a missing trailing patch), but Rhythm's old tag scheme ("18.43") is missing its LEADING major, not a trailing component — so it parsed to `[18, 43]`, reading as far newer than `0.18.48`'s `[0, 18, 48]`. Fix left-pads to 3 components before comparing.
- CI's `subosito/flutter-action@v2` pins `channel: stable` with no version pin, so the formatter version can drift over time — worth keeping in mind if this recurs on unrelated PRs.
