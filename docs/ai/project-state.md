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

### 2026-06-28 — fix(security/#736): isToolAllowed accepts array allowlist form (#812 high-sev)
- Files modified:
  - `apps/api_server/src/services/mcp_dispatch_guard.ts` — `isToolAllowed` now
    accepts BOTH the array-of-server-names form (`["rhythm"]` = each server
    inherit-all) and the existing object map. Factored a shared
    `toolBelongsToServer(toolName, serverName, mcpServerRaw)` helper used by both
    inherit-all paths. Empty array/object → deny all; malformed/unparseable →
    fail closed; null → unrestricted (unchanged).
  - `apps/api_server/src/services/mcp_dispatch_guard.test.ts` — added a 6-case
    `array-of-server-names form (#812)` describe; fixed the misleading `'[]'`
    comment (now "empty server-name array → deny all").
  - `apps/api_server/src/__tests__/opencode_stream_bridge.test.ts` — added 2
    tests: a `["rhythm"]`-scoped secretary session forwards `rhythm_*` tool
    parts and denies `nfl_mcp_*` (end-to-end isToolAllowedForSession path).
- Root cause: writers (`agent_profile_scope.ts:221`, `agent_runner.ts:582/606`)
  persist `mcp_allowed_tools_json` as a JSON array of server names, but the #736
  guard failed closed on `Array.isArray(raw)` → every tool denied for every
  role-scoped session. Fix makes the guard tolerant of the array shape the
  writers already produce; writers untouched (the #765 expander reads the role
  config object, not this string, so advertise-time scoping is unaffected).
- Checks run: `npx vitest run mcp_dispatch_guard mcp_allowlist_expander opencode_stream_bridge` → 32 passed; falsification (revert array branch) → 4 #812 cases fail; `npm run build` (tsc) → exit 0; full `npx vitest run` → 176 files / 1506 tests passed.
- Decisions made: kept the fix in the dispatch guard only (not the writers), per
  spec — the writers' array form is also consumed elsewhere.
- Deviations from spec: spec listed `agent_profile_scope` in the vitest filter,
  but no such test file exists; that path's array/object parsing is covered by
  `mcp_allowlist_expander.test.ts`. No `agent_profile_scope` source change.
- Concerns: writer-side shape is still inconsistent (array vs object map across
  call sites). Recommend a follow-up to normalize writers to one canonical
  shape; out of scope for this minimal high-sev fix.

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

### 2026-06-28 — feat(flutter/#813): skills menu → sortable + searchable table with lazy-expand body
- Files modified:
  - `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart`
    — full redesign of the standalone Skills menu from a ListView of tiles into
    a sortable/searchable table. Added a live search field
    (`skills-search-field`, filters Name+Description, case-insensitive
    substring); a sortable header (`skills-sort-name` / `skills-sort-description`
    toggling asc↔desc, default Name asc, arrow indicator keyed
    `*-asc`/`*-desc`); expandable rows (`skill-row-<name>`) that lazily fetch the
    SKILL.md body via `OpencodeSkillsDataSource.getContent` on first expand and
    cache it per-row (`_SkillRow` is now stateful), with spinner / soft-error /
    scrollable monospace `SelectableText` states. Preserved verbatim: New skill
    button, managed edit/delete, external read-only lock
    (`readonly-skill-<name>`), MANAGED/EXTERNAL + lifecycle badges, meta/score
    lines (moved into the expansion area; lifecycle pill stays in the trailing
    cell), loading/empty/error states, and `:4001`-only data source. Controller
    + data source unchanged.
  - `apps/desktop_flutter/test/features/agent_skills/agent_skills_view_test.dart`
    — added a `#813` group: sort toggles row order by Name and by Description;
    search filters by name + description + no-match placeholder + clear;
    expanding calls getContent exactly once (cached on re-expand) and renders the
    body; failed fetch shows a soft error. Updated the two metadata tests to
    expand the row (score/provenance moved into the expansion) and scoped the
    create/edit field finds to `ManagedSkillEditorSheet` (the page now has a
    search TextField too).
- Checks run:
  - `dart format lib/features/agent_skills/ test/features/agent_skills/` → clean.
  - `flutter analyze --no-fatal-infos lib/features/agent_skills/ test/features/agent_skills/`
    → 0 errors / 0 warnings.
  - `flutter test test/features/agent_skills/` → 16 passed.
  - Falsification: forcing the sort comparator to ignore `_ascending` fails both
    sort tests; early-returning from `_maybeFetchBody` (never fetching) fails the
    lazy-body cache test. Both reverted.
- Decisions made: kept body view-on-expand only (maintainer chose lazy-load), so
  Body is neither sortable nor searchable. Per-row body cache lives in
  `_SkillRowState` (keyed by ValueKey on skill name); editing a managed skill
  clears caches via a parent `setState` so a re-expand refetches the new body.
- Deviations from spec: none.
- Concerns: trailing status/actions cell is a fixed 132px (`_kTrailingCellWidth`)
  to fit a lifecycle pill + edit + delete without overflow at the 800px test
  width; the badge is `Flexible` as a belt-and-suspenders against long statuses.
