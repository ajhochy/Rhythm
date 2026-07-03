# org-optimizer-05: Auto-apply + measure/revert (low-risk path)

## Goal

Implement the low-risk auto path: take a `'low'`-risk proposal, capture
`before_snapshot_json`, apply the change, measure via a per-kind metric, and
**keep** (status `active`) or **auto-revert** (status `reverted`). Reuse the
skill loop's measurement machinery for skill/recipe kinds.

## Context

Per decision doc §3, an org change has no single body, so v1 uses a per-kind
metric and the same strictly-greater keep rule + fail-closed revert as the skill
loop. Mechanical kinds (`tighten-scope`/`prune-scope`) need no LLM; body kinds
(`refine-skill`/`consolidate-skill`/`refine-recipe`) reuse
`skill_refiner.scoreSkillBody` / `skill_measurement.measureAppliedSkill`.

## Likely files

- NEW `apps/api_server/src/services/org_proposal_apply.ts`
- NEW `apps/api_server/src/services/org_proposal_measure.ts`
- reuse `apps/api_server/src/services/skill_measurement.ts`,
  `apps/api_server/src/services/skill_refiner.ts`
- `apps/api_server/src/repositories/agent_org_proposals_repository.ts`

## Acceptance Criteria

- [ ] `applyProposal(proposal)` first writes `before_snapshot_json` (the exact
  prior value of the field/file it will change), then applies, then sets
  `status='measuring'`.
- [ ] Refuses to apply any proposal whose `classifyProposalRisk` is `'high'`
  (guard — the auto path is low-risk only).
- [ ] `measureProposal(proposal)` computes the per-kind metric:
  - `tighten-scope`/`prune-scope`: keep iff scope-hygiene strictly improves AND
    the functional guard passes (no tool/server that was actually exercised in the
    trailing window was removed). Revert otherwise.
  - `refine-skill`/`consolidate-skill`/`refine-recipe`: keep iff post > baseline
    via the reused LLM scorer (injectable in tests). Revert on tie/error
    (fail-closed).
- [ ] Revert replays `before_snapshot_json`, restores the prior state, and sets
  `status='reverted'`; a reverted proposal is added to the dedup seen-set so it is
  not re-proposed.
- [ ] Never throws into the caller; on unexpected error → `skipped`/no-op (matches
  skill loop discipline).

## Required tests

- prune-scope apply→measure→revert contract (mechanical): a dead-name prune keeps;
  pruning a recently-exercised scope reverts (functional guard).
- refine-skill apply→measure contract (injectable scorer): post>baseline keeps;
  tie reverts; the snapshot is restored on revert.
- high-risk proposal passed to `applyProposal` is refused.

## Dependencies / order

Depends on 01, 03, 04. This + 06 deliver the cheapest end-to-end proof
(prune-scope auto path).

## Safety notes

Auto path is fully reversible by construction (snapshot first). The functional
guard prevents pruning a scope that is actually in use.
