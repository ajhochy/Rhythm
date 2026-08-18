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

import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { logger } from '../../utils/logger';
import {
  PROPOSAL_EVIDENCE_BUNDLE_VERSION,
  type ProposalEvidenceBundle,
} from '../../models/proposal_evidence_bundle';
import type { AgentRunOutcome } from '../../models/agent_run_outcome';
import { AgentOrgExperimentsRepository } from '../../repositories/agent_org_experiments_repository';
import { AgentOrgExperimentEnrollmentsRepository } from '../../repositories/agent_org_experiment_enrollments_repository';
import { AgentRunOutcomesRepository } from '../../repositories/agent_run_outcomes_repository';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import {
  assignCohort,
  assignSubject,
  assignSubjectAsync,
  decideExperiment,
  judgeExperimentAsync,
  prepareReservedTreatment,
  reserveRunEnrollment,
  RunEnrollmentProfileCollisionError,
  writeOutcomeStatus,
} from '../org_proposal_experiment_service';
import type { ExperimentEnrollment } from '../../models/agent_org_experiment_enrollment';

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

function toProfileTargetRef(profileId: string): string {
  return `agent_config:${profileId}`;
}

function canonicalizeForHash(input: unknown): string {
  if (Array.isArray(input)) {
    return `[${input.map((item) => canonicalizeForHash(item)).join(',')}]`;
  }
  if (input && typeof input === 'object') {
    const entries = Object.keys(input as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeForHash((input as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(input);
}

function durableTargetFingerprint(profile: {
  id: string;
  revision: number;
  systemPrompt: string | null;
}): string {
  return `sha256:${createHash('sha256')
    .update(
      canonicalizeForHash({
        id: profile.id,
        revision: profile.revision,
        systemPrompt: profile.systemPrompt ?? '__system-prompt-null__',
      }),
    )
    .digest('hex')}`;
}

function ensureProfile(profileId: string, systemPrompt: string | null = 'before') {
  const repo = new AgentConfigsRepository();
  const existing = repo.getById(profileId);
  if (!existing) {
    return repo.insert({ id: profileId, label: profileId, icon: 'x', systemPrompt });
  }
  if (existing.systemPrompt !== systemPrompt) {
    const updated = repo.update(profileId, { systemPrompt });
    if (!updated) return existing;
    return updated;
  }
  return existing;
}

function profileTargetFingerprint(profileId: string, systemPrompt: string | null = 'before') {
  const config = ensureProfile(profileId, systemPrompt);
  return { config, hash: durableTargetFingerprint(config) };
}

function bundleForProfile(
  profileId: string,
  revision = 'sha256:abc123',
): ProposalEvidenceBundle {
  return {
    ...makeValidBundle(),
    target: { ref: toProfileTargetRef(profileId), hash: revision },
  };
}

function systemPromptSpec(
  profileId: string,
  overrides: Record<string, unknown> = {},
  evidenceHash = 'sha256:abc123',
): Record<string, unknown> {
  return {
    agentConfigId: profileId,
    field: 'system_prompt',
    priorValue: 'before',
    currentValue: 'before',
    candidateValue: 'after',
    evidenceTarget: { ref: toProfileTargetRef(profileId), hash: evidenceHash },
    ...overrides,
  };
}

async function declareC1Experiment(
  profileId: string,
  options: {
    proposalId?: string;
    adapter?: string;
    bundle?: ProposalEvidenceBundle;
    baselineSpec?: Record<string, unknown>;
    candidateSpec?: Record<string, unknown>;
  } = {},
) {
  const {
    proposalId,
    adapter = 'paired-cohort-outcome',
    bundle = bundleForProfile(profileId),
    baselineSpec = systemPromptSpec(profileId),
    candidateSpec = systemPromptSpec(profileId, { candidateValue: 'after-candidate' }),
  } = options;

  const experiments = new AgentOrgExperimentsRepository();
  return experiments.declareAsync({
    proposalId: proposalId ?? `prop-${bundle.target.ref}-${Math.random()}`,
    adapter,
    evidenceBundleJson: JSON.stringify(bundle),
    baselineSpecJson: JSON.stringify(baselineSpec),
    candidateSpecJson: JSON.stringify(candidateSpec),
    assignmentKey: `exp-${bundle.target.ref}-${Math.random()}`,
    stoppingRule: { minSamplesPerCohort: 10, minEffect: 0.05 },
    maxExposure: 100,
  });
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

/** A cohort of `n` ledger outcomes of which `errors` ended in a terminal error. */
function errorCohort(n: number, errors: number, variant: string): AgentRunOutcome[] {
  return cohort(n, n, variant).map((o, i) => ({
    ...o,
    terminalStatus: i < errors ? 'error' : 'completed',
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

describe('C1-B strict enrollment gating and hashing', () => {
  it('returns null when the experiment target does not match the run profile', async () => {
    profileTargetFingerprint('target-profile');
    const { hash } = profileTargetFingerprint('other-profile');
    await declareC1Experiment('other-profile', { bundle: bundleForProfile('other-profile', hash) });

    const result = await reserveRunEnrollment('run-profile-mismatch', 'target-profile');
    expect(result).toBeNull();
    expect(await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync('run-profile-mismatch')).toBeNull();
  });

  it('returns null when the run profile does not exist', async () => {
    const { hash } = profileTargetFingerprint('real-profile');
    await declareC1Experiment('real-profile', { bundle: bundleForProfile('real-profile', hash) });

    const result = await reserveRunEnrollment('run-missing-profile', 'target-profile-does-not-exist');
    expect(result).toBeNull();
    expect(await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync('run-missing-profile')).toBeNull();
  });

  it('returns null when the experiment adapter is unsupported', async () => {
    const { hash } = profileTargetFingerprint('profile-1');
    const unsupportedBundle = bundleForProfile('profile-1', hash);
    unsupportedBundle.experimentAdapter = 'single-replay';
    await declareC1Experiment('profile-1', {
      adapter: 'single-replay',
      bundle: unsupportedBundle,
      baselineSpec: systemPromptSpec('profile-1', { candidateValue: 'baseline-candidate' }, hash),
      candidateSpec: systemPromptSpec('profile-1', { candidateValue: 'candidate-only' }, hash),
    });

    const result = await reserveRunEnrollment('run-unsupported-adapter', 'profile-1');
    expect(result).toBeNull();
  });

  it('returns null when either treatment spec is invalid', async () => {
    const { hash } = profileTargetFingerprint('profile-2');
    await declareC1Experiment('profile-2', {
      bundle: bundleForProfile('profile-2', hash),
      candidateSpec: systemPromptSpec('profile-2', { extraKey: 'not-allowed' }, hash),
    });

    const result = await reserveRunEnrollment('run-invalid-spec', 'profile-2');
    expect(result).toBeNull();
  });

  it('enrolls only the exact eligible profile experiment', async () => {
    const unrelatedProfile = profileTargetFingerprint('other-profile');
    const targetProfile = profileTargetFingerprint('target-profile');
    const unrelated = await declareC1Experiment('other-profile', {
      proposalId: 'prop-other-profile',
      bundle: bundleForProfile('other-profile', unrelatedProfile.hash),
      baselineSpec: systemPromptSpec('other-profile', {}, unrelatedProfile.hash),
      candidateSpec: systemPromptSpec('other-profile', { candidateValue: 'other' }, unrelatedProfile.hash),
    });
    const target = await declareC1Experiment('target-profile', {
      proposalId: 'prop-target-profile',
      bundle: bundleForProfile('target-profile', targetProfile.hash),
      baselineSpec: systemPromptSpec('target-profile', {}, targetProfile.hash),
      candidateSpec: systemPromptSpec('target-profile', { candidateValue: 'target' }, targetProfile.hash),
    });

    const reserved = await reserveRunEnrollment('run-eligible', 'target-profile');
    expect(reserved).not.toBeNull();
    expect(reserved!.proposalId).not.toBe(unrelated.proposalId);
    expect(reserved!.proposalId).toBe('prop-target-profile');
  });

  it('requires the durable target fingerprint and rejects stale or forged hashes', async () => {
    const { hash } = profileTargetFingerprint('profile-hash');
    await declareC1Experiment('profile-hash', {
      proposalId: 'prop-hash-stale',
      bundle: bundleForProfile('profile-hash', 'sha256:000000000000000000000000000000000000000000000000000000000000000000'),
      baselineSpec: systemPromptSpec('profile-hash', {}, 'sha256:000000000000000000000000000000000000000000000000000000000000000000'),
      candidateSpec: systemPromptSpec('profile-hash', { candidateValue: 'stale' }, 'sha256:000000000000000000000000000000000000000000000000000000000000000000'),
    });

    const staleResult = await reserveRunEnrollment('run-hash-stale', 'profile-hash');
    expect(staleResult).toBeNull();

    await declareC1Experiment('profile-hash', {
      proposalId: 'prop-hash-0',
      bundle: bundleForProfile('profile-hash', hash),
      baselineSpec: systemPromptSpec('profile-hash', {}, hash),
      candidateSpec: systemPromptSpec('profile-hash', { candidateValue: 'first' }, hash),
    });

    const reserved = await reserveRunEnrollment('run-hash-valid', 'profile-hash');
    expect(reserved).not.toBeNull();
    expect(reserved!.baselineTargetRevisionHash).toBe(hash);
  });

  it('requires canonical `agent_config:` target refs and rejects unsupported aliases', async () => {
    const { hash } = profileTargetFingerprint('profile-alias');

    await declareC1Experiment('profile-alias', {
      proposalId: 'prop-alias',
      bundle: {
        ...bundleForProfile('profile-alias', hash),
        target: { ref: 'agent_configs/profile-alias', hash },
      },
      baselineSpec: { ...systemPromptSpec('profile-alias', {}, hash), evidenceTarget: { ref: 'agent_configs/profile-alias', hash } },
      candidateSpec: { ...systemPromptSpec('profile-alias', { candidateValue: 'alias' }, hash), evidenceTarget: { ref: 'agent_configs/profile-alias', hash } },
    });

    expect(await reserveRunEnrollment('run-alias-rejected', 'profile-alias')).toBeNull();
  });

  it('persists only durable hash artifacts and never raw system prompts', async () => {
    const { hash } = profileTargetFingerprint('profile-no-raw', 'the profile system prompt bytes must stay private');

    await declareC1Experiment('profile-no-raw', {
      proposalId: 'prop-no-raw',
      bundle: bundleForProfile('profile-no-raw', hash),
      baselineSpec: {
        ...systemPromptSpec('profile-no-raw', {}, hash),
        priorValue: 'before',
      },
      candidateSpec: {
        ...systemPromptSpec('profile-no-raw', { candidateValue: 'private-after' }, hash),
        priorValue: 'before',
      },
    });

    const reserved = await reserveRunEnrollment('run-no-raw', 'profile-no-raw');
    expect(reserved).not.toBeNull();
    expect(reserved!.baselineTargetRevisionHash).toBe(hash);
    expect(reserved!.baselineTargetRevisionHash).not.toContain('the profile system prompt bytes must stay private');
    expect(reserved!.baselineTargetRevisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(reserved!.treatmentSpecHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('derives deterministic hashes and updates when durable source inputs change', async () => {
    const { hash: initialHash } = profileTargetFingerprint('profile-hash', 'baseline');
    await declareC1Experiment('profile-hash', {
      proposalId: 'prop-hash-1',
      bundle: bundleForProfile('profile-hash', initialHash),
      baselineSpec: systemPromptSpec('profile-hash', {}, initialHash),
      candidateSpec: systemPromptSpec('profile-hash', { candidateValue: 'first' }, initialHash),
    });

    const first = await reserveRunEnrollment('run-hash-1', 'profile-hash');
    expect(first).not.toBeNull();
    expect(first!.baselineTargetRevisionHash).toBe(initialHash);
    expect(first!.baselineTargetRevisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(first!.treatmentSpecHash).toMatch(/^[a-f0-9]{64}$/);

    const firstRepeat = await reserveRunEnrollment('run-hash-2', 'profile-hash');
    expect(firstRepeat).not.toBeNull();
    expect(firstRepeat!.baselineTargetRevisionHash).toBe(first!.baselineTargetRevisionHash);
    expect(firstRepeat!.treatmentSpecHash).toBe(first!.treatmentSpecHash);

    const older = await new AgentOrgExperimentsRepository().listUndecidedAsync();
    await new AgentOrgExperimentsRepository().recordDecisionAsync(
      older[0]!.id,
      'inconclusive',
      'deprecated test decision',
    );

    const { hash: updatedHash } = profileTargetFingerprint('profile-hash', 'baseline-updated');
    await declareC1Experiment('profile-hash', {
      proposalId: 'prop-hash-2',
      bundle: bundleForProfile('profile-hash', updatedHash),
      baselineSpec: systemPromptSpec('profile-hash', {}, updatedHash),
      candidateSpec: systemPromptSpec('profile-hash', { candidateValue: 'second' }, updatedHash),
    });

    const second = await reserveRunEnrollment('run-hash-3', 'profile-hash');
    expect(second).not.toBeNull();
    expect(second!.baselineTargetRevisionHash).toBe(updatedHash);
    expect(second!.baselineTargetRevisionHash).not.toBe(initialHash);
    expect(second!.treatmentSpecHash).not.toBe(first!.treatmentSpecHash);
    expect(second!.baselineTargetRevisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second!.treatmentSpecHash).toMatch(/^[a-f0-9]{64}$/);
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
  expected: 'promote' | 'inconclusive' | 'regress' | 'collecting';
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
  {
    // P1-3 — `direction` must actually execute. With `decrease`, a FALLING
    // metric is the improvement. If the direction ternary were dropped or
    // inverted, this candidate's lower error rate would read as a regression.
    name: 'c12 promote on a decrease-direction metric: the candidate errors less',
    bundle: {
      ...makeValidBundle(),
      primaryMetric: { name: 'terminal-error-rate', direction: 'decrease' },
    },
    baseline: errorCohort(20, 10, 'baseline'),
    candidate: errorCohort(20, 2, 'candidate'),
    expected: 'promote',
    reasonMatches: /terminal-error-rate/,
  },
  {
    name: 'c12 regress on a decrease-direction metric: the candidate errors MORE',
    bundle: {
      ...makeValidBundle(),
      primaryMetric: { name: 'terminal-error-rate', direction: 'decrease' },
    },
    baseline: errorCohort(20, 2, 'baseline'),
    candidate: errorCohort(20, 10, 'candidate'),
    expected: 'regress',
    reasonMatches: /terminal-error-rate/,
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
  // ── C0 — undersized cohorts are COLLECTING, not terminal, while eligible
  // exposure is below maxExposure (the declare() helper defaults to 100) ──
  {
    name: 'c5 an empty candidate cohort is collecting, never regress',
    bundle: makeValidBundle(),
    baseline: cohort(20, 10, 'baseline'),
    candidate: [],
    expected: 'collecting',
    reasonMatches: /candidate cohort is empty/i,
  },
  {
    name: 'c5 an empty baseline cohort is collecting, never promote',
    bundle: makeValidBundle(),
    baseline: [],
    candidate: cohort(20, 20, 'candidate'),
    expected: 'collecting',
    reasonMatches: /baseline cohort is empty/i,
  },
  {
    name: 'below the predeclared stopping rule is collecting in both directions',
    bundle: makeValidBundle(),
    baseline: cohort(3, 0, 'baseline'),
    candidate: cohort(3, 3, 'candidate'),
    expected: 'collecting',
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
    if (expected === 'collecting') {
      expect(result.status).toBe('collecting');
    } else {
      expect(result.status).toBe('decided');
      expect(result.status === 'decided' && result.decision).toBe(expected);
    }
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

  it(
    'C0 — a paired-cohort-outcome effect records results but is fail-closed gated to inconclusive, never verified',
    async () => {
      await seedProposal();
      await seedLedger(10, 18);
      const experiments = new AgentOrgExperimentsRepository();
      const exp = await declare(experiments, makeValidBundle());

      const judged = await judgeExperimentAsync(exp.id);
      if (judged.status !== 'decided') throw new Error('expected a terminal decision');
      expect(judged.status).toBe('decided');
      expect(judged.decision).toBe('inconclusive');
      expect(judged.reason).toMatch(/treatment-v2/i);

      const stored = await experiments.findByIdAsync(exp.id);
      expect(stored!.decision).toBe('inconclusive');
      expect(stored!.results!.baseline.sampleCount).toBe(20);
      expect(stored!.results!.candidate.sampleCount).toBe(20);

      const proposal = await new AgentOrgProposalsRepository().findByIdAsync('prop-1');
      expect(proposal!.outcomeStatus).toBe('inconclusive');
    },
  );

  it('regresses on the mirror fixture and marks the proposal regressed', async () => {
    await seedProposal();
    await seedLedger(18, 10);
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, makeValidBundle());

    const judged = await judgeExperimentAsync(exp.id);
    if (judged.status !== 'decided') throw new Error('expected a terminal decision');
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
    if (judged.status !== 'decided') throw new Error('expected a terminal decision');
    expect(judged.decision).toBe('inconclusive');

    const proposal = await new AgentOrgProposalsRepository().findByIdAsync('prop-1');
    expect(proposal!.outcomeStatus).toBe('inconclusive');
  });
});

describe('W6-c13 a result may not be judged by a rule that did not predate it', () => {
  it('refuses an experiment whose declaration postdates its own results', async () => {
    // Not reachable through the repository — recordResultsAsync always stamps
    // results_recorded_at after declared_at, and both columns are
    // trigger-immutable. The guard exists for a RAW writer, so the test plants
    // exactly that: a row inserted directly with the timestamps inverted.
    // INSERT is the one write the immutability triggers do not cover.
    db.prepare(
      `INSERT INTO agent_org_experiments
         (id, proposal_id, adapter, evidence_bundle_json, baseline_spec_json,
          candidate_spec_json, assignment_key, stopping_rule_json, max_exposure,
          results_json, declared_at, results_recorded_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      'exp-retro',
      'prop-1',
      'paired-cohort-outcome',
      JSON.stringify(makeValidBundle()),
      '{}',
      '{}',
      'exp-key-1',
      JSON.stringify({ minSamplesPerCohort: 10, minEffect: 0.05 }),
      100,
      JSON.stringify({
        baseline: { sampleCount: 20, primaryMetricValue: 0.5 },
        candidate: { sampleCount: 20, primaryMetricValue: 0.9 },
      }),
      '2026-08-15T12:00:00.000Z', // declared AFTER
      '2026-08-15T09:00:00.000Z', // the results it judges
    );

    const experiment = (await new AgentOrgExperimentsRepository().findByIdAsync('exp-retro'))!;
    const result = decideExperiment({
      experiment,
      baseline: cohort(20, 10, 'baseline'),
      candidate: cohort(20, 18, 'candidate'),
    });
    if (result.status !== 'decided') throw new Error('expected a terminal decision');
    expect(result.decision).toBe('inconclusive');
    expect(result.reason).toMatch(/declared after/i);
  });
});

describe('P2-4 an established outcome is never downgraded by a re-judge', () => {
  it('judging twice leaves the C0-gated inconclusive verdict alone and does not churn the CAS revision', async () => {
    const proposals = new AgentOrgProposalsRepository();
    await proposals.createAsync({
      id: 'prop-1',
      kind: 'refine-skill',
      risk: 'low',
      title: 'a candidate worth measuring',
    });
    const outcomes = new AgentRunOutcomesRepository();
    for (let i = 0; i < 20; i += 1) {
      await outcomes.finalizeAsync({
        rootSessionId: `ses-b-${i}`,
        proposalId: 'prop-1',
        experimentVariant: 'baseline',
        terminalStatus: 'completed',
        objectiveVerdict: i < 10 ? 'success' : 'failure',
        objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
      });
      await outcomes.finalizeAsync({
        rootSessionId: `ses-c-${i}`,
        proposalId: 'prop-1',
        experimentVariant: 'candidate',
        terminalStatus: 'completed',
        objectiveVerdict: i < 18 ? 'success' : 'failure',
        objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
      });
    }
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, makeValidBundle());

    const firstJudged = await judgeExperimentAsync(exp.id);
    if (firstJudged.status !== 'decided') throw new Error('expected a terminal decision');
    expect(firstJudged.decision).toBe('inconclusive');
    const afterFirst = (await proposals.findByIdAsync('prop-1'))!;
    expect(afterFirst.outcomeStatus).toBe('inconclusive');

    // Re-entrant call: same verdict, no churn, no extra revision bump.
    const secondJudged = await judgeExperimentAsync(exp.id);
    if (secondJudged.status !== 'decided') throw new Error('expected a terminal decision');
    expect(secondJudged.decision).toBe('inconclusive');
    const afterSecond = (await proposals.findByIdAsync('prop-1'))!;
    expect(afterSecond.outcomeStatus).toBe('inconclusive');
    expect(afterSecond.revision).toBe(afterFirst.revision);
  });

  it('writeOutcomeStatus refuses to demote a verified proposal', async () => {
    const proposals = new AgentOrgProposalsRepository();
    const created = await proposals.createAsync({
      id: 'prop-v',
      kind: 'refine-skill',
      risk: 'low',
      title: 'already verified',
    });
    await proposals.setOutcomeStatusAtRevisionAsync({
      proposalId: created.id,
      expectedRevision: created.revision,
      outcomeStatus: 'verified',
    });

    expect(await writeOutcomeStatus('prop-v', 'inconclusive')).toBe(false);
    expect((await proposals.findByIdAsync('prop-v'))!.outcomeStatus).toBe('verified');
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

describe('C2-A — cross-profile run-episode reuse fails closed', () => {
  it('throws a typed collision error when a different profile requests an already-bound episode, leaving the original enrollment untouched', async () => {
    profileTargetFingerprint('collision-profile-a');
    const { hash: bHash } = profileTargetFingerprint('collision-profile-b');
    await declareC1Experiment('collision-profile-a', {
      proposalId: 'prop-collision-a',
      bundle: bundleForProfile('collision-profile-a', profileTargetFingerprint('collision-profile-a').hash),
      baselineSpec: systemPromptSpec('collision-profile-a', {}, profileTargetFingerprint('collision-profile-a').hash),
      candidateSpec: systemPromptSpec(
        'collision-profile-a',
        { candidateValue: 'a-candidate' },
        profileTargetFingerprint('collision-profile-a').hash,
      ),
    });
    await declareC1Experiment('collision-profile-b', {
      proposalId: 'prop-collision-b',
      bundle: bundleForProfile('collision-profile-b', bHash),
      baselineSpec: systemPromptSpec('collision-profile-b', {}, bHash),
      candidateSpec: systemPromptSpec('collision-profile-b', { candidateValue: 'b-candidate' }, bHash),
    });

    const runEpisodeId = 'run-episode-shared-by-two-profiles';
    const original = await reserveRunEnrollment(runEpisodeId, 'collision-profile-a');
    expect(original).not.toBeNull();
    expect(original!.profileId).toBe('collision-profile-a');

    await expect(reserveRunEnrollment(runEpisodeId, 'collision-profile-b')).rejects.toThrow(
      RunEnrollmentProfileCollisionError,
    );

    const afterCollision = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      runEpisodeId,
    );
    expect(afterCollision).toEqual(original);
    expect(afterCollision!.profileId).toBe('collision-profile-a');
    expect(afterCollision!.state).toBe('reserved');
    expect(afterCollision!.failureCode).toBeNull();
  });

  it('the collision error carries no raw profile/episode identifiers in its message', async () => {
    profileTargetFingerprint('collision-msg-a');
    const { hash: bHash } = profileTargetFingerprint('collision-msg-b');
    await declareC1Experiment('collision-msg-a', {
      proposalId: 'prop-collision-msg-a',
      bundle: bundleForProfile('collision-msg-a', profileTargetFingerprint('collision-msg-a').hash),
      baselineSpec: systemPromptSpec('collision-msg-a', {}, profileTargetFingerprint('collision-msg-a').hash),
      candidateSpec: systemPromptSpec(
        'collision-msg-a',
        { candidateValue: 'a-candidate' },
        profileTargetFingerprint('collision-msg-a').hash,
      ),
    });
    await declareC1Experiment('collision-msg-b', {
      proposalId: 'prop-collision-msg-b',
      bundle: bundleForProfile('collision-msg-b', bHash),
      baselineSpec: systemPromptSpec('collision-msg-b', {}, bHash),
      candidateSpec: systemPromptSpec('collision-msg-b', { candidateValue: 'b-candidate' }, bHash),
    });

    const runEpisodeId = 'run-episode-secret-marker-xyz';
    await reserveRunEnrollment(runEpisodeId, 'collision-msg-a');

    try {
      await reserveRunEnrollment(runEpisodeId, 'collision-msg-b');
      throw new Error('expected reserveRunEnrollment to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RunEnrollmentProfileCollisionError);
      const message = (err as Error).message;
      expect(message).not.toContain(runEpisodeId);
      expect(message).not.toContain('collision-msg-a');
      expect(message).not.toContain('collision-msg-b');
    }
  });

  it('same-profile idempotent lookup still returns the existing binding even after policy is switched off and the target drifts', async () => {
    const { hash } = profileTargetFingerprint('idempotent-profile');
    await declareC1Experiment('idempotent-profile', {
      proposalId: 'prop-idempotent',
      bundle: bundleForProfile('idempotent-profile', hash),
      baselineSpec: systemPromptSpec('idempotent-profile', {}, hash),
      candidateSpec: systemPromptSpec('idempotent-profile', { candidateValue: 'idempotent-candidate' }, hash),
    });

    const runEpisodeId = 'run-episode-idempotent';
    const original = await reserveRunEnrollment(runEpisodeId, 'idempotent-profile');
    expect(original).not.toBeNull();

    // Drift the target AFTER reservation.
    new AgentConfigsRepository().update('idempotent-profile', { systemPrompt: 'drifted' });

    // Toggle the optimizer off — a bare eligibility re-check would normally
    // refuse everything.
    const replay = await reserveRunEnrollment(runEpisodeId, 'idempotent-profile', {
      policy: { mode: 'off', disabledFamilies: new Set() },
    });

    expect(replay).toEqual(original);
  });
});

describe('C2-A — prepareReservedTreatment revalidates evidenceTarget.ref and .hash', () => {
  function makeEnrollmentFixture(overrides: Partial<ExperimentEnrollment>): ExperimentEnrollment {
    return {
      id: 'fixture-enrollment',
      runEpisodeId: 'fixture-run-episode',
      experimentId: 'fixture-experiment',
      proposalId: 'fixture-proposal',
      profileId: 'fixture-profile',
      cohort: 'candidate',
      assignmentDigest: 'fixture-digest',
      baselineTargetRevisionHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
      treatmentSpecHash: 'fixture-hash',
      reservedAt: '2026-08-15T00:00:00.000Z',
      state: 'reserved',
      failureCode: null,
      failureReason: null,
      ...overrides,
    };
  }

  async function declareRawExperiment(
    proposalId: string,
    baselineSpec: Record<string, unknown>,
    candidateSpec: Record<string, unknown>,
    bundleTargetHash: string,
    profileIdForBundle: string,
  ) {
    const experiments = new AgentOrgExperimentsRepository();
    return experiments.declareAsync({
      proposalId,
      adapter: 'paired-cohort-outcome',
      evidenceBundleJson: JSON.stringify(bundleForProfile(profileIdForBundle, bundleTargetHash)),
      baselineSpecJson: JSON.stringify(baselineSpec),
      candidateSpecJson: JSON.stringify(candidateSpec),
      assignmentKey: `exp-key-${proposalId}`,
      stoppingRule: { minSamplesPerCohort: 10, minEffect: 0.05 },
      maxExposure: 100,
    });
  }

  it('returns invalid_binding when the BASELINE evidenceTarget.ref does not match the canonical agent_config ref', async () => {
    const { config, hash } = profileTargetFingerprint('ref-check-baseline');
    const wrongRef = 'agent_config:some-unrelated-profile';

    const baselineSpec = {
      ...systemPromptSpec('ref-check-baseline', {}, hash),
      evidenceTarget: { ref: wrongRef, hash },
    };
    const candidateSpec = systemPromptSpec('ref-check-baseline', { candidateValue: 'after' }, hash);

    const exp = await declareRawExperiment(
      'prop-ref-check-baseline',
      baselineSpec,
      candidateSpec,
      hash,
      'ref-check-baseline',
    );

    const treatmentSpecHash = createHash('sha256').update(canonicalizeForHash(candidateSpec)).digest('hex');
    const enrollment = makeEnrollmentFixture({
      experimentId: exp.id,
      profileId: config.id,
      baselineTargetRevisionHash: hash,
      treatmentSpecHash,
      cohort: 'baseline',
    });

    const result = await prepareReservedTreatment(enrollment);
    expect(result.status).toBe('invalid_binding');
  });

  it('returns invalid_binding when the CANDIDATE evidenceTarget.ref does not match the canonical agent_config ref', async () => {
    const { config, hash } = profileTargetFingerprint('ref-check-candidate');
    const wrongRef = 'agent_config:some-unrelated-profile';

    const baselineSpec = systemPromptSpec('ref-check-candidate', {}, hash);
    const candidateSpec = {
      ...systemPromptSpec('ref-check-candidate', { candidateValue: 'after' }, hash),
      evidenceTarget: { ref: wrongRef, hash },
    };

    const exp = await declareRawExperiment(
      'prop-ref-check-candidate',
      baselineSpec,
      candidateSpec,
      hash,
      'ref-check-candidate',
    );

    const treatmentSpecHash = createHash('sha256').update(canonicalizeForHash(candidateSpec)).digest('hex');
    const enrollment = makeEnrollmentFixture({
      experimentId: exp.id,
      profileId: config.id,
      baselineTargetRevisionHash: hash,
      treatmentSpecHash,
      cohort: 'candidate',
    });

    const result = await prepareReservedTreatment(enrollment);
    expect(result.status).toBe('invalid_binding');
  });

  it('returns target_drifted when the current fingerprint no longer matches the reservation binding', async () => {
    const { config, hash } = profileTargetFingerprint('ref-check-drift');
    const baselineSpec = systemPromptSpec('ref-check-drift', {}, hash);
    const candidateSpec = systemPromptSpec('ref-check-drift', { candidateValue: 'after' }, hash);

    const exp = await declareRawExperiment('prop-ref-check-drift', baselineSpec, candidateSpec, hash, 'ref-check-drift');

    const treatmentSpecHash = createHash('sha256').update(canonicalizeForHash(candidateSpec)).digest('hex');
    const enrollment = makeEnrollmentFixture({
      experimentId: exp.id,
      profileId: config.id,
      // A stale/forged hash that does not match the profile's real current
      // fingerprint computed inside prepareReservedTreatment.
      baselineTargetRevisionHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      treatmentSpecHash,
      cohort: 'candidate',
    });

    const result = await prepareReservedTreatment(enrollment);
    expect(result.status).toBe('target_drifted');
  });

  it('returns ready with the exact bound cohort prompt when ref and hash both validate', async () => {
    const { config, hash } = profileTargetFingerprint('ref-check-ready');
    const baselineSpec = systemPromptSpec('ref-check-ready', {}, hash);
    const candidateSpec = systemPromptSpec('ref-check-ready', { candidateValue: 'after-ready' }, hash);

    const exp = await declareRawExperiment('prop-ref-check-ready', baselineSpec, candidateSpec, hash, 'ref-check-ready');

    const treatmentSpecHash = createHash('sha256').update(canonicalizeForHash(candidateSpec)).digest('hex');
    const enrollment = makeEnrollmentFixture({
      experimentId: exp.id,
      profileId: config.id,
      baselineTargetRevisionHash: hash,
      treatmentSpecHash,
      cohort: 'candidate',
    });

    const result = await prepareReservedTreatment(enrollment);
    expect(result.status).toBe('ready');
    expect(result.status === 'ready' && result.systemPromptOverride).toBe('after-ready');
  });

  it('never logs raw prompt bytes when a dependency error occurs during preparation', async () => {
    const { config, hash } = profileTargetFingerprint('log-redaction-profile');
    const BASELINE_PROMPT = 'You are the baseline redaction-test assistant.';
    const CANDIDATE_PROMPT = 'You are the candidate redaction-test assistant.';
    const RAW_PROMPT_SENTINEL = 'SENTINEL-RAW-PROMPT-BYTES-8f3c1a';

    const baselineSpec = systemPromptSpec('log-redaction-profile', {
      priorValue: BASELINE_PROMPT,
      currentValue: BASELINE_PROMPT,
      candidateValue: BASELINE_PROMPT,
    }, hash);
    const candidateSpec = systemPromptSpec('log-redaction-profile', {
      priorValue: BASELINE_PROMPT,
      currentValue: BASELINE_PROMPT,
      candidateValue: CANDIDATE_PROMPT,
    }, hash);

    const exp = await declareRawExperiment(
      'prop-log-redaction',
      baselineSpec,
      candidateSpec,
      hash,
      'log-redaction-profile',
    );

    const treatmentSpecHash = createHash('sha256').update(canonicalizeForHash(candidateSpec)).digest('hex');
    const enrollment = makeEnrollmentFixture({
      experimentId: exp.id,
      profileId: config.id,
      baselineTargetRevisionHash: hash,
      treatmentSpecHash,
      cohort: 'candidate',
    });

    // A storage/parser dependency failure whose error message happens to
    // carry raw prompt bytes (e.g. a driver echoing the offending row back in
    // its error text) must never reach the logger verbatim.
    const failingExperimentsRepo = {
      findByIdAsync: async () => {
        throw new Error(
          `dependency failure while reading experiment row: baseline="${BASELINE_PROMPT}" candidate="${CANDIDATE_PROMPT}" ${RAW_PROMPT_SENTINEL}`,
        );
      },
    } as unknown as AgentOrgExperimentsRepository;

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const result = await prepareReservedTreatment(enrollment, { experimentsRepo: failingExperimentsRepo });

    expect(result.status).toBe('invalid_binding');

    const loggedArgs = [...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((arg) => String(arg));
    for (const logged of loggedArgs) {
      expect(logged).not.toContain(RAW_PROMPT_SENTINEL);
      expect(logged).not.toContain(BASELINE_PROMPT);
      expect(logged).not.toContain(CANDIDATE_PROMPT);
    }

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
