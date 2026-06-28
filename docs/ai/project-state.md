# Project State

## Current focus

**2026-06-28 — Unify MCP source of truth (Phase 1 + 2 progressing).** The live
opencode engine list (`GET /opencode/mcp`) is the single source of truth for which
MCP servers exist; the curated catalog is a documented install-template/enrichment
layer that materializes INTO the engine (mirrors the skills unification). Done so
far on `feature/mcp-unify` + worktrees off it:
- **#785** — vitest `mcp_names_alignment.test.ts` + real-binary `smoke_mcp_alignment.sh`
  (wired into `desktop_release.yml`) guard two invariants: names-alignment (every
  persisted/derived `allowed_mcps_json` name exists in the live id set — the #781
  `ableton` vs `ableton-mcp` hazard) and no-server-lost (enrichment mapping is
  additive).
- **#786** — `GET /opencode/mcp` entries tagged with `source: curated|rhythm|adhoc`
  provenance (derived from the live list, not a second display source).
- **#787** — `curated_mcp_servers.ts` pinned as install-template + enrichment only,
  with a `curated_mcp_no_display.test.ts` guard.
- **#788** (this run) — `agent_profile_sync` now validates the importer default
  `["rhythm"]` (and any derived MCP scope) against the live engine id set before
  persisting (`validateMcpsAgainstLive`, mirrors the skill-side
  `filterAllowlistToLive`); a dead name is dropped + logged loudly, never silently
  persisted as #765 scope. The two Flutter auto-installers are documented as the
  materialize-on-install trigger (KEEP decision). See
  `docs/ai/runs/2026-06-28-issue-788-mcp-default-validation.md` and the addendum in
  `docs/ai/decisions/2026-06-28-unify-mcp-source-of-truth.md`.

Predecessor focus (still open): **Skills unified onto the opencode engine** (PR
for `feature/unify-skills-source-of-truth`, `Closes #777`), stacked over **#775**
(per-session `skillAllowlist` enforcement, PR #776, smoke PASSED). See
`docs/ai/runs/2026-06-28-unify-skills-source-of-truth.md`.

## Active branch / PR

- **MCP-unify:** `feature/mcp-unify` carries #785/#786/#787. **#788** committed on
  worktree branch `worktree-agent-ab13d5db46bec7b0d` (off `feature/mcp-unify`),
  commit `38546b36c` — verification-gate PASS; do NOT push (merges back into
  `feature/mcp-unify`). PR for the milestone not yet opened.
- **Skills:** `feature/unify-skills-source-of-truth` PR about to open against
  `main` (`Closes #777`); **do not merge** — human review + manual smoke first.
- **#775 / PR #776** open (smoke PASSED, ready for human merge); merge it before
  or with the skills PR.
- All MCP/skills work ships only after a **fork rebuild + signed release** (the
  fork binary is bundled; release CI rebuilds it).

## In progress

- **#789** (mcp-unify-05, name-drift reconciliation / `mcp_name_alignment.ts`
  alias helper) — NOT yet implemented on `feature/mcp-unify` (verified absent). It
  will introduce the shared alignment helper that #788's `validateMcpsAgainstLive`
  and the skill `filterAllowlistToLive` should later fold onto, plus alias
  normalization (`ableton`→`ableton-mcp`, `nfl-mcp`→`nfl_mcp`).
- Otherwise nothing actively coding; awaiting human review/merge of the open PRs +
  post-merge manual smoke against a signed build.

## Risks / known issues

- **#788 validates exact live-id membership only** — alias/normalization (display
  vs id) is deferred to #789. A user-entered persisted `allowed_mcps_json` row that
  is a stale alias is NOT rewritten (intentional, #765 back-compat) and enforces
  nothing until re-picked; #785's guard flags it.
- **Visual/live smoke deferred (needs signed fork rebuild):** the new pickers only
  exercise `GET/POST /skill` + `POST /skill/reload` against a rebuilt+signed fork
  binary; pixel/interaction confirmation is a post-merge manual item.
- **6 pre-existing failures** in `agent_trigger_watcher_test.dart` (auth-change/F2)
  — unrelated; a follow-up was spawned. Do not attribute to MCP/skill unification.
- Pre-existing `prefer_interpolation_to_compose_strings` info in
  `lib/app/core/agents/ansi_strip.dart` (from PR #552) — out of scope, info-level.
- Managed skills dir `~/.config/opencode/rhythm-managed-skills` (env-overridable);
  registered additively in `skills.paths` — must never collide with `sync-globals`
  paths.
- Fork binary is gitignored + per-branch; release CI rebuilds + signs it.
- **#737 fencing scope:** only gmail MCP tool results are fenced (follow-up).

## Test status

- api_server: `tsc -p tsconfig.json` exit 0. `vitest run agent_profile_sync
  mcp_names_alignment curated_mcp_no_display` → **44 pass / 6 files** (incl. the new
  `agent_profile_sync_mcp_alignment.test.ts`, 4 tests; falsification confirmed).
  Full suite last measured at 1344 pass / 160 files (pre-#788; #788 adds 1 file).
- Flutter: `analyze --no-fatal-infos` on the two edited auto-installer files → 0
  issues; `dart format` 0 changed.
- Real-binary guards `smoke_skill_alignment.sh` + `smoke_mcp_alignment.sh` wired
  into `desktop_release.yml` (run only in release CI).

## Next step

Implement **#789** (`mcp_name_alignment.ts` alias helper + reconciliation) on
`feature/mcp-unify`, folding #788's `validateMcpsAgainstLive` + the skill
`filterAllowlistToLive` onto the shared helper. Then open the MCP-unify PR
(milestone close), merge the skills PR + #776, cut a signed release, and run the
post-merge manual-smoke list against that build.

## Pending manual smoke (post-merge, against a signed build)

- **MCP-unify:** Agent Profiles → a profile → Agent Profile sheet → MCP picker
  after "Restrict" lists live server names (live ids, not stale aliases), empty
  state when none; a scoped session omits out-of-scope MCP tools (#765 intact);
  Settings → Server URL change does not affect the picker. Confirm curated/rhythm
  auto-install still materializes servers into the engine on launch.
- **Skills unification:** Skills picker after "Restrict" lists the engine's live
  skill names; managed skill edit/delete + "New skill" round-trips; external skills
  show no edit/delete; a published DB skill appears and a scoped session omits
  out-of-scope skills (#775 intact).
- Carry-over: #720 compaction divider, #723 MCP remove/sync, #731 shell-runner
  removal, #736 WS tool-gating, #770 Brain mirror-sync, #737 email fencing. (#765
  MCP scoping + #775 skill scoping already smoked — skip.)
