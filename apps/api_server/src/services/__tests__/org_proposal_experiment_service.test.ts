/**
 * W6 — the experiment service.
 *
 *  - W6-c4  deterministic, non-constant assignment
 *  - W6-c14 maximum exposure is ENFORCED, not merely recorded
 *  - W6-c5  paired cohorts read from W4's ledger; no cohort, no promotion
 *  - W6-c6  no proxy adapter can promote
 *  - W6-c12 ANTI-VACUITY: promote AND regress are both reachable on the same
 *           code path, asserted from the SAME fixture table as the refusals
 *  - W6-c13 promotion is BOUND to a valid bundle and a predeclared experiment
 */

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import {
  PROPOSAL_EVIDENCE_BUNDLE_VERSION,
  type ProposalEvidenceBundle,
} from '../../models/proposal_evidence_bundle';
import type { AgentRunOutcome } from '../../models/agent_run_outcome';
import { AgentOrgExperimentsRepository } from '../../repositories/agent_org_experiments_repository';
import { AgentRunOutcomesRepository } from '../../repositories/agent_run_outcomes_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import {
  assignCohort,
  assignSubject,
  assignSubjectAsync,
  decideExperiment,
  judgeExperimentAsync,
} from '../org_proposal_experiment_service';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
});

/** An otherwise-complete, current-version bundle. Every case mutates a copy. */
function makeValidBundle(): ProposalEvidenceBundle {
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
  };
}

/** A cohort of `n` ledger outcomes of which `successes` succeeded. */
function cohort(n: number, successes: number, variant: string): AgentRunOutcome[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `out-${variant}-${i}`,
    rootSessionId: `ses-${variant}-${i}`,
    sessionId: null,
    scheduledOccurrenceId: null,
    experimentVariant: variant,
    proposalId: 'prop-1',
    profileId: null,
    configRevision: null,
    terminalStatus: 'completed',
    objectiveVerdict: i < successes ? 'success' : 'failure',
    objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
    attribution: { v: 1, tools: [], skills: [], configRevision: 'unknown' },
    finalizedAt: '2026-08-15T00:00:00.000Z',
    createdAt: '2026-08-15T00:00:00.000Z',
  })) as AgentRunOutcome[];
}

async function declare(
  repo: AgentOrgExperimentsRepository,
  bundle: unknown,
  overrides: Record<string, unknown> = {},
) {
  return repo.declareAsync({
    proposalId: 'prop-1',
    adapter:
      (bundle as ProposalEvidenceBundle)?.experimentAdapter ?? 'paired-cohort-outcome',
    evidenceBundleJson: JSON.stringify(bundle),
    baselineSpecJson: JSON.stringify({ configRevision: 4 }),
    candidateSpecJson: JSON.stringify({ configRevision: 5 }),
    assignmentKey: 'exp-key-1',
    stoppingRule: { minSamplesPerCohort: 10, minEffect: 0.05 },
    maxExposure: 100,
    ...overrides,
  });
}

describe('W6-c4 deterministic assignment key', () => {
  it('is a pure function of recorded inputs — recomputed, not read back', () => {
    for (const subject of ['ses-a', 'ses-b', 'ses-c']) {
      const first = assignCohort('exp-key-1', subject);
      const second = assignCohort('exp-key-1', subject);
      expect(second).toBe(first);
    }
  });

  it('is NOT constant — both cohorts are produced over a fixture set', () => {
    const subjects = Array.from({ length: 200 }, (_, i) => `subject-${i}`);
    const produced = new Set(subjects.map((s) => assignCohort('exp-key-1', s)));
    expect([...produced].sort()).toEqual(['baseline', 'candidate']);
  });

  it('splits the SAME set the same way on a re-run', () => {
    const subjects = Array.from({ length: 50 }, (_, i) => `subject-${i}`);
    const first = subjects.map((s) => assignCohort('exp-key-1', s));
    const second = subjects.map((s) => assignCohort('exp-key-1', s));
    expect(second).toEqual(first);
  });

  it('a different experiment key produces a different split', () => {
    const subjects = Array.from({ length: 100 }, (_, i) => `subject-${i}`);
    const a = subjects.map((s) => assignCohort('exp-key-1', s)).join('');
    const b = subjects.map((s) => assignCohort('exp-key-2', s)).join('');
    expect(b).not.toBe(a);
  });
});

describe('W6-c14 maximum exposure is enforced', () => {
  it('refuses a new subject once the cap is reached', () => {
    const under = assignSubject({
      assignmentKey: 'exp-key-1',
      maxExposure: 3,
      currentExposure: 2,
      subjectId: 'ses-x',
    });
    expect(under.status).toBe('assigned');

    const at = assignSubject({
      assignmentKey: 'exp-key-1',
      maxExposure: 3,
      currentExposure: 3,
      subjectId: 'ses-y',
    });
    expect(at.status).toBe('refused');
    expect(at.status === 'refused' && at.reason).toMatch(/maximum exposure/i);
  });

  it('binds the cap to real ledger exposure, not just to the declared number', async () => {
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, makeValidBundle(), { maxExposure: 2 });
    const outcomes = new AgentRunOutcomesRepository();

    expect((await assignSubjectAsync(exp.id, 'ses-1')).status).toBe('assigned');

    for (const i of [1, 2]) {
      await outcomes.finalizeAsync({
        rootSessionId: `ses-seed-${i}`,
        proposalId: 'prop-1',
        experimentVariant: 'baseline',
        terminalStatus: 'completed',
        objectiveVerdict: 'success',
        objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
      });
    }

    const refused = await assignSubjectAsync(exp.id, 'ses-2');
    expect(refused.status).toBe('refused');
    expect(refused.status === 'refused' && refused.reason).toMatch(/maximum exposure/i);
  });
});

