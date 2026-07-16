---
date: 2026-07-16
repo: Rhythm
branch: main
pr: (orchestrator-owned)
issues: [1038]
status: implemented — pending verification-gate
tags: [run, rhythm]
---

# Issue #1038 — Projects panes ignore dark mode

## Files changed
- `apps/desktop_flutter/lib/features/projects/views/projects_view.dart`

## What the change is
`ProjectsView.build` top-level background gradient hard-coded three light/cream
hex colors (`0xFFF7F4EF`, `0xFFFDFBF7`, `0xFFF6F1EA`) with a `const` decoration,
so the Templates / Active Projects panes rendered cream on dark theme and washed
out header text. Replaced with the app's theme tokens via the `context.rhythm`
extension (`RhythmColorRoles`), mirroring the known-good sibling
`rhythms_view.dart` exactly:

```
colors: [context.rhythm.canvas, const Color(0xFFF7F4EF), context.rhythm.accentMuted]
```

`canvas` and `accentMuted` resolve per-theme (light `0xFFF4F1EA` / dark
`0xFF101216`), so the near-black canvas endpoints dominate on dark mode. The
central `0xFFF7F4EF` warm-tint stop is retained verbatim because all three
dark-mode-respecting sibling screens (rhythms_view, messages_view, agents_view)
keep the same literal middle stop — it's the established pattern, not a new
hard-code.

## Prior partial edit
A prior interrupted run had already converted the gradient (const→non-const,
canvas + accentMuted tokens, retaining the middle cream stop). Inspected it
against the sibling pattern in `rhythms_view.dart`: it was correct and complete.
Kept it as-is. No re-edit needed.

## Scope decisions
- Panes' inner widgets (`_TemplateList`, `_InstancesPanel`, `_TemplateDetail`,
  `_InstanceCard`, etc.) already use `Theme.of(context).colorScheme` tokens —
  no changes.
- `Colors.grey` / `Colors.red` at lines ~2072–2151 live in
  `_GenerateInstanceDialog` preview and `_SuccessView` (dialog content), not the
  panes named by the issue; mid-grey reads acceptably in both themes. Left
  untouched (smallest-diff, in-scope only).
- No shared widgets edited.

## Checks run
- `dart format . --set-exit-if-changed` → `Formatted 402 files (0 changed)`, exit 0.
- `flutter analyze --no-fatal-infos` → 272 issues, ALL info-level, 0 error/0 warning,
  0 in features/projects. Pre-existing lints in test files only. Exit 0.
- `git diff --name-only` → only `apps/desktop_flutter/.../projects_view.dart`.
- Widget test: skipped (visual-only theme-token change, no logic).

## Notes
- Flutter/Dart SDK not on default PATH; used `/Users/ajhochhalter/development/flutter/bin`.
- Change is theme-token-only (no behavior change) — no live E2E required.
- Orchestrator owns branch/commit/push/PR.
