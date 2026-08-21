---
date: 2026-08-20
repo: rhythm
branch: agent-stack/si-d4-auto-promotion-sonnet
pr: null
issues: [1440]
status: complete
tags: [run, rhythm]
---

## Files

- `apps/api_server/src/services/trust_counter_service.ts` (new)
- `apps/api_server/src/services/__tests__/trust_counter_service.test.ts` (new)
- `apps/api_server/src/repositories/promotion_trust_state_repository.ts` (adds `auto_promotion_eligible` to the row/model mapping and `recordEligibilityAsync`, the only write path the counter service uses)
- `apps/api_server/src/repositories/promotion_trust_state_repository.test.ts` (D4.2 cases, carried over from the in-progress worktree state)
- `apps/api_server/src/repositories/agent_org_experiments_repository.ts` (originally added `countByDecisionAsync`, read-only; repair pass replaced it with `getTrustLedgerCountsAsync`, see Repair below)
- `apps/api_server/src/repositories/agent_org_proposals_repository.ts` (originally added `countByOutcomeStatusAsync`, read-only; repair pass removed it as unused, see Repair below)
- `apps/api_server/src/models/promotion_trust_state.ts` (adds `autoPromotionEligible` field, carried over from the in-progress worktree state)
- `apps/api_server/src/database/migrations.ts` (additive — `ALTER TABLE promotion_trust_state ADD COLUMN auto_promotion_eligible INTEGER NOT NULL DEFAULT 0`, guarded by an existing-columns check)
- `apps/api_server/src/database/postgres_bootstrap.ts` (additive parity — `ALTER TABLE promotion_trust_state ADD COLUMN IF NOT EXISTS auto_promotion_eligible BOOLEAN NOT NULL DEFAULT FALSE`)
- `apps/api_server/src/__tests__/promotion_trust_state_schema_parity.test.ts` (expected column list updated to include `auto_promotion_eligible`)
- `docs/ai/contracts/issue-1440.json`

## Checks

- RED: with `trust_counter_service.ts` moved aside, `cd apps/api_server && npx vitest run src/services/__tests__/trust_counter_service.test.ts` failed the whole suite — `Cannot find module '../trust_counter_service'` (module-resolution failure, 0 tests ran).
- GREEN after restoring the module: same command — 4/4 pass.
- Focused: `cd apps/api_server && npx vitest run src/services/__tests__/trust_counter_service.test.ts src/repositories/promotion_trust_state_repository.test.ts src/__tests__/promotion_trust_state_schema_parity.test.ts` — 10/10 pass.
- Adjacent regression: `cd apps/api_server && npx vitest run src/__tests__/migrations_replay_guard.test.ts` — 3/3 pass (additive column does not disturb the existing content-rewrite guard); `cd apps/api_server && npx vitest run src/repositories/__tests__/agent_org_experiments_repository.test.ts src/__tests__/org_proposals_routes.test.ts src/__tests__/c6_api_summary.test.ts` — 44/44 pass (new read-only count methods do not disturb existing repository behavior).
- `cd apps/api_server && npx tsc --noEmit` — pass.
- `cd apps/api_server && npm run build` — pass.
- `git diff --check` — clean.
- Added-line secret/security scan (grep the diff + new files for secret/token/password/api-key/credential/private-key patterns) — no hits.
- GitNexus impact: `gitnexus detect-changes` — the session's indexed-repo list (from the tool's own error output) does not include this worktree's alias (`d4-auto-promotion`); sibling worktrees `d2-post-apply-lifecycle` and `integration` are present but not this one, so the index is stale for this branch. Recorded UNKNOWN per the operating instructions and substituted direct caller inspection: grep for every call site of the two new repository methods and the two edited migration functions confirms the change is additive-only (new methods appended at the end of their classes; `ALTER TABLE ADD COLUMN` guarded by an existing-columns/`IF NOT EXISTS` check, never touching an existing column or row). This matches the LOW-risk additive pattern already established for #1439 and elsewhere in both files.
- Sandbox: not used. No HTTP/WS/MCP entry point calls `recordTrustCountersAsync`/`computeTrustCountersAsync` yet — wiring a caller is out of scope for D4.2. Per AGENTS.md's live-behavioral-test gate, there is no entry point to drive.

