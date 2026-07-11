---
date: 2026-07-11
repo: Rhythm
branch: workflow/run-2026-07-11
pr: (pending)
issues: [1006, 1007, 1008, 1009, 1010, 1012, 1013, 1014, 1015]
status: verified-pre-pr
tags: [run, Rhythm]
index: "[[Rhythm]]"
---

# Non-mobile wave (2026-07-11) — Codex terra, multi-worktree

9 standalone open non-mobile issues, coded by `codex exec -m gpt-5.6-terra` (one
worktree per issue under `../Rhythm-wt/`), integrated onto one wave branch, then
verified. Codex CLI was upgraded 0.136.0 → 0.144.1 (terra requires it). Codex ran
`-s workspace-write -c approval_policy=never -c mcp_servers={}`; it could not
commit (sandbox blocks the shared worktree `.git` lock), so commits were made
from the orchestrator shell after review.

## Files changed (by issue)
- **#1006** session_history_view.dart + model — errored-session transcript render + interrupted empty-state.
- **#1007/#1008** agent_runner.ts — `_withinRunDeadline` wraps MCP preflight + createSession + prompt (no more stuck 'starting'); headless auto-title from first prompt. +tests.
- **#1009** agents_controller.dart + chat_models.dart — retain streamed reasoning delta; **root-cause fix: guard `mergePart` so an empty reasoning snapshot can't clobber streamed text** (Codex's first pass guarded `_upsertChatPart` but `mergePart` re-clobbered — its own regression test caught it). +test.
- **#1010** new `time_format.dart` + 15 sites + main.dart init + timezone/intl deps — Pacific 12h AM/PM. `dart format .` normalized Codex's non-canonical style churn.
- **#1012** opencode_fork tool/task.ts — subagent sessions now carry mcpAllowlist (sourced from child profile `.md` frontmatter) + Gemini deferred-catalog to dodge 512 cap. +fork test.
- **#1013** org_proposals_view.dart + model — field-level before/after diff on proposal cards. +test.
- **#1014** opencode_agent_writer.ts + agent_configs_controller.ts — project delegate roster into `permission.task` (fail-closed) + reload on edit.
- **#1015** agent_configs_controller.ts — best-effort engine config reload after create/patch/remove.

## Checks run
- api_server `tsc --noEmit`: PASS (integrated). Targeted vitest (agent_runner, agent_configs routes, writer): 75/75 PASS.
- Fork built `bun run build --single` → `0.0.0-workflow/run-2026-07-11`; `task.test.ts` 10/10 PASS.
- Flutter: `dart format --set-exit-if-changed .` clean; `flutter analyze` 0 errors/0 warnings; touched-area tests 529 PASS (incl. #1009 c1a-regression, #1013).
- **Live e2e** (own api_server on :4011 + built fork, `RHYTHM_OPENCODE_BIN_DIR`, engine line "fork patches active"):
  - #1015: `POST /system/refresh` → `{"refreshed":["skills","agent-profiles"]}` (the exact path the controller now calls after writes).
  - #1014: PATCH secretary delegates → projected `.md` `permission.task` gains/loses `"config-doctor": allow` under `"*": deny`.
  - #1008: triggered run → engine log `Run timed out during prompt after 45000ms` (deadline fires; no infinite 'starting').

## Notes / deviations
- Repair loop fired once: #1009 verification-gate FAIL (Codex's own regression test), root-caused to `mergePart` sink, fixed in-orchestrator.
- Merge conflict #1014↔#1015 on agent_configs_controller.ts resolved to a single unconditional best-effort reload (supersedes #1014's conditional). Stale test count fixed (create() now also reloads).
- :4011 shares the app's SQLite DB (torn-read warning) → session-row inspection unreliable; used endpoint/file/log evidence instead. Server stopped after checks to protect the running app.
- **Not rebuilt** (already in open PR #1005 awaiting manual smoke): #999/#1000/#1002/#1003/#1004/#981.
- **Queued**: Plan A/B epic #983–#997 (milestones 87/88) — dependency chain, next Codex wave.
- Mobile excluded: #1011, #418, #71.
