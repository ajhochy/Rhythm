# Project State

## Current focus

One integration branch (`codex/mega-2026-07-02`, PR #848) carries the entire
2026-07-02 build-out for a single maintainer smoke: the Org Self-Optimizer epic
(#816, all 15 sub-issues), token-efficiency work (#841/#842/#844/#845), the
life-serving layer (#846 recipes, #847 research→vault entries), #834 obsidian
writes, the Ollama provider, and the taskless-trigger schema fix. Memory-vault
epic #801 shipped earlier (in #812) and is closed.

## Active branch / PR

- **PR #848** (draft) — `codex/mega-2026-07-02`. The mega integration; 16 tracks
  folded. Closes #817–#831, #841, #842, #844, #845, #846, #847. Server + Desktop
  CI green.
- **PR #849** (draft) — `issue-843-fork-deferred-tool-loading`. Deferred MCP tool
  loading in the opencode fork (#843); est. 54–74% session-start token drop.
  SEPARATE because it ships only via a signed release; real-binary smoke required
  before merge.

## In progress

- Nothing executing. Awaiting the maintainer's single full smoke, then manual
  merge of #848 (and #849 after a signed-release smoke).

## Risks / known issues

- **Optimizer live run-loop not built.** #830 seeds the cron tasks + wires the
  audit→generate→apply machinery, but the seeded agent has no tool on its own
  surface to trigger a run. Natural next issue.
- `create-recipe` (high-risk) has no dedicated apply step beyond the default
  no-op yet.
- `consolidate-skill` proposals need a body-drafting step before they can be
  measured (else they park in `measuring`).
- `exercisedTools` telemetry (prune guard) only sees scheduled-task sessions —
  a safe under-count (never wrongly prunes an exercised tool).
- Recipe generator's "repeated pattern" signal is sourced from webhook-gap
  clustering (exact-title, min-count-3); a fuzzy/semantic detector would be
  stronger.
- `agent_profile_sync*` / a few server tests flake under full parallel vitest
  load; green in isolation and on clean re-run (documented pre-existing flake).
- On merging any superseded PR, resolve `docs/ai/project-state.md` in favor of
  this branch.

## Test status

Final verification on `3d2d2de15`:
- api_server `tsc --noEmit` clean; `npm run build` clean.
- Full `npx vitest run`: 204 files / 1741 tests pass (1 intentional skip).
- `tools/release/smoke_org_optimizer.sh`: exit 0 — auto-path reverts; all six
  high-risk kinds (create-agent, grant/expand-delegation, broaden-scope,
  webhook-wiring, external-adoption) refuse auto-apply; external/webhook
  note-required enforced; fail-injection detected.
- Flutter analyze --no-fatal-infos + agent_optimizer/agent_skills tests green
  (35/35).
- Server CI + Desktop CI green on the branch.

## Next step

1. Maintainer runs one full smoke of PR #848 (see docs/testing/manual-smoke.md);
   confirm the #815 native notification fires from a role-scoped session
   (last unchecked criterion of the closed #833). Then manual-merge #848.
2. #849 (fork) merges only after a signed-release real-binary smoke.
3. Follow-ups above become the next issues — first the optimizer live run-loop
   trigger tool, then create-recipe apply + consolidate-skill body-drafting.