/**
 * W6-c6 + W6-c12 + W6-c2 + W6-c5 — ONE fixture table.
 *
 * Every proxy case carries an OTHERWISE-COMPLETE, valid, current-version
 * bundle and a predeclared experiment with both cohorts populated, so its
 * refusal is attributable to the proxy and not to bundle invalidity or a
 * missing cohort. The two positive controls sit in the same table, so no
 * constant-returning decision function can pass this suite.
 */
const PROXY_ADAPTERS = [
  'single-replay',
  'usage-count',
  'allowlist-shrink',
  'output-length',
  'regex-disappearance',
  'llm-body-score',
] as const;

interface Case {
  name: string;
  bundle: unknown;
  baseline: AgentRunOutcome[];
  candidate: AgentRunOutcome[];
  expected: 'promote' | 'inconclusive' | 'regress';
  reasonMatches: RegExp;
}

const CASES: Case[] = [
  // ── W6-c12 POSITIVE CONTROLS ───────────────────────────────────────────
  {
    name: 'c12 promote: candidate beats baseline on the predeclared metric',
    bundle: makeValidBundle(),
    baseline: cohort(20, 10, 'baseline'),
    candidate: cohort(20, 18, 'candidate'),
    expected: 'promote',
    reasonMatches: /objective-success-rate/,
  },
  {
    name: 'c12 regress: candidate is worse than baseline past the stopping rule',
    bundle: makeValidBundle(),
    baseline: cohort(20, 18, 'baseline'),
    candidate: cohort(20, 10, 'candidate'),
    expected: 'regress',
    reasonMatches: /objective-success-rate/,
  },
  // ── W6-c6 PROXY REFUSALS ───────────────────────────────────────────────
  ...PROXY_ADAPTERS.map((adapter) => ({
    name: `c6 ${adapter} cannot promote even with complete evidence and both cohorts`,
    bundle: { ...makeValidBundle(), experimentAdapter: adapter },
    baseline: cohort(20, 10, 'baseline'),
    candidate: cohort(20, 20, 'candidate'),
    expected: 'inconclusive' as const,
    reasonMatches: new RegExp(adapter),
  })),
  // ── W6-c2 / W6-c13 EVIDENCE BINDING ────────────────────────────────────
  {
    name: 'c13 an invalid bundle cannot promote however good the numbers look',
    bundle: (() => {
      const b = makeValidBundle() as unknown as Record<string, unknown>;
      delete b.target;
      return b;
    })(),
    baseline: cohort(20, 10, 'baseline'),
    candidate: cohort(20, 20, 'candidate'),
    expected: 'inconclusive',
    reasonMatches: /target/,
  },
  {
    name: 'c13 an absent bundle cannot promote',
    bundle: null,
    baseline: cohort(20, 10, 'baseline'),
    candidate: cohort(20, 20, 'candidate'),
    expected: 'inconclusive',
    reasonMatches: /evidence bundle/i,
  },
  // ── W6-c5 COHORT PAIRING ───────────────────────────────────────────────
  {
    name: 'c5 an empty candidate cohort is inconclusive, never regress',
    bundle: makeValidBundle(),
    baseline: cohort(20, 10, 'baseline'),
    candidate: [],
    expected: 'inconclusive',
    reasonMatches: /candidate cohort is empty/i,
  },
  {
    name: 'c5 an empty baseline cohort is inconclusive, never promote',
    bundle: makeValidBundle(),
    baseline: [],
    candidate: cohort(20, 20, 'candidate'),
    expected: 'inconclusive',
    reasonMatches: /baseline cohort is empty/i,
  },
  {
    name: 'below the predeclared stopping rule is inconclusive in both directions',
    bundle: makeValidBundle(),
    baseline: cohort(3, 0, 'baseline'),
    candidate: cohort(3, 3, 'candidate'),
    expected: 'inconclusive',
    reasonMatches: /stopping rule/i,
  },
  {
    name: 'a move smaller than the predeclared minimum effect is inconclusive',
    bundle: makeValidBundle(),
    baseline: cohort(100, 50, 'baseline'),
    candidate: cohort(100, 52, 'candidate'),
    expected: 'inconclusive',
    reasonMatches: /minimum effect|minEffect/i,
  },
];

