# Project State

## Current focus

One integration branch (`codex/mega-2026-07-02`, PR #848) carries the entire
2026-07-02 build-out for a single maintainer smoke: the Org Self-Optimizer epic
(#816, all 15 sub-issues), token-efficiency work (#841/#842/#844/#845), the
life-serving layer (#846 recipes, #847 research→vault entries), #834 obsidian
writes, the Ollama provider, and the taskless-trigger schema fix. Memory-vault
epic #801 shipped earlier (in #812) and is closed. Issue #850 (org-optimizer-16,
the run-loop trigger tool) is implemented and verified on its own branch,
ready to fold into the mega branch.

## Active branch / PR

- **PR #848** (draft) — `codex/mega-2026-07-02`. The mega integration; 16 tracks
  folded. Closes #817–#831, #841, #842, #844, #845, #846, #847. Server + Desktop
  CI green.
- **PR #849** (draft) — `issue-843-fork-deferred-tool-loading`. Deferred MCP tool
  loading in the opencode fork (#843); est. 54–74% session-start token drop.
  SEPARATE because it ships only via a signed release; real-binary smoke required
  before merge.
- **`mega-850-optimizer-runloop`** (no PR — pushed, awaiting fold) — issue #850
  (org-optimizer-16): the `rhythm_run_org_optimizer` MCP tool, the live
  run-loop trigger that makes the seeded optimizer actually run. Verified
  (see docs/ai/runs/2026-07-02-issue-850-optimizer-runloop.md); needs to be
  merged into `codex/mega-2026-07-02` before or alongside #848.

## In progress

- Maintainer smoke of PR #848 has not yet started. #850 is complete and
  waiting to fold in first (it closes a documented risk below).

## Risks / known issues

- `create-recipe` (high-risk) has no dedicated apply step beyond the default
  no-op yet.
- `consolidate-skill` proposals need a body-drafting step before they can be
  measured (else they park in `measuring`).
- `exercisedTools` telemetry (prune guard) only sees scheduled-task sessions —
  a safe under-count (never wrongly prunes an exercised tool).
- Recipe generator's "repeated pattern" signal is sourced from webhook-gap
  clustering (exact-title, min-count-3); a fuzzy/semantic detector would be
  stronger.
- `org_optimizer_run_service.ts`'s `maxLlmCallsPerRun` option has no
  enforcement point yet (no generator it calls makes LLM calls today) —
  needs a real counter once one does.
- `agent_profile_sync*` / a few server tests flake under full parallel vitest
  load; green in isolation and on clean re-run (documented pre-existing flake).
- GitNexus has no indexed repo variant matching the per-issue worktree paths
  under `.claude/worktrees/` — `impact`/`detect_changes` fall back to
  tsc + full-suite + build + falsification evidence for those branches.
- On merging any superseded PR/branch, resolve `docs/ai/project-state.md` in
  favor of the branch that's landing.

## Test status

api_server (branch `mega-850-optimizer-runloop`, on top of `codex/mega-2026-07-02`):
- `tsc --noEmit` clean (api_server + mcp_server); `npm run build` clean (both).
- Full `npx vitest run`: 205 files / 1751 tests pass (1 intentional skip).
- `tools/release/smoke_org_optimizer.sh` (#831 epic-wide safety guard): exit 0
  — auto-path reverts; all six high-risk kinds (create-agent,
  grant/expand-delegation, broaden-scope, webhook-wiring, external-adoption)
  refuse auto-apply; external/webhook note-required enforced; fail-injection
  detected. Re-verified clean after #850's changes.
- #850 contract tests (10/10) falsified and confirmed to catch a real
  "high-risk auto-applied" regression — see the run file for detail.

Prior mega-branch (`codex/mega-2026-07-02` tip `3d2d2de15`) baseline:
- Flutter analyze --no-fatal-infos + agent_optimizer/agent_skills tests green
  (35/35). Server CI + Desktop CI green.

## Next step

1. Fold `mega-850-optimizer-runloop` into `codex/mega-2026-07-02` (or land it
   as its own PR against main, maintainer's call — no PR was opened per this
   run's dispatch instructions).
2. Maintainer runs one full smoke of PR #848 (see docs/testing/manual-smoke.md);
   confirm the #815 native notification fires from a role-scoped session
   (last unchecked criterion of the closed #833). Then manual-merge #848.
3. #849 (fork) merges only after a signed-release real-binary smoke.
4. Remaining follow-ups become the next issues: create-recipe apply step,
   consolidate-skill body-drafting, and (once one exists) an LLM-call counter
   for org_optimizer_run_service's maxLlmCallsPerRun.
