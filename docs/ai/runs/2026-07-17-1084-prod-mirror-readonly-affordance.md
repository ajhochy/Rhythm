---
date: 2026-07-17
repo: Rhythm
branch: mega/A2-flt-docs
pr: none
issues: [1084]
status: implemented (pending verification-gate)
tags: [run, rhythm]
---

## Files changed
- `apps/desktop_flutter/lib/app/core/ui/rhythm_inspector.dart`
- `apps/desktop_flutter/test/app/core/ui/rhythm_inspector_prod_mirror_test.dart` (new)

## Summary
Issue #1084: the sync orchestrator (`mirrorProductionTasksAsync`, cron */10min)
refreshes title/notes/dates of `source_type='prod_mirror'` tasks from the
production API, silently reverting local edits within 10 minutes. Nothing in
the Flutter UI told the user this.

The task inspector already had a `_readOnly` affordance for
`calendar_shadow_event` (READ ONLY kicker, locked fields, no edit button).
Reused that mechanism: extended `_readOnly` to also cover `prod_mirror`, added
a prod-specific subtitle ("This task mirrors the production system, which is
the source of truth. Local edits here are overwritten on the next sync."), a
`cloud_sync` icon, and a "Production (read-only)" source label pill. Because
`_readOnly` already gates all edit controls and the status toggle, mirrored
tasks now open read-only — matching the backend's declared authority.

## Checks run
- `dart format lib/app/core/ui/rhythm_inspector.dart test/app/core/ui/rhythm_inspector_prod_mirror_test.dart --set-exit-if-changed` → 0 changed (PASS)
- `flutter analyze --no-fatal-infos <changed files>` → exit 0; 3 pre-existing infos (lines 512/685/752, outside edited logic), no new errors (PASS)
- `flutter test test/app/core/ui/rhythm_inspector_prod_mirror_test.dart` → 2/2 passed (PASS)

## Notes
- UI-affordance only; no backend/engine behavior change, so the live-E2E
  behavioral gate (AGENTS.md) does not apply. Covered by a widget test that
  pumps the real `showRhythmTaskInspector` surface.
- Did NOT touch the sync orchestrator — prod-authoritative overwrite is by
  design per the issue; this change only makes it visible.
- Not pushed, no PR opened (per dispatch instructions).
