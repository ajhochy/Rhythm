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
- `mega-854-resolver-agentconfig` (no PR — pushed, feeds into #848) — fixes a
  bug BLOCKING the live agent evaluation: the WS per-turn model resolver
  ignored `agent_configs`, stalling custom agent sessions. See
  `docs/ai/runs/2026-07-02-issue-854-resolver-agentconfig.md`.

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
   trigger tool, then create-recipe apply (done, see below) + consolidate-skill
   body-drafting.

## Recent coding-agent runs

### 2026-07-02 — issue-851 (org-optimizer-17: create-recipe apply step)
- Files modified:
  - `apps/api_server/src/services/generators/recipe_generator.ts` — added
    `buildCreateRecipeApplier` / `registerCreateRecipeApplier` (the `create-recipe`
    apply step: creates an `agent_cookbook` row from `change_json`
    title/description/steps_json + optional `boundConfigId`; idempotent via a
    title match; returns `beforeSnapshotJson: { createdCookbookId }` for revert).
  - `apps/api_server/src/services/org_proposal_appliers_wiring.ts` — registered
    `registerCreateRecipeApplier` + a new `validateCreateRecipeShape` structural
    validator in `registerAllProposalAppliers()` (this module's owner for #851).
  - `apps/api_server/src/__tests__/issue_851_contract.test.ts` (new) — contract
    tests for all 4 acceptance criteria.
  - `docs/ai/contracts/issue-851.json` (new) — acceptance contract, all 4
    criteria `pass`.
- Checks run:
  - `npx vitest run src/__tests__/issue_851_contract.test.ts` — 7/7 pass.
  - `npx vitest run recipe_generator create_recipe proposal_appliers agent_cookbook org_proposal` — 48/48 pass.
  - `tsc --noEmit` — clean.
  - Full `npx vitest run` — 1747 pass / 1 skip / 1 fail; the 1 failure
    (`agent_profile_sync_hygiene.test.ts` timeout) is the pre-existing
    documented flake (see Risks above) — reproduced green in isolation
    (`npx vitest run src/__tests__/agent_profile_sync_hygiene.test.ts` → 20/20).
  - Falsification: commenting out the idempotency guard broke exactly and
    only the issue-851-c3 test (2 rows instead of 1); reverted, all green again.
- Decisions made: `create-recipe` was already in `org_risk_classifier.ts`'s
  `HIGH_RISK_KINDS`, and `org_proposal_apply.ts` (the auto-apply lane)
  independently re-derives risk and refuses non-`'low'` kinds before ever
  touching the registered-applier map — so no code change was needed to
  guarantee the gate; issue-851-c2 asserts this pre-existing behavior stays
  true. Idempotency is guarded by case-insensitive/trimmed title match
  (no dedicated "applied" marker column exists on `agent_cookbook`), mirroring
  the dedup-by-key precedent in `agent_org_proposals_repository.createAsync`.
  Revert is NOT wired into `org_proposal_apply.ts`'s generic `revertProposal`
  (that function only has a bespoke branch for `agent_configs` scope changes,
  and this issue's ownership excludes editing that file) — `beforeSnapshotJson`
  instead carries `{ createdCookbookId }` as a self-describing revert record,
  mirroring `webhook_wiring_generator.ts`'s `{ createdEndpointId }` precedent
  from #829.
- Deviations from spec: none — implemented within `recipe_generator.ts` +
  `org_proposal_appliers_wiring.ts` only, per ownership notes. Did not touch
  `org_proposal_apply*.ts`, `org_audit_service.ts`, `migrations.ts`, or
  `mcp_dispatch_guard.ts`.
- Concerns: a live "revert" action for `create-recipe` (calling
  `AgentCookbookRepository.deleteAsync` on `beforeSnapshotJson.createdCookbookId`)
  is not itself wired into any UI/controller path yet — this issue only
  guarantees the snapshot *supports* that revert, per the AC wording. A future
  issue should wire an explicit revert action for gated (non-auto-lane) kinds
  if the review queue needs a "undo an approved create-recipe" button.

### 2026-07-02 — issue-854 (model resolver ignores agent_configs → custom agents stall)

Fixed: `resolveModelForSessionTurn` now reads `agent_configs.model_provider`/
`model_id` (auth-verified) as a new precedence step between the session pin
and the static fallback, so custom agents (e.g. `secretary`) no longer stall
on their first turn. Eval driver now pins each agent's configured model at
session-create time too. Full details, decision rationale, and verification
evidence: `docs/ai/runs/2026-07-02-issue-854-resolver-agentconfig.md` and
`docs/ai/decisions/2026-07-02-resolver-agentconfig-precedence.md`.
