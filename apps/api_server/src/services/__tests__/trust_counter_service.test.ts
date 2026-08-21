/**
 * D4.2 (#1440) — trust counter service tests.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentOrgExperimentsRepository } from '../../repositories/agent_org_experiments_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { PromotionTrustStateRepository } from '../../repositories/promotion_trust_state_repository';
import { computeTrustCountersAsync, recordTrustCountersAsync } from '../trust_counter_service';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

function declareInput(proposalId: string, overrides: Record<string, unknown> = {}) {
  return {
    proposalId,
    adapter: 'system-prompt-v1',
    evidenceBundleJson: JSON.stringify({ experimentAdapter: 'system-prompt-v1' }),
    baselineSpecJson: JSON.stringify({ configRevision: 1 }),
    candidateSpecJson: JSON.stringify({ configRevision: 2 }),
    assignmentKey: `exp-key-${crypto.randomUUID()}`,
    stoppingRule: { minSamplesPerCohort: 5, minEffect: 0.05 },
    maxExposure: 20,
    ...overrides,
  };
}

async function createVerifiedProposalAsync(): Promise<void> {
  const proposalsRepo = new AgentOrgProposalsRepository();
  const proposal = await proposalsRepo.createAsync({
    kind: 'refine-config',
    risk: 'low',
    title: 'trust counter fixture',
  });
  await proposalsRepo.setOutcomeStatusAtRevisionAsync({
    proposalId: proposal.id,
    expectedRevision: proposal.revision,
    outcomeStatus: 'verified',
  });
}

async function createRegressedExperimentAsync(): Promise<void> {
  const proposalsRepo = new AgentOrgProposalsRepository();
  const experimentsRepo = new AgentOrgExperimentsRepository();
  const proposal = await proposalsRepo.createAsync({
    kind: 'refine-config',
    risk: 'low',
    title: 'trust counter regression fixture',
  });
  const experiment = await experimentsRepo.declareAsync(declareInput(proposal.id));
  await experimentsRepo.recordDecisionAsync(experiment.id, 'regress', 'guardrail breach');
}

describe('trust_counter_service — D4.2 (#1440)', () => {
  it('10 verified, 0 regressions => eligible', async () => {
    for (let i = 0; i < 10; i++) await createVerifiedProposalAsync();

    const counters = await computeTrustCountersAsync();
    expect(counters.totalVerified).toBe(10);
    expect(counters.totalRegressions).toBe(0);
    expect(counters.autoPromotionEligible).toBe(true);
  });

  it('10 verified, 1 regression => not eligible', async () => {
    for (let i = 0; i < 10; i++) await createVerifiedProposalAsync();
    await createRegressedExperimentAsync();

    const counters = await computeTrustCountersAsync();
    expect(counters.totalVerified).toBe(10);
    expect(counters.totalRegressions).toBe(1);
    expect(counters.autoPromotionEligible).toBe(false);
  });

  it('9 verified, 0 regressions => not eligible', async () => {
    for (let i = 0; i < 9; i++) await createVerifiedProposalAsync();

    const counters = await computeTrustCountersAsync();
    expect(counters.totalVerified).toBe(9);
    expect(counters.totalRegressions).toBe(0);
    expect(counters.autoPromotionEligible).toBe(false);
  });

  it('recordTrustCountersAsync persists counts/eligibility on the singleton but never enables auto-promotion', async () => {
    for (let i = 0; i < 10; i++) await createVerifiedProposalAsync();

    const state = await recordTrustCountersAsync();
    expect(state.totalVerified).toBe(10);
    expect(state.totalRegressions).toBe(0);
    expect(state.autoPromotionEligible).toBe(true);
    expect(state.autoPromotionEnabled).toBe(false);
    expect(state.enabledAt).toBeNull();

    const persisted = await new PromotionTrustStateRepository().getSingletonAsync();
    expect(persisted.autoPromotionEligible).toBe(true);
    expect(persisted.autoPromotionEnabled).toBe(false);
  });
});
