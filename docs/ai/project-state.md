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
- A smoke-found #813 fix (Skills table Status column now populated for `active`
  skills + sortable) is committed on a worktree branch off the mega tip
  (`ca29709d7`), awaiting fold into `codex/mega-open-prs-2026-06-28` and
  re-smoke. See `docs/ai/runs/2026-06-28-issue-813-status-column.md`.

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
- PR #812 Desktop CI formatter repair: local format check, Flutter analysis,
  and all 730 Flutter tests pass; Desktop, Server, and MCP GitHub CI pass.
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
- #813 Status-column fix (worktree `ca29709d7`): `dart format
  --set-exit-if-changed` pass, `flutter analyze` 0/0, `flutter test
  test/features/agent_skills/` 18 passed (both new tests falsified); real-surface
  render probe confirmed the column paints a pill per lifecycle (not blank).

## Next step

Fold the #813 Status-column fix into `codex/mega-open-prs-2026-06-28`, then
complete the manual smoke checklist on the running app and review/manually merge
PR #812.

## Recent coding-agent runs

### 2026-06-28 — feat(agents): grant obsidian read/search to all selectable agents
- Selectable+roled set (mode:primary opencode agent + a `.mcp-roles/<slug>.mcp.json`):
  email-assistant, fantasy-gm, graphic-designer, secretary, worship-planning,
  worship-production. librarian/theologian/research are also selectable+roled but
  LEFT AS-IS (already obsidian-scoped, incl. their write tools). church-admin /
  daily-briefing / dev / ffb have role files but NO opencode agent → non-selectable
  → out of scope.
- Files modified:
  - `.mcp-roles/email-assistant.mcp.json`, `.mcp-roles/graphic-designer.mcp.json` —
    added an `obsidian` `mcpServers` entry (`inherit:true`) granting the READ/SEARCH
    tool subset only (get_file/get_active/get_periodic/open_file/simple_search/
    search_dataview/search_json_logic/list_vault_directory/list_vault_root/status —
    NO put/patch/post/delete/execute). These were the only selectable+roled agents
    lacking obsidian; the other four already had it.
  - `apps/api_server/src/services/agent_profile_sync.ts` — `IMPORTER_DEFAULT_ALLOWED_MCPS_JSON`
    `["rhythm"]` → `["rhythm","obsidian"]` so future-synced profiles advertise obsidian
    by default (still routed through #789 normalize → #788 validate against live ids).
  - `apps/api_server/src/services/obsidian_scope_backfill.ts` (NEW) — one-time,
    idempotent boot backfill mirroring `skill_metadata_backfill`: for existing
    SELECTABLE `agent_configs`, array scope w/o obsidian → append `"obsidian"`;
    object-map w/o obsidian → add `"obsidian":[read/search tools]`; null → leave null;
    already-has-obsidian → untouched (preserves write grants). schema_meta marker
    `agent_configs_obsidian_read_scope_v1`; Postgres no-op; never throws.
  - `apps/api_server/src/server.ts` — wired the backfill into the agent-execution boot
    block (after the skill unify backfill), non-fatal + non-blocking.
  - Tests: NEW `obsidian_scope_backfill.test.ts` (pure grant fn + real-DB array/object/
    null/already-has/non-selectable/idempotent/Postgres-no-op); updated
    `agent_profile_sync.test.ts`, `agent_profile_sync_mcp_alignment.test.ts`,
    `agent_profile_sync_mcp_validation.test.ts` for the two-name default.
- Checks run: `npx vitest run agent_profile_sync mcp_dispatch_guard mcp_allowlist_expander
  mcp_names_alignment obsidian_scope_backfill` → 9 files/74 passed; falsification
  (break array-append, then object-key add) → 2 backfill tests fail each, restored;
  local `tsc -p tsconfig.json` → exit 0; full `npx vitest run` → 177 files/1516 tests
  passed (one unrelated `projects_routes` parallel-isolation flake on the first run,
  green on re-run). All 13 `.mcp-roles/*.mcp.json` JSON-valid.
- Decisions made: array members are inherit-all at the ADVERTISE layer (#765); the
  role file's read/search tool list is what restricts a roled agent's actual obsidian
  surface (#736 dispatch backstop). Non-roled selectable agents (claude-code,
  workflow-orchestrator) get full obsidian read+search at advertise-scope — acceptable
  for knowledge access. Migration presets (claude-code/codex/gemini-cli/opencode) carry
  NULL scope so the backfill leaves them unrestricted (no change needed).
- Deviations from spec: spec named 6 selectable+roled agents to grant; verification
  found 4 of them (fantasy-gm/secretary/worship-planning/worship-production) ALREADY
  had obsidian, so only email-assistant + graphic-designer role files were edited.
- Concerns: takes effect on the next app rebuild + session start (config-via-code, no
  live-DB surgery). node_modules was symlinked from the main checkout for tests; NOT
  committed.

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

### 2026-06-28 — fix(flutter/#813): populate Status column for active skills + make it sortable
- Files modified:
  - `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart`
    — the trailing cell now renders a lifecycle pill for EVERY skill (was only
    `measuring`/`reverted`), so the Status column is never empty on a normal
    system where all skills are `active`. Added `_statusOf(skill)` (defaults to
    `active` when `metadata`/`status` is absent, per the server default) and
    `_statusRank` (measuring → reverted → active, unknown last). `_StatusBadge`
    now colors `reverted` red, `measuring` amber, and `active`/unknown a muted
    neutral pill. Added `_SortColumn.status` + a Status comparator (rank with a
    Name tiebreak) and made the previously static `Status` header a sortable
    `_HeaderCell` keyed `skills-sort-status` (asc/desc arrow like Name/Desc).
    Name stays the default sort.
  - `apps/desktop_flutter/test/features/agent_skills/agent_skills_view_test.dart`
    — +2 tests in the #813 group: (a) an `active` skill renders a visible
    `status-badge-active` pill (column not empty); (b) clicking `skills-sort-status`
    sorts rows by lifecycle (measuring → reverted → active) and toggles asc↔desc.
- Controller/data source: NO change needed — `AgentSkillsController.loadSkills`
  already calls `listWithMetadata()` (`agent_skills_controller.dart:49`), so each
  entry already carries `metadata.status`. The gap was purely the view gating the
  pill on `status != 'active'`.
- Checks run:
  - `dart format lib/features/agent_skills/ test/features/agent_skills/` → clean.
  - `flutter analyze --no-fatal-infos lib/features/agent_skills/ test/features/agent_skills/`
    → No issues found (0 errors / 0 warnings).
  - `flutter test test/features/agent_skills/` → 18 passed (16 prior + 2 new).
  - Falsification: gating the pill on `status != 'active'` fails the active-pill
    test; forcing the status comparator to `byRank = 0` fails the status-sort
    test. Both reverted; full suite green after restore.
- Decisions made: status sort order groups attention-needing states first
  (measuring → reverted → active) with a Name tiebreak; `active` pill uses the
  muted neutral token so it is visible but not loud.
- Deviations from spec: none.
- Concerns: with every row now rendering a pill, a default-metadata list shows
  multiple `status-badge-active` widgets — tests assert `findsOneWidget` only on
  single-skill lists, so this is fine, but key-uniqueness assertions on
  multi-active lists would need a name-scoped key.
