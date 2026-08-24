---
date: 2026-08-20
repo: Rhythm
branch: agent-stack/si-d3-desktop-feedback-sonnet
pr: none
issues: [1437]
status: verified
tags: [run, Rhythm, D3]
---

# D3.2 — Add run-outcome feedback (success/partial/failure + optional reason) to the session detail panel

## Context

Recovered mid-flight after a max-turn boundary. Prior work on this branch
(uncommitted) had already built almost the full surface: `RunOutcomeFeedback`
model, `AgentsDataSource.fetchRunOutcomeFeedback` / `postRunFeedback` against
the real `GET/POST /agent-run-outcomes/:sessionId[/feedback]` route
(`apps/api_server/src/routes/run_outcome_routes.ts`), matching
`AgentsRepository` and `AgentsController` plumbing, a `_RunFeedbackSection`
widget wired into the Context tab of `_session_side_panel.dart`, and a
comprehensive widget-test file (`d3_2_run_feedback_test.dart`, 5 cases). Per
this track's OWNERSHIP note, `apps/mobile/` (the issue's estimated file list)
is out of scope — the desktop client is the real shipping surface, matching
the sibling D3.1 issue's precedent.

This pass's job was to finish it: add the optional free-text `reason` field
the server route already accepts (`{ verdict, reason?, actor? }` in
`run_outcome_service.ts`) but that the interrupted work hadn't wired up yet,
then verify every acceptance criterion end to end.

## What changed this pass

- `apps/desktop_flutter/test/features/agents/d3_2_run_feedback_test.dart` —
  added `postedReasons` tracking to the fake repository and two new
  `testWidgets` cases (reason sent when typed; omitted when blank), written
  before the implementation (TDD).
- `apps/desktop_flutter/lib/features/agents/data/agents_data_source.dart` —
  `postRunFeedback` gained an optional `{String? reason}` param; sent as JSON
  `reason` only when non-blank after trimming (never an empty string).
- `apps/desktop_flutter/lib/features/agents/repositories/agents_repository.dart`
  and `.../controllers/agents_controller.dart` — passthrough of the new
  optional `reason` param.
- `apps/desktop_flutter/lib/features/agents/views/_session_side_panel.dart` —
  `_RunFeedbackSection` gained a `TextField` (key `run-feedback-reason`) below
  the three verdict buttons; its trimmed value is sent with the next verdict
  tap and cleared on success.
- `apps/desktop_flutter/test/features/agents/new_session_dialog_error_test.dart`,
  `apps/desktop_flutter/test/features/agents/opc_713_create_loading_test.dart`,
  `apps/desktop_flutter/integration_test/follow_up_smoke_test.dart` — three
  other `implements AgentsRepository` fakes needed their `postRunFeedback`
  override signature updated (two lacked a `noSuchMethod` fallback, so the
  signature change was a compile error for them); the two `test/` fakes
  already had `fetchRunOutcomeFeedback`/`postRunFeedback` stubs from the
  interrupted D3.2 work, the `integration_test/` one had neither and needed
  both added.
- `docs/ai/contracts/issue-1437.json`, this run note — new.

## Checks

- `flutter test test/features/agents/d3_2_run_feedback_test.dart`: **7/7
  passed** (5 pre-existing + 2 new reason cases).
- `flutter test test/features/agents/`: **713/713 passed** (full directory,
  confirms the three fake-repository signature fixes didn't regress anything
  else that constructs those fakes).
- `dart format --set-exit-if-changed` on every touched file: initially
  flagged 3 files (formatting drift from the signature-fix edits); ran
  `dart format` to fix, re-ran `--set-exit-if-changed`: 0 changed, exit 0.
- `flutter analyze --no-fatal-infos` (whole package): 0 errors/warnings.
  Before the three fake-repository fixes this correctly failed with `Missing
  concrete implementations of 'AgentsRepository.fetchRunOutcomeFeedback' and
  'AgentsRepository.postRunFeedback'` in `opc_713_create_loading_test.dart`
  and `integration_test/follow_up_smoke_test.dart` — both were pre-existing
  gaps from the interrupted work (the reason param just widened the same
  missing-override surface), fixed as part of this pass.
- `git diff --check`: clean.
- Added-line secret/security scan (grep for key/token/password/
  connection-string/private-key shapes) on the diff: no matches.
- GitNexus `detect-changes`: **UNKNOWN** — no GitNexus tool is exposed in
  this session (checked via ToolSearch), so it could not be invoked at all.
  Mitigated by direct `git status --short` / `git diff --stat` inspection:
  exactly the 9 files listed above changed, all inside
  `apps/desktop_flutter/` and `docs/ai/`.

## Risk

Server-side route and model (`run_outcome_routes.ts`, `run_outcome_service.ts`,
`agent_run_outcome.ts`) were read for contract verification only — not
modified. All production changes are additive (new optional param, new
optional UI field) and confined to the desktop client; existing callers of
`postRunFeedback(id, verdict)` without `reason` are unaffected since it's a
trailing optional named parameter. GitNexus binding to this worktree is
UNKNOWN (tool unavailable), mitigated as above.
