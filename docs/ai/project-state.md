# Project State

## Current focus

Issue #863 — one-tap, jargon-free agent quick actions attached to a task
(and to the dashboard). Implemented and verified in this worktree. Not
yet opened as a PR.

## Active branch / PR

- **`issue-863-quick-actions`** — branches directly off `main` (not the
  mega-828 branch). Implements #863. No PR opened yet.
- Commit `73756ead664c460a9018ce47516e8ae96638a9b1`.

## In progress

- PR for `issue-863-quick-actions` not yet opened — next step is to push
  the branch and open a draft PR, then hand off for manual smoke (see
  Next step).

## Risks / known issues

- No automated visual/screenshot smoke exists for Flutter in this repo
  (confirmed: no golden tests, no `visual-smoke*` script, no
  `.claude/launch.json`). Flutter UI changes are verified manually via
  `RHYTHM_LOCAL_SMOKE=1 flutter run -d macos` per
  `docs/testing/manual-smoke.md` §9 — this is a standing repo convention,
  not specific to this change.
- `AgentsDataSource.send()` silently drops a WebSocket frame if the
  channel is null, with no delivery confirmation. Quick Actions guards on
  `agentsController.connectivity.isWsDisconnected` before sending, which
  narrows but does not eliminate a race between the check and the send.
  Pre-existing repo-wide property, not introduced by this change. See
  `docs/ai/decisions/2026-07-02-quick-actions-send-vs-draft.md`.
- No widget test exists for `dashboard_view.dart`'s new quick-actions card
  specifically (no existing dashboard test harness to extend within this
  issue's scope) — verified via `flutter analyze` + manual code trace.

## Test status

- `flutter test` (full suite): 754/754 pass.
- `flutter analyze --no-fatal-infos`: 0 errors/warnings (267 pre-existing
  info-level lints, unchanged from baseline).
- `dart format . --set-exit-if-changed`: clean.
- Full detail: `docs/ai/runs/2026-07-02-issue-863-quick-actions.md`.

## Next step

1. Push `issue-863-quick-actions` and open a draft PR for #863 (do not
   merge — leave open for manual review/smoke per the repo's PR
   workflow).
2. Manual smoke handoff: `RHYTHM_LOCAL_SMOKE=1 flutter run -d macos`,
   then open a task's inspector (confirm "Quick Actions" renders 4
   buttons at the bottom of the right panel) and the Dashboard (confirm
   the quick-actions card appears for the next open task); tap "Help me
   finish this" and confirm a new agent session opens with the task's
   context pre-loaded and no typing required.
3. Only merge to `main` after the user confirms manual smoke passed.

---

> Note: this worktree branches directly off `main`. Earlier snapshot
> content describing the separate `codex/mega-2026-07-02` integration
> branch (#848 and related) lives on that branch's own history — it was
> not this branch's context and has been removed from this file to keep
> it an accurate snapshot for `issue-863-quick-actions`. See
> `docs/ai/runs/2026-07-02-mega-buildout-fork-eval-memory.md` for that
> work if needed.
