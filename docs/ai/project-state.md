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

**2026-06-28 — #785 added the MCP analogue of the #777 skill guards.** A vitest
`mcp_names_alignment.test.ts` + a real-binary `smoke_mcp_alignment.sh` (wired into
`desktop_release.yml`) now enforce two invariants for MCP: (1) names alignment —
every name in a persisted/derived `allowed_mcps_json` exists in the live
`GET /opencode/mcp` id set (the #781 hazard: `ableton` vs `ableton-mcp`); (2)
no-server-lost — the GET /opencode/mcp enrichment mapping is additive (ids OUT ==
ids IN). The guard *detects* MCP-scope drift; #789 still owns *building* the
agent_profile_sync reconciliation that intersects `allowed_mcps_json` with the
live set (the MCP path currently writes a static `["rhythm"]`, unlike the skill
path's Unify-3 intersection). See
`docs/ai/runs/2026-06-28-issue-785-mcp-names-alignment.md`.

## Active branch / PR

- **Branch:** `feature/unify-skills-source-of-truth` (stacked off
  `fix/issue-775-skill-allowlist-guard`). PR about to open against `main`; **do
  not merge** — human review + manual smoke first.
- **#775 / PR #776** remains open (smoke PASSED, ready for human merge). Merge
  #776 first or merge this PR after it, since this branch contains #775's commits.
- Ships only after a **fork rebuild + signed release** (the fork binary is
  bundled; release CI rebuilds it).
- **#785** committed on worktree branch `worktree-agent-a8e47e60d1bc0fe28`
  (off `feature/mcp-unify`), commit `854216ed6` — test+CI-only, PR not yet opened.

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
- **#785:** `mcp_names_alignment.test.ts` **5 pass** + 4 related files (37 pass
  total); `tsc --noEmit` 0 errors; `smoke_mcp_alignment.sh` `bash -n` OK (wired
  into `desktop_release.yml`; real-binary serve runs only in release CI).

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

## Next step

1. **#785 (this run):** open a PR from `worktree-agent-a8e47e60d1bc0fe28` with
   `Closes #785` (test + CI-wiring only; no merge). The real-binary smoke first
   exercises end-to-end on the next signed release build.
2. **Skills unification:** open the PR for `feature/unify-skills-source-of-truth`
   (draft, no merge) with `Closes #777`. Then human-merge #776 and that PR, cut a
   signed release, and work the post-merge manual-smoke list against that build.
3. **#789** still owns building the agent_profile_sync MCP reconciliation that
   the #785 guard detects (intersect `allowed_mcps_json` with the live MCP set,
   mirroring the skill path's Unify-3 intersection).
