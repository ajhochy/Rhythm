# Project State

## Current focus

Open-PR merge train complete. All previously-open PRs are merged into `main`;
zero open PRs remain.

## Active branch / PR

- Branch: `main` at `4259320f5` (post-merge).
- No open PRs.

## In progress

- Nothing. The 9-PR backlog from the 2026-07-16 Codex handoff is fully landed.

## Recently merged (2026-07-16)

- #1104 (#1038 dark-theme Projects) and #1106 (#1082 skill-revert byte-safe) — merged by the prior Codex session.
- #1100 (#1091 gemini anyOf sole-key), #1101 (#1089 cron timezone), #1102 (#1083 NULL MCP scope insert-only),
  #1103 (codex gpt-5.6-sol route), #1095 (#1093 hybrid Engraph memory retrieval),
  #1105 (#1001 live-E2E isolation guard), #1107 (#1041 prompt-fix resolver fallback) — this session.
- Each remaining PR was rebuilt as a single clean commit on current `main`, dropping the shared
  pre-squash #1097 noise that would otherwise have reverted `project-state.md` and re-added divergent
  manager-routing files on squash-merge.

## Risks / known issues

- #1100's fix lives in `apps/opencode_fork` (no fork CI in this repo). Source fix is unit-tested
  (bun test 12/12); the shipping app uses a pre-built fork binary, so a release build must rebuild
  the fork to pick it up.
- Codex's speculative hardening (allowed_mcps_state provenance column, path confinement) was
  deliberately NOT adopted — Codex itself flagged it HIGH blast radius; the PRs' own targeted fixes
  are sufficient and covered by tests.

## Test status

- Final merged `main`: `npm run build` clean, full unit suite 2769 passed / 32 skipped, 0 failures
  (baseline was 2728; +41 from the merged PRs' tests).
- Release smoke (`apps/api_server/scripts/smoke-launch.sh`) on merged `main`: PASS — build + spawn +
  bind :4001 + /health + /agents/capabilities 200 + POST /agent-sessions 201, isolated temp DB.
- All 6 api_server PRs passed `server-checks` CI on their pushed SHAs; #1100 validated locally (no fork CI).

## Next step

Trigger a desktop release build (increment patch from latest tag) when ready to ship; the release
build rebuilds the bundled Node server and the opencode fork binary (needed for #1100 to take effect).

## Recent coding-agent runs

### 2026-07-16 — #1055 (OCU-14 Skills UI source badges), worktree `cluster-c` / branch `epic1116/cluster-c-skills-ui`
- Files modified:
  - `apps/api_server/src/routes/opencode_skills_routes.ts` — added `source: 'managed'|'org'|'external'` to `SkillListEntry`, a `classifySkillSource()` classifier (org = under an XDG-cache-style dir, overridable via `RHYTHM_ORG_SKILLS_CACHE_DIR`, mirroring `RHYTHM_MANAGED_SKILLS_DIR`).
  - `apps/api_server/src/__tests__/opencode_skills_routes.test.ts` — new test asserting `source` classification for managed/org/external locations.
  - `apps/desktop_flutter/lib/features/agents/data/opencode_skills_data_source.dart` — added `OpencodeSkillEntry.source` (defaults from `managed` when omitted, so no other call site broke) + `reload()` (`POST /system/refresh`, best-effort).
  - `apps/desktop_flutter/lib/features/agent_skills/views/agent_skills_view.dart` — `_ProvenanceBadge` now renders MANAGED/ORG/EXTERNAL (was MANAGED/EXTERNAL only); Refresh button now calls `dataSource.reload()` before `loadSkills()`.
  - `apps/desktop_flutter/test/features/agent_skills/agent_skills_view_test.dart` — new tests: mixed managed+org+external fixture asserts ORG badge + hidden edit/delete; Refresh-button test asserts `reload()` fires and a newly-"published" skill appears.
  - `apps/desktop_flutter/test/features/agents/agent_profile_skills_mcp_picker_test.dart` — new test: an org skill is selectable in the profile allowlist with no edit/delete, and persists like any other name.
- Checks run:
  - `apps/api_server`: `npx tsc --noEmit` pass; `npx vitest run` 2770 passed / 32 skipped, 0 failures.
  - `apps/desktop_flutter`: `dart format . --set-exit-if-changed` clean; `flutter analyze --no-fatal-infos` exit 0, 272 info-only issues (identical set to pre-change baseline, no new warnings/errors); `flutter test` 867 passed, 0 failed.
- Decisions made:
  - `_agent_profile_sheet.dart` needed **no production change** — its skill-chip gating already keys off `managed` (bool), and an org skill's `managed` is `false`, identical to external, so it was already selectable with no edit/delete. Added a regression test there instead of speculative code. (Listed in file-ownership as an "edit" target, but the correct diff was test-only.)
  - The "refresh action ... calls backend reloadSkills" criterion was satisfied by pointing the existing Refresh button at the **already-existing** `POST /system/refresh` route (`apps/api_server/src/routes/system_routes.ts`, unmodified — outside my file ownership) rather than adding a new skills-specific reload endpoint.
  - Org-location classification defaults to `~/.cache/opencode/skills` (the fork's `xdg-basedir` cache-dir convention per `apps/opencode_fork/packages/core/src/global.ts` + `.../skill/discovery.ts` `Discovery.pull`) — not yet exercised by real traffic since #1054 (Wave 2, Cluster B) hasn't wired `skills.urls` yet; the classifier is fixture-verified via `RHYTHM_ORG_SKILLS_CACHE_DIR` env override only, per the plan's "#1055 owns the source field contract itself" note.
  - Kept the existing `managed: boolean` field/response key alongside the new `source` field (additive, not a replacement) so pre-existing tests/consumers were undisturbed.
- Deviations from spec: none — scope stayed within the 4 named files + their existing test files.
- Concerns:
  - `gitnexus.detect_changes()` returned "0 changes detected" — GitNexus's "Rhythm" index points at the main checkout path (`/Users/ajhochhalter/Documents/Rhythm`, 13 commits behind HEAD), not this worktree (`Rhythm-wt/cluster-c`), so it could not see this diff. Substituted manual impact tracing (repo-wide grep for every consumer of the touched symbols before editing) + full test-suite runs (backend + Flutter) as the safety net.
  - The live "org badge actually appears end-to-end" behavior still depends on #1054 (Cluster B) wiring `skills.urls` — by design, deferred to post-integration per the plan.
