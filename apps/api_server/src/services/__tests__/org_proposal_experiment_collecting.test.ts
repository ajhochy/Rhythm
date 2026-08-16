/**
 * C0 — truthful verdict hotfix.
 *
 * W6's `decideExperiment` treated an empty or undersized cohort as a TERMINAL
 * `inconclusive`: results and a decision were written to the experiment row
 * (and `outcome_status` to the proposal) the very first time an experiment was
 * judged with too little data — permanently, since a decided experiment is
 * never re-judged. A just-declared experiment with zero outcomes was
 * therefore closed out as `inconclusive` on the FIRST optimizer sweep, and
 * more data arriving later could never reopen it.
 *
 * These tests prove the fix through the repository/optimizer wiring, not only
 * a pure function: a nonterminal `collecting` result that writes nothing, and
 * a real terminal `inconclusive` only once `maxExposure` is reached without
 * enough valid observations.
 */

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import {
  PROPOSAL_EVIDENCE_BUNDLE_VERSION,
  type ProposalEvidenceBundle,
} from '../../models/proposal_evidence_bundle';
import { AgentOrgExperimentsRepository } from '../../repositories/agent_org_experiments_repository';
import { AgentRunOutcomesRepository } from '../../repositories/agent_run_outcomes_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { judgeExperimentAsync } from '../org_proposal_experiment_service';

// The optimizer run loop builds an audit snapshot from the engine — same
// mock shape as experiment_cohort_wiring_contract.test.ts.
const listMcp = vi.fn();
const listSkills = vi.fn();

vi.mock('../opencode_engine', () => ({
  get opencodeClient() {
    return {
      get isReady() {
        return true;
      },
      listMcp: (...a: unknown[]) => listMcp(...a),
      listSkills: (...a: unknown[]) => listSkills(...a),
    };
  },
  opencodeSessionMap: new Map(),
}));

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function makeValidBundle(overrides: Partial<ProposalEvidenceBundle> = {}): ProposalEvidenceBundle {
  return {
    version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
    sourceEvidence: { sessionIds: ['ses-1'], eventIds: ['evt-1'] },
    counterEvidenceSearch: {
      query: 'runs that contradict the hypothesis',
      searchedAt: '2026-08-15T00:00:00.000Z',
      contradictingCount: 0,
    },
    target: { ref: 'agent_configs:cfg-1', hash: 'sha256:abc123' },
    expectedOutcome: 'more successful runs on the research profile',
    primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
    guardrails: ['terminal-error-rate must not rise'],
    experimentAdapter: 'paired-cohort-outcome',
    rollbackRule: 'restore before_snapshot_json and set status=reverted',
    generatorVersion: 'scope-hygiene-generator@3',
    confidenceCalibrationVersion: 'calibration@2026-08-01',
    ...overrides,
  };
}

async function seedProposal(id = 'prop-1'): Promise<string> {
  const created = await new AgentOrgProposalsRepository().createAsync({
    id,
    kind: 'refine-skill',
    risk: 'low',
    title: 'a candidate worth measuring',
  });
  return created.id;
}

async function declare(overrides: Record<string, unknown> = {}) {
  const experiments = new AgentOrgExperimentsRepository();
  return experiments.declareAsync({
    proposalId: 'prop-1',
    adapter: 'paired-cohort-outcome',
    evidenceBundleJson: JSON.stringify(makeValidBundle()),
    baselineSpecJson: JSON.stringify({ configRevision: 4 }),
    candidateSpecJson: JSON.stringify({ configRevision: 5 }),
    assignmentKey: 'exp-key-collecting',
    stoppingRule: { minSamplesPerCohort: 3, minEffect: 0.2 },
    maxExposure: 100,
    ...overrides,
  });
}

async function seedOutcome(variant: 'baseline' | 'candidate', id: string, success: boolean): Promise<void> {
  await new AgentRunOutcomesRepository().finalizeAsync({
    rootSessionId: id,
    proposalId: 'prop-1',
    experimentVariant: variant,
    terminalStatus: 'completed',
    objectiveVerdict: success ? 'success' : 'failure',
    objectiveEvidence: { producedArtifact: success, errorCount: success ? 0 : 1, approvalDenied: false },
  });
}

beforeEach(() => {
  setDb(makeDb());
  listMcp.mockReset().mockResolvedValue({});
  listSkills.mockReset().mockResolvedValue([]);
  delete process.env.RHYTHM_OPTIMIZER_MODE;
});

describe('C0 — a just-declared experiment with zero outcomes stays collecting', () => {
  it('remains decision=null/results=null and leaves the proposal unproven after an acting optimizer sweep', async () => {
    await seedProposal();
    const exp = await declare();

    const { runOrgOptimizer } = await import('../org_optimizer_run_service');
    await runOrgOptimizer({ mode: 'auto' });

    const stored = await new AgentOrgExperimentsRepository().findByIdAsync(exp.id);
    expect(stored!.decision).toBeNull();
    expect(stored!.results).toBeNull();

    const proposal = await new AgentOrgProposalsRepository().findByIdAsync('prop-1');
    expect(proposal!.outcomeStatus).toBe('unproven');
  });
});

describe('C0 — an undersized sweep never prematurely closes an experiment', () => {
  it('a later sweep decides once enough valid outcomes arrive', async () => {
    await seedProposal();
    const exp = await declare();

    // Sweep #1 — one outcome per cohort, well below minSamplesPerCohort (3).
    await seedOutcome('baseline', 'ses-b-0', false);
    await seedOutcome('candidate', 'ses-c-0', true);

    const { runOrgOptimizer } = await import('../org_optimizer_run_service');
    await runOrgOptimizer({ mode: 'auto' });

    const afterFirstSweep = await new AgentOrgExperimentsRepository().findByIdAsync(exp.id);
    expect(afterFirstSweep!.decision).toBeNull();

    // Enough valid observations now exist for a real decision.
    await seedOutcome('baseline', 'ses-b-1', false);
    await seedOutcome('baseline', 'ses-b-2', false);
    await seedOutcome('candidate', 'ses-c-1', true);
    await seedOutcome('candidate', 'ses-c-2', true);

    await runOrgOptimizer({ mode: 'auto' });

    const afterSecondSweep = await new AgentOrgExperimentsRepository().findByIdAsync(exp.id);
    expect(afterSecondSweep!.decision).not.toBeNull();
  });
});

describe('C0 — maxExposure exhausted below minSamplesPerCohort is a terminal inconclusive', () => {
  it('records the final counts and an explicit max-exposure reason', async () => {
    await seedProposal();
    const exp = await declare({
      stoppingRule: { minSamplesPerCohort: 10, minEffect: 0.05 },
      maxExposure: 4,
    });

    await seedOutcome('baseline', 'ses-b-0', false);
    await seedOutcome('baseline', 'ses-b-1', false);
    await seedOutcome('candidate', 'ses-c-0', true);
    await seedOutcome('candidate', 'ses-c-1', true);

    const judged = await judgeExperimentAsync(exp.id);
    if (judged.status !== 'decided') throw new Error('expected a terminal decision');

    expect(judged.status).toBe('decided');
    expect(judged.decision).toBe('inconclusive');
    expect(judged.reason).toMatch(/max(imum)? exposure/i);
    expect(judged.results!.baseline.sampleCount).toBe(2);
    expect(judged.results!.candidate.sampleCount).toBe(2);

    const stored = await new AgentOrgExperimentsRepository().findByIdAsync(exp.id);
    expect(stored!.decision).toBe('inconclusive');
    expect(stored!.results!.baseline.sampleCount).toBe(2);
  });
});
