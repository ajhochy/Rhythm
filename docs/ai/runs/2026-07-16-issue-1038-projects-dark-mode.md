---
date: 2026-07-16
repo: Rhythm
branch: codex/pr-1104-verify
pr: 1104
issues: [1038]
status: verified
tags: [run, rhythm]
index: "[[Rhythm]]"
---

# Issue #1038 — Projects dark-mode panes

## Files changed

- `apps/desktop_flutter/lib/features/projects/views/projects_view.dart` replaces
  the gradient's hard-coded cream center stop with the theme-aware
  `context.rhythm.surfaceMuted` role.
- `apps/desktop_flutter/test/contract/issue_1038_test.dart` exercises Active
  Projects and Templates in light and dark themes, including luminance and WCAG
  AA header-contrast assertions.
- `apps/desktop_flutter/test/contract/goldens/issue_1038_{dark,light}_{active_projects,templates}.png`
  provides the four visual baselines.
- `docs/ai/contracts/issue-1038.json` records the single UI acceptance criterion
  as passing.
- `docs/ai/project-state.md` and this run record capture the verification state.

## Checks run

- `flutter test test/contract/issue_1038_test.dart` — PASS, 1/1 contract test.
- `flutter test` — PASS, 864/864 tests.
- `dart format . --set-exit-if-changed` — PASS, 403 files checked and 0 changed.
- `flutter analyze --no-fatal-infos` — PASS; 272 pre-existing info-level findings,
  with no errors or warnings.
- `ai-workflow checks --level issue` — PASS.
- `ai-workflow checks --level pr` — PASS.
- `flutter build macos --release` — PASS; release app size 68.4 MB.
- The four contract goldens were visually inspected and showed populated,
  correctly themed panes without blank or crashed surfaces.
- Native screenshots from the packaged macOS release app were inspected for the
  dark Active Projects and Templates panes; both backgrounds were dark and the
  Projects header remained readable.
- Live sandboxed backend E2E — N/A. The change is confined to Flutter theme
  rendering and does not add or alter a backend behavior or API path.

## Notes

- Verification candidate: `codex/pr-1104-verify` at `e68ab156d`; the production
  fix, contract, contract metadata, and goldens remain dirty for the merge-train
  orchestrator to integrate. This run does not commit, push, or mutate GitHub.
- The contract first reproduced the regression with dark-mode luminance
  `0.907075 > 0.15`, then passed unchanged after the production fix.
- The implementation reuses the existing theme token; no shared widget or
  backend code changed.
- GitNexus impact and compare checks classified the production change as LOW
  risk, with one changed production symbol and zero affected execution flows.