describe('W6-c6 / W6-c12 / W6-c13 — one decision table, refusals and positive controls together', () => {
  it.each(CASES)('$name', async ({ bundle, baseline, candidate, expected, reasonMatches }) => {
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, bundle);
    const result = decideExperiment({ experiment: exp, baseline, candidate });
    expect(result.decision).toBe(expected);
    expect(result.reason).toMatch(reasonMatches);
  });

  it('the table really does contain BOTH positive controls (anti-vacuity)', () => {
    const decisions = new Set(CASES.map((c) => c.expected));
    expect(decisions.has('promote')).toBe(true);
    expect(decisions.has('regress')).toBe(true);
  });
});

describe('W6-c12 promote and regress are reachable END TO END, through the ledger', () => {
  async function seedLedger(baselineSuccesses: number, candidateSuccesses: number) {
    const outcomes = new AgentRunOutcomesRepository();
    for (let i = 0; i < 20; i += 1) {
      await outcomes.finalizeAsync({
        rootSessionId: `ses-b-${i}`,
        proposalId: 'prop-1',
        experimentVariant: 'baseline',
        terminalStatus: 'completed',
        objectiveVerdict: i < baselineSuccesses ? 'success' : 'failure',
        objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
      });
      await outcomes.finalizeAsync({
        rootSessionId: `ses-c-${i}`,
        proposalId: 'prop-1',
        experimentVariant: 'candidate',
        terminalStatus: 'completed',
        objectiveVerdict: i < candidateSuccesses ? 'success' : 'failure',
        objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
      });
    }
  }

  async function seedProposal(): Promise<string> {
    const repo = new AgentOrgProposalsRepository();
    const created = await repo.createAsync({
      id: 'prop-1',
      kind: 'refine-skill',
      risk: 'low',
      title: 'a candidate worth measuring',
    });
    return created.id;
  }

  it('promotes, records the decision on the experiment, and marks the proposal verified', async () => {
    await seedProposal();
    await seedLedger(10, 18);
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, makeValidBundle());

    const judged = await judgeExperimentAsync(exp.id);
    expect(judged.decision).toBe('promote');

    const stored = await experiments.findByIdAsync(exp.id);
    expect(stored!.decision).toBe('promote');
    expect(stored!.results!.baseline.sampleCount).toBe(20);
    expect(stored!.results!.candidate.sampleCount).toBe(20);

    const proposal = await new AgentOrgProposalsRepository().findByIdAsync('prop-1');
    expect(proposal!.outcomeStatus).toBe('verified');
  });

  it('regresses on the mirror fixture and marks the proposal regressed', async () => {
    await seedProposal();
    await seedLedger(18, 10);
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, makeValidBundle());

    const judged = await judgeExperimentAsync(exp.id);
    expect(judged.decision).toBe('regress');

    const proposal = await new AgentOrgProposalsRepository().findByIdAsync('prop-1');
    expect(proposal!.outcomeStatus).toBe('regressed');
  });

  it('a proxy adapter leaves the proposal unproven, never verified', async () => {
    await seedProposal();
    await seedLedger(10, 20);
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, {
      ...makeValidBundle(),
      experimentAdapter: 'llm-body-score',
    });

    const judged = await judgeExperimentAsync(exp.id);
    expect(judged.decision).toBe('inconclusive');

    const proposal = await new AgentOrgProposalsRepository().findByIdAsync('prop-1');
    expect(proposal!.outcomeStatus).toBe('inconclusive');
  });
});

describe('W6-c5 pairing reads W4 ledger cohorts and adds no update path', () => {
  it('reads both cohorts for one proposal from the ledger', async () => {
    const outcomes = new AgentRunOutcomesRepository();
    await outcomes.finalizeAsync({
      rootSessionId: 'ses-b-1',
      proposalId: 'prop-1',
      experimentVariant: 'baseline',
      terminalStatus: 'completed',
      objectiveVerdict: 'success',
      objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
    });
    await outcomes.finalizeAsync({
      rootSessionId: 'ses-c-1',
      proposalId: 'prop-1',
      experimentVariant: 'candidate',
      terminalStatus: 'completed',
      objectiveVerdict: 'failure',
      objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
    });
    // A row for a DIFFERENT proposal must not leak into the cohort.
    await outcomes.finalizeAsync({
      rootSessionId: 'ses-other',
      proposalId: 'prop-2',
      experimentVariant: 'candidate',
      terminalStatus: 'completed',
      objectiveVerdict: 'success',
      objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
    });

    const rows = await outcomes.listByExperimentAsync('prop-1');
    expect(rows.map((r) => r.experimentVariant).sort()).toEqual(['baseline', 'candidate']);
  });

  it('cannot retro-label a finalized outcome — the ledger is UPDATE-blocked', async () => {
    const outcomes = new AgentRunOutcomesRepository();
    await outcomes.finalizeAsync({
      rootSessionId: 'ses-late',
      terminalStatus: 'completed',
      objectiveVerdict: 'success',
      objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
    });
    expect(() =>
      db
        .prepare(`UPDATE agent_run_outcomes SET experiment_variant = 'candidate' WHERE root_session_id = ?`)
        .run('ses-late'),
    ).toThrow(/immutable/i);
  });
});