## Notes

- `auto_promotion_eligible` is derived as `totalVerified >= trustThreshold && totalRegressions === 0`, reading the singleton's *current* `trustThreshold` rather than hardcoding the D4.1 default of 10 — so a later admin-configured threshold is honored without touching this service.
- `PromotionTrustStateRepository.recordEligibilityAsync` is a narrow, purpose-built write path (`PromotionTrustStateEligibilityUpdate`: `totalVerified`/`totalRegressions`/`autoPromotionEligible` only) rather than routing through the general `updateAsync` — this makes it structurally impossible for the trust counter to pass `autoPromotionEnabled`/`enabledAt`, versus relying on caller discipline not to.
- `computeTrustCountersAsync` is exported separately from `recordTrustCountersAsync` so a future caller (e.g. a dry-run admin view) can read the would-be eligibility without persisting anything.
- Did not implement #1441–#1444; no server was started; no production data was touched; no destructive git operations were run.

## Repair (D4 focused repair pass, 2026-08-20)

**Blocking finding B — corrects an overclaim above.** #1440 requires counting experiments with a verified outcome. The original `computeTrustCountersAsync` counted `agent_org_proposals` rows with `outcome_status='verified'` directly (`countByOutcomeStatusAsync`), which counts every verified PROPOSAL whether or not an experiment was ever declared for it — a verified proposal with no experiment inflated `totalVerified` and could make the gate incorrectly eligible.

- Fix: removed `AgentOrgProposalsRepository.countByOutcomeStatusAsync` (became unused) and `AgentOrgExperimentsRepository.countByDecisionAsync` (superseded). Added `AgentOrgExperimentsRepository.getTrustLedgerCountsAsync()` — a single aggregate query joining `agent_org_experiments` to `agent_org_proposals`, returning `{ totalVerified, totalRegressions }` from one statement snapshot: `totalVerified` counts EXPERIMENT rows whose proposal has `outcome_status='verified'`; `totalRegressions` counts experiment rows with `decision='regress'`. `trust_counter_service.ts` now calls only this one method. `auto_promotion_enabled` remains untouched/false — `recordEligibilityAsync`'s write path did not change.
- Tests added to `trust_counter_service.test.ts`: 'repair (blocking finding B): a verified proposal with no experiment does NOT count' and 'repair (blocking finding B): an experiment whose proposal is verified DOES count'. The pre-existing 10/0=>eligible, 10/1=>false, 9/0=>false cases were kept but their fixture (`createVerifiedProposalAsync`) was replaced with `createVerifiedExperimentAsync`, which declares a real experiment per verified proposal, so those cases now exercise real proposal+experiment pairs.
- RED: 'a verified proposal with no experiment does NOT count' — `expected 1 to be +0` (the bare verified proposal was counted before the fix).
- GREEN: `cd apps/api_server && npx vitest run src/repositories/promotion_trust_state_repository.test.ts src/services/__tests__/trust_counter_service.test.ts src/__tests__/promotion_trust_state_schema_parity.test.ts src/__tests__/migrations_replay_guard.test.ts` — 16/16 pass.
- Adjacent regression: `cd apps/api_server && npx vitest run src/repositories/__tests__/agent_org_experiments_repository.test.ts src/__tests__/org_proposals_routes.test.ts src/__tests__/c6_api_summary.test.ts` — 44/44 pass (removing the two now-unused count methods and adding the aggregate method does not disturb existing behavior).
- `npx tsc --noEmit` — pass. `npm run build` — pass. `git diff --check` — clean. Added-line secret scan — no hits.
- GitNexus: `gitnexus detect-changes --repo d4-auto-promotion` still errors "Repository not found" — this worktree's alias remains unindexed. UNKNOWN, unchanged from the original run.
- Did not implement #1441–#1444; no server was started; no destructive git operations were run.
