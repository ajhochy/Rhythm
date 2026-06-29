# Project State

## Current focus

Nine open pull requests are consolidated on
`codex/mega-open-prs-2026-06-28` for one full-stack local smoke.

## Active branch / PR

- Integration branch: `codex/mega-open-prs-2026-06-28`, based on current
  `origin/main`.
- Included source PRs: #754, #757, #758, #790, #799, #800, #809, #810, and
  #811.
- Draft mega PR: #812.

## In progress

- Human smoke is in progress against the rebuilt debug app.
- The app is running with `RHYTHM_LOCAL_SMOKE=1`; local API is on `:4001` and
  the staged mega-branch engine is on `:4096`.

## Risks / known issues

- #758 is defense-in-depth; the bundled-fork event-stream regression remains a
  separate concern tracked by #759.
- Source PRs #754, #757, #758, #790, #799, #800, #809, #810, and #811 are
  closed as superseded by #812; their branches and commit history remain intact.
- `npm install` reports 12 dependency audit findings (1 low, 8 moderate, 3
  high); no dependency versions were changed in this integration run.

## Test status

- All nine source PR heads are ancestors of the integration branch.
- `ai-workflow checks --level issue`: pass.
- `ai-workflow checks --level pr`: pass.
- api_server TypeScript production build: pass.
- Flutter debug macOS build: pass.
- Fork engine build: pass; version
  `0.0.0-codex/mega-open-prs-2026-06-28-202606290201`.
- Memory vault authority drop/rebuild smoke: pass after correcting its stale
  vault-relative path assertion.
- MCP allowlist, skill allowlist, MCP alignment, and skill alignment built-fork
  smokes: pass.
- GitNexus compare against `main`: MEDIUM risk, 121 files / 531 symbols, one
  affected execution flow.

## Next step

Complete the manual smoke checklist on the running app, then review and
manually merge PR #812.

## Recent coding-agent runs

### 2026-06-28 — skills: load managed SKILL.md body on edit (#812 smoke FAIL)
- Files modified:
  - `apps/api_server/src/services/rhythm_managed_skills.ts` — added
    `readSkillContentAtLocation(location)` helper (reads SKILL.md at a
    fork-reported location; handles file-or-dir; null on missing).
  - `apps/api_server/src/routes/opencode_skills_routes.ts` — added
    `GET /opencode/skills/:name/content` returning `{ name, content }`; resolves
    location from the live fork list, 404 when the name is not discovered.
    Viewable for managed AND external skills; write boundary unchanged.
  - `apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart`
    — added `Future<String> getContent(String name)` (local :4001 base).
  - `apps/desktop_flutter/lib/features/agents/views/_managed_skill_editor_sheet.dart`
    — edit mode now fetches the body on init, populates `_contentController`,
    shows a "Loading skill content…" disabled state while fetching, fails soft
    (name/description still editable). Create mode unchanged; `content.trim()`
    save guard preserved.
  - Tests: `opencode_skills_routes.test.ts` (+3: managed round-trip, external
    viewable, 404 unknown); `agent_skills_view_test.dart` (+1 edit round-trip;
    fake gained `getContent`/`update` overrides).
- Checks run:
  - `npx vitest run opencode_skills` → 12 passed.
  - api_server `npm run build` → exit 0.
  - full `npx vitest run` → 176 files / 1498 tests passed.
  - `flutter analyze --no-fatal-infos lib/features/agents/ test/features/agent_skills/`
    → 0 errors/0 warnings (39 pre-existing infos in unrelated files; none in
    changed files).
  - `flutter test test/features/agents/ test/features/agent_skills/` → all passed.
- Decisions made: read content off the fork-reported `location` rather than
  re-deriving the managed path, so the same endpoint serves external skills too;
  location may be a file or a dir so the helper resolves both.
- Deviations from spec: none.
- Concerns: none. Worktree-only node_modules were symlinked from the main
  checkout / `flutter pub get`; not committed.
