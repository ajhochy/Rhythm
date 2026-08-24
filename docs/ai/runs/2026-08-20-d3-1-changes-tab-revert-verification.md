---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-d3-desktop-feedback-sonnet
pr: none
issues: [1436]
status: verified
tags: [run, Rhythm, D3]
---

# D3.1 — Verify revert button on the Changes ("Already in use") tab

## Context

The issue's estimated files (`apps/mobile/lib/views/_changes_tab.dart` etc.)
predate this track's OWNERSHIP note, which scopes D3 to the shipping desktop
client (`apps/desktop_flutter/`) and explicitly forbids touching
`apps/mobile/` (an incomplete prototype). Inspection found the revert-button
feature already fully built and committed under C6 (`5447a7b2`): the
"Already in use" tab in `OrgProposalsView` is the Changes-tab/revert surface
this issue describes. `OrgProposalsController.revert`,
`OrgProposalsRepository.revert`, and `OrgProposalsDataSource.revert` already
call `POST /agent-org-proposals/:id/revert` and are already exercised by
`org_proposals_applied_tab_test.dart`.

No production code needed to change. This run closes two coverage gaps the
existing tests left implicit (success-snackbar text, in-flight disabled
button/spinner) and records fresh verification evidence against every
acceptance criterion.

## Files

- `apps/desktop_flutter/test/features/agent_optimizer/org_proposals_applied_tab_test.dart` —
  added a `Completer`-based in-flight fake-revert hook and two new
  `testWidgets` cases: confirmation snackbar text on success, and
  disabled-button/spinner while the request is pending.
- `docs/ai/contracts/issue-1436.json` — new.
- `docs/ai/runs/2026-08-20-d3-1-changes-tab-revert-verification.md` — new (this file).

No changes to any `apps/desktop_flutter/lib/` production file — confirmed via
`git diff --stat` after the RED/GREEN cycle below.

## RED evidence

To satisfy strict-TDD "observe the expected failure" for the one criterion
without prior direct coverage (in-flight disabled state), the ternary at
`org_proposals_view.dart:629` was temporarily changed from
`onPressed: pending ? null : onRevert` to `onPressed: onRevert`:

```
export PATH="/Users/ajhochhalter/development/flutter/bin:$PATH"
cd apps/desktop_flutter
flutter test test/features/agent_optimizer/org_proposals_applied_tab_test.dart
```

Result: `disables the revert button and shows a spinner while the request is
in flight` failed — `Expected: null / Actual: <Closure: () => void>`. The
line was then restored exactly; `git diff --stat` on
`org_proposals_view.dart` was empty afterward.

## Checks

- `flutter test test/features/agent_optimizer/org_proposals_applied_tab_test.dart`:
  **9/9 passed** (7 pre-existing + 2 new).
- `dart format --set-exit-if-changed` on the touched test file: pass, 0 changed.
- `flutter analyze --no-fatal-infos` on the touched test file and
  `org_proposals_view.dart`: 10 pre-existing `use_build_context_synchronously`
  infos, 0 warnings/errors, exit 0.
- `git diff --check`: clean.
- Added-line secret/security scan (grep for key/token/password/connection-string
  shapes) on the diff: no matches.
- GitNexus `detect-changes --scope unstaged --repo Rhythm` returned unrelated
  `AGENTS.md` symbols from the integration repo's own tree, not this
  worktree's actual diff — **recorded UNKNOWN, not bound to this worktree**.
  Relied on direct `git status --short` / `git diff` inspection instead (only
  the one test file changed).
- GitNexus `impact` sanity check against the known base figure: `applyProposal`
  returned `LOW` risk / 9 max impacted, matching the track's recorded known
  base impact — confirms the index itself is queryable, even though
  `detect-changes` isn't bound to this worktree.

## Risk

No production code changed, so no new blast radius. The two new tests changed
nothing outside the test file. GitNexus `detect-changes` binding to this
worktree is UNKNOWN; mitigated by direct diff inspection.
