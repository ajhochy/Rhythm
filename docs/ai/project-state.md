# Project State

## Current focus

**2026-06-28 — Skills unified onto the opencode engine (7 issues), verified on a
branch stacked over #775.** The engine's filesystem skill store is now the single
source of truth: api_server proxies the fork's live `GET /skill` and writes
Rhythm-owned `SKILL.md` into an additively-registered managed dir; the fork gained
a `POST /skill/reload` re-scan trigger; both Flutter pickers (skills + MCP) read
live data and the skills picker authors managed skills; `agent_profile_sync` now
validates derived allowlists against the live skill set; published DB skills
materialize to `SKILL.md`. All three hardcoded skill-name lists are gone.
Supersedes #777. See `docs/ai/runs/2026-06-28-unify-skills-source-of-truth.md`
and `docs/ai/decisions/2026-06-28-unify-skills-source-of-truth.md`.

Builds on **#775** (per-session `skillAllowlist` enforcement, PR #776, smoke
PASSED) — this work keeps the picker names aligned with what #775 enforces.

## Active branch / PR

- **Branch:** `feature/unify-skills-source-of-truth` (stacked off
  `fix/issue-775-skill-allowlist-guard`). PR about to open against `main`; **do
  not merge** — human review + manual smoke first.
- **#775 / PR #776** remains open (smoke PASSED, ready for human merge). Merge
  #776 first or merge this PR after it, since this branch contains #775's commits.
- Ships only after a **fork rebuild + signed release** (the fork binary is
  bundled; release CI rebuilds it).

## In progress

- Nothing actively coding. Awaiting: (1) human review/merge of PR #776 then this
  PR; (2) post-merge manual smoke against a signed build.

## Risks / known issues

- **Visual/live smoke deferred (needs signed fork rebuild):** the new pickers
  only exercise `GET/POST /skill` + `POST /skill/reload` against a rebuilt+signed
  fork binary. Behavior is covered by widget tests against the real
  `AgentProfileSheet`; pixel/interaction confirmation is a post-merge manual item.
- **6 pre-existing failures** in `agent_trigger_watcher_test.dart` (auth-change/F2)
  — unrelated to this work (fail in isolation, no import of changed files); a
  follow-up was spawned. Do not attribute to skill unification.
- Managed skills dir is `~/.config/opencode/rhythm-managed-skills` (env-overridable
  via `RHYTHM_MANAGED_SKILLS_DIR`); registered additively in `skills.paths` — must
  never collide with the `sync-globals` paths (`~/.claude/skills` etc.).
- Fork binary is gitignored + per-branch; release CI rebuilds + signs it.
- **#737 fencing scope:** only gmail MCP tool results are fenced (follow-up).

## Test status

- api_server: `tsc --noEmit` 0 errors, `npm run build` exit 0, `vitest run`
  **1344 pass / 160 files**.
- Fork: `bun test` skill+tool **20 pass/0 fail**; httpapi-exercise (coverage/auth/
  effect) **149 pass/0 missing** each.
- Flutter: `analyze --no-fatal-infos` 0 errors/0 warnings; agents widget tests
  **14 pass** (6 unrelated pre-existing trigger-watcher failures noted above).
- New real-binary guard `smoke_skill_alignment.sh` wired into `desktop_release.yml`.

## Pending manual smoke (post-merge, against a signed build)

- **Skills unification (this run):** Agent Profiles → a profile → Agent Profile
  sheet. Confirm (a) Skills picker after "Restrict" lists the engine's **live**
  skill names (not 14 hardcoded); (b) a managed skill shows edit/delete + "New
  skill" round-trips (create → appears → editable); (c) external skills show no
  edit/delete; (d) MCP picker after "Restrict" lists live server names, empty
  state when none; (e) Settings → Server URL change does not affect either picker;
  (f) a published DB skill appears in the picker and a scoped session still omits
  out-of-scope skills (#775 intact).
- Carry-over (still owed from prior batch): #720 compaction divider, #723 MCP
  remove/sync, #731 shell-runner removal, #736 WS tool-gating, #770 Brain
  mirror-sync, #737 email fencing. (#765 MCP scoping + #775 skill scoping already
  smoked — skip.)

## Recent coding-agent runs

### 2026-06-28 — #782 fix agent_trigger_watcher F2/smoke-gate test failures
- Files modified: `apps/desktop_flutter/lib/app/core/agents/agent_trigger_watcher.dart`
  — added optional `isFlutterTest` param (default `false`) to
  `computeIsLocalSmokeRun`; when true the env-var smoke path is ignored. The
  `isLocalSmokeRun` getter now passes `Platform.environment['FLUTTER_TEST']=='true'`.
- Root cause: NOT the F2 auth-change tests (those pass). `RHYTHM_LOCAL_SMOKE=1`
  was leaked into the test session's environment; under `flutter test`
  (`kDebugMode==true`) `isLocalSmokeRun` honored it and `start()` no-op'd,
  failing 6 polling/isPolling/smoke-gate tests. Same #651 launchd-leak class,
  but for debug/test runs. Test was correct (line 558 asserts hermeticity); SUT
  was env-sensitive.
- Checks run: target file `flutter test` WITH `RHYTHM_LOCAL_SMOKE=1` set → 11/11
  pass; `issue_651_contract_test.dart` → 7/7 pass (signature change is additive);
  full `test/features/agents/` → 459 pass/0 fail; `dart format` 0 changed;
  `flutter analyze` 0 issues; gitnexus detect_changes risk LOW.
- Decisions made: additive optional param preserves the #651 c8a–c8c contract
  exactly (they don't pass `isFlutterTest`); dart-define precedence unchanged.
- Deviations from spec: issue framed failures as the "F2 auth-change" group;
  actual failures were the polling/smoke-gate tests in the same file. Fix lands
  in the same file either way.
- Concerns: none. Production `flutter run` smoke + release #651 hardening
  behavior unchanged (FLUTTER_TEST is only set by the test harness).

## Next step

Open the PR for `feature/unify-skills-source-of-truth` (draft, no merge) with
`Closes #777`. Then human-merge #776 and this PR, cut a signed release, and work
the post-merge manual-smoke list against that build.
