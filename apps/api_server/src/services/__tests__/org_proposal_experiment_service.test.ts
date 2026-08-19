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
  commitReservedTreatmentDispatch,
  computeDecisionAsync,
  decideExperiment,
  judgeExperimentAsync,
  markRunEnrollmentPreDispatchFailed,
  prepareReservedTreatment,
  reserveRunEnrollment,
  RunEnrollmentProfileCollisionError,
  TreatmentDispatchCommitError,
  writeOutcomeStatus,
} from '../org_proposal_experiment_service';
import type { ExperimentEnrollment } from '../../models/agent_org_experiment_enrollment';
import { AgentOrgTreatmentReceiptsRepository } from '../../repositories/agent_org_treatment_receipts_repository';

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
    guardrails: ['terminal-error-rate'],
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
  currentSystemPrompt = 'before',
): Record<string, unknown> {
  return {
    agentConfigId: profileId,
    field: 'system_prompt',
    priorValue: currentSystemPrompt,
    currentValue: currentSystemPrompt,
    candidateValue: 'after',
    evidenceTarget: { ref: toProfileTargetRef(profileId), hash: evidenceHash },
    ...overrides,
  };
}

/**
 * C2-B — every reservable/preparable treatment must be backed by an exact
 * strict `refine-config` proposal row. Idempotent by id: a caller that
 * pre-creates the proposal with a deliberately corrupted shape (wrong
 * kind/targetRef/changeJson, for the C2-B negative fixtures) and then passes
 * that same `proposalId` here gets its row left untouched.
 */
async function seedTreatmentProposal(
  proposalId: string,
  profileId: string,
  candidateValue: unknown,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  const proposals = new AgentOrgProposalsRepository();
  const existing = await proposals.findByIdAsync(proposalId);
  if (existing) return;
  await proposals.createAsync({
    id: proposalId,
    kind: 'refine-config',
    risk: 'low',
    status: 'active',
    title: `treatment binding for ${profileId}`,
    targetRef: toProfileTargetRef(profileId),
    changeJson: JSON.stringify({
      configPatch: { agentConfigId: profileId, field: 'system_prompt', value: candidateValue },
    }),
    ...overrides,
  });
}

async function declareC1Experiment(
  profileId: string,
  options: {
    proposalId?: string;
    adapter?: string;
    bundle?: ProposalEvidenceBundle;
    baselineSpec?: Record<string, unknown>;
    candidateSpec?: Record<string, unknown>;
    stoppingRule?: { minSamplesPerCohort: number; minEffect: number };
    maxExposure?: number;
  } = {},
) {
  const {
    proposalId,
    adapter = 'paired-cohort-outcome',
    bundle = bundleForProfile(profileId),
    baselineSpec = systemPromptSpec(profileId),
    candidateSpec = systemPromptSpec(profileId, { candidateValue: 'after-candidate' }),
    stoppingRule = { minSamplesPerCohort: 10, minEffect: 0.05 },
    maxExposure = 100,
  } = options;

  const resolvedProposalId = proposalId ?? `prop-${bundle.target.ref}-${Math.random()}`;
  await seedTreatmentProposal(
    resolvedProposalId,
    profileId,
    (candidateSpec as Record<string, unknown>).candidateValue,
  );

  const experiments = new AgentOrgExperimentsRepository();
  return experiments.declareAsync({
    proposalId: resolvedProposalId,
    adapter,
    evidenceBundleJson: JSON.stringify(bundle),
    baselineSpecJson: JSON.stringify(baselineSpec),
    candidateSpecJson: JSON.stringify(candidateSpec),
    assignmentKey: `exp-${bundle.target.ref}-${Math.random()}`,
    stoppingRule,
    maxExposure,
  });
}

/** A cohort of `n` ledger outcomes of which `successes` succeeded. */
function cohort(n: number, successes: number, variant: string): AgentRunOutcome[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `out-${variant}-${i}`,
    rootSessionId: `ses-${variant}-${i}`,
    sessionId: null,
    runEpisodeId: null,
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
    const REAL_PROMPT = 'the profile system prompt bytes must stay private';
    const { hash } = profileTargetFingerprint('profile-no-raw', REAL_PROMPT);

    await declareC1Experiment('profile-no-raw', {
      proposalId: 'prop-no-raw',
      bundle: bundleForProfile('profile-no-raw', hash),
      baselineSpec: systemPromptSpec('profile-no-raw', {}, hash, REAL_PROMPT),
      candidateSpec: systemPromptSpec('profile-no-raw', { candidateValue: 'private-after' }, hash, REAL_PROMPT),
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
      baselineSpec: systemPromptSpec('profile-hash', {}, initialHash, 'baseline'),
      candidateSpec: systemPromptSpec('profile-hash', { candidateValue: 'first' }, initialHash, 'baseline'),
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
      baselineSpec: systemPromptSpec('profile-hash', {}, updatedHash, 'baseline-updated'),
      candidateSpec: systemPromptSpec('profile-hash', { candidateValue: 'second' }, updatedHash, 'baseline-updated'),
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

/**
 * C2-B — every one of these plants a proposal whose declared changeJson is
 * corrupted along exactly ONE dimension (kind, targetRef, JSON shape, a
 * smuggled key, or the bound field/id/value), keeps everything else — the
 * experiment's evidence bundle, treatment specs, and durable target — fully
 * consistent, and asserts `reserveRunEnrollment` refuses to reserve through
 * that ONE corruption alone. The trailing positive control proves the same
 * fixture shape actually reserves when nothing is corrupted, so a refusal
 * above cannot be blamed on an unrelated fixture mistake.
 */
describe('C2-B reserveRunEnrollment fails closed on a corrupted backing proposal', () => {
  it('refuses when the proposal kind is not exactly refine-config', async () => {
    const { hash } = profileTargetFingerprint('c2b-wrong-kind');
    const proposalId = 'prop-c2b-wrong-kind';
    await seedTreatmentProposal(proposalId, 'c2b-wrong-kind', 'after', { kind: 'refine-recipe' });
    await declareC1Experiment('c2b-wrong-kind', {
      proposalId,
      bundle: bundleForProfile('c2b-wrong-kind', hash),
      baselineSpec: systemPromptSpec('c2b-wrong-kind', {}, hash),
      candidateSpec: systemPromptSpec('c2b-wrong-kind', { candidateValue: 'after' }, hash),
    });

    expect(await reserveRunEnrollment('run-c2b-wrong-kind', 'c2b-wrong-kind')).toBeNull();
  });

  it('refuses when the proposal targetRef does not name this exact profile', async () => {
    const { hash } = profileTargetFingerprint('c2b-wrong-target');
    profileTargetFingerprint('c2b-other-target');
    const proposalId = 'prop-c2b-wrong-target';
    await seedTreatmentProposal(proposalId, 'c2b-wrong-target', 'after', {
      targetRef: toProfileTargetRef('c2b-other-target'),
    });
    await declareC1Experiment('c2b-wrong-target', {
      proposalId,
      bundle: bundleForProfile('c2b-wrong-target', hash),
      baselineSpec: systemPromptSpec('c2b-wrong-target', {}, hash),
      candidateSpec: systemPromptSpec('c2b-wrong-target', { candidateValue: 'after' }, hash),
    });

    expect(await reserveRunEnrollment('run-c2b-wrong-target', 'c2b-wrong-target')).toBeNull();
  });

  it('refuses when changeJson is malformed JSON', async () => {
    const { hash } = profileTargetFingerprint('c2b-malformed-json');
    const proposalId = 'prop-c2b-malformed-json';
    await seedTreatmentProposal(proposalId, 'c2b-malformed-json', 'after', {
      changeJson: '{"configPatch": { "agentConfigId": "c2b-malformed-json", "field": "system_prompt"',
    });
    await declareC1Experiment('c2b-malformed-json', {
      proposalId,
      bundle: bundleForProfile('c2b-malformed-json', hash),
      baselineSpec: systemPromptSpec('c2b-malformed-json', {}, hash),
      candidateSpec: systemPromptSpec('c2b-malformed-json', { candidateValue: 'after' }, hash),
    });

    expect(await reserveRunEnrollment('run-c2b-malformed-json', 'c2b-malformed-json')).toBeNull();
  });

  it('refuses when changeJson contains a duplicate top-level JSON member', async () => {
    const { hash } = profileTargetFingerprint('c2b-dup-key');
    const proposalId = 'prop-c2b-dup-key';
    const patch = '{"agentConfigId":"c2b-dup-key","field":"system_prompt","value":"after"}';
    await seedTreatmentProposal(proposalId, 'c2b-dup-key', 'after', {
      changeJson: `{"configPatch":${patch},"configPatch":${patch}}`,
    });
    await declareC1Experiment('c2b-dup-key', {
      proposalId,
      bundle: bundleForProfile('c2b-dup-key', hash),
      baselineSpec: systemPromptSpec('c2b-dup-key', {}, hash),
      candidateSpec: systemPromptSpec('c2b-dup-key', { candidateValue: 'after' }, hash),
    });

    expect(await reserveRunEnrollment('run-c2b-dup-key', 'c2b-dup-key')).toBeNull();
  });

  it('refuses when changeJson carries a smuggled OUTER key alongside configPatch', async () => {
    const { hash } = profileTargetFingerprint('c2b-outer-extra');
    const proposalId = 'prop-c2b-outer-extra';
    await seedTreatmentProposal(proposalId, 'c2b-outer-extra', 'after', {
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: 'c2b-outer-extra', field: 'system_prompt', value: 'after' },
        diagnosis: 'smuggled outer key',
      }),
    });
    await declareC1Experiment('c2b-outer-extra', {
      proposalId,
      bundle: bundleForProfile('c2b-outer-extra', hash),
      baselineSpec: systemPromptSpec('c2b-outer-extra', {}, hash),
      candidateSpec: systemPromptSpec('c2b-outer-extra', { candidateValue: 'after' }, hash),
    });

    expect(await reserveRunEnrollment('run-c2b-outer-extra', 'c2b-outer-extra')).toBeNull();
  });

  it('refuses when configPatch carries a smuggled INNER key', async () => {
    const { hash } = profileTargetFingerprint('c2b-inner-extra');
    const proposalId = 'prop-c2b-inner-extra';
    await seedTreatmentProposal(proposalId, 'c2b-inner-extra', 'after', {
      changeJson: JSON.stringify({
        configPatch: {
          agentConfigId: 'c2b-inner-extra',
          field: 'system_prompt',
          value: 'after',
          concreteFix: 'smuggled inner key',
        },
      }),
    });
    await declareC1Experiment('c2b-inner-extra', {
      proposalId,
      bundle: bundleForProfile('c2b-inner-extra', hash),
      baselineSpec: systemPromptSpec('c2b-inner-extra', {}, hash),
      candidateSpec: systemPromptSpec('c2b-inner-extra', { candidateValue: 'after' }, hash),
    });

    expect(await reserveRunEnrollment('run-c2b-inner-extra', 'c2b-inner-extra')).toBeNull();
  });

  it('refuses when configPatch.field is not exactly system_prompt', async () => {
    const { hash } = profileTargetFingerprint('c2b-wrong-field');
    const proposalId = 'prop-c2b-wrong-field';
    await seedTreatmentProposal(proposalId, 'c2b-wrong-field', 'after', {
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: 'c2b-wrong-field', field: 'temperature', value: 'after' },
      }),
    });
    await declareC1Experiment('c2b-wrong-field', {
      proposalId,
      bundle: bundleForProfile('c2b-wrong-field', hash),
      baselineSpec: systemPromptSpec('c2b-wrong-field', {}, hash),
      candidateSpec: systemPromptSpec('c2b-wrong-field', { candidateValue: 'after' }, hash),
    });

    expect(await reserveRunEnrollment('run-c2b-wrong-field', 'c2b-wrong-field')).toBeNull();
  });

  it('refuses when configPatch.agentConfigId names a different profile than the reservation target', async () => {
    const { hash } = profileTargetFingerprint('c2b-wrong-agent-id');
    profileTargetFingerprint('c2b-other-agent-id');
    const proposalId = 'prop-c2b-wrong-agent-id';
    await seedTreatmentProposal(proposalId, 'c2b-wrong-agent-id', 'after', {
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: 'c2b-other-agent-id', field: 'system_prompt', value: 'after' },
      }),
    });
    await declareC1Experiment('c2b-wrong-agent-id', {
      proposalId,
      bundle: bundleForProfile('c2b-wrong-agent-id', hash),
      baselineSpec: systemPromptSpec('c2b-wrong-agent-id', {}, hash),
      candidateSpec: systemPromptSpec('c2b-wrong-agent-id', { candidateValue: 'after' }, hash),
    });

    expect(await reserveRunEnrollment('run-c2b-wrong-agent-id', 'c2b-wrong-agent-id')).toBeNull();
  });

  it('refuses when configPatch.value does not equal the exact candidate value the treatment spec declares', async () => {
    const { hash } = profileTargetFingerprint('c2b-wrong-value');
    const proposalId = 'prop-c2b-wrong-value';
    await seedTreatmentProposal(proposalId, 'c2b-wrong-value', 'a-completely-different-value');
    await declareC1Experiment('c2b-wrong-value', {
      proposalId,
      bundle: bundleForProfile('c2b-wrong-value', hash),
      baselineSpec: systemPromptSpec('c2b-wrong-value', {}, hash),
      candidateSpec: systemPromptSpec('c2b-wrong-value', { candidateValue: 'after' }, hash),
    });

    expect(await reserveRunEnrollment('run-c2b-wrong-value', 'c2b-wrong-value')).toBeNull();
  });

  it('positive control: the identical fixture shape WITHOUT any corruption does reserve', async () => {
    const { hash } = profileTargetFingerprint('c2b-consistent-control');
    const proposalId = 'prop-c2b-consistent-control';
    await seedTreatmentProposal(proposalId, 'c2b-consistent-control', 'after');
    await declareC1Experiment('c2b-consistent-control', {
      proposalId,
      bundle: bundleForProfile('c2b-consistent-control', hash),
      baselineSpec: systemPromptSpec('c2b-consistent-control', {}, hash),
      candidateSpec: systemPromptSpec('c2b-consistent-control', { candidateValue: 'after' }, hash),
    });

    const result = await reserveRunEnrollment('run-c2b-consistent-control', 'c2b-consistent-control');
    expect(result).not.toBeNull();
    expect(result!.proposalId).toBe(proposalId);
  });
});

/**
 * C2-B — defense in depth: a spec's `evidenceTarget.ref`/`.hash` can be
 * perfectly canonical (the ref names this exact profile, the hash equals the
 * REAL current fingerprint) while the spec's own `priorValue`/`currentValue`
 * text fields — independent strings — silently diverge from the profile's
 * actual durable `systemPrompt`. `specsBindToDurableSystemPrompt` is the only
 * thing standing between that forged content and a reservation.
 */
describe('C2-B specs must bind to the durable systemPrompt CONTENT, not merely a matching ref/hash', () => {
  it('refuses reservation when the BASELINE spec currentValue diverges from the durable systemPrompt', async () => {
    const { hash } = profileTargetFingerprint('c2b-content-baseline', 'real-durable-prompt');
    const proposalId = 'prop-c2b-content-baseline';
    await seedTreatmentProposal(proposalId, 'c2b-content-baseline', 'after');
    await declareC1Experiment('c2b-content-baseline', {
      proposalId,
      bundle: bundleForProfile('c2b-content-baseline', hash),
      baselineSpec: {
        ...systemPromptSpec('c2b-content-baseline', {}, hash, 'real-durable-prompt'),
        currentValue: 'forged-different-text',
      },
      candidateSpec: systemPromptSpec('c2b-content-baseline', { candidateValue: 'after' }, hash, 'real-durable-prompt'),
    });

    expect(await reserveRunEnrollment('run-c2b-content-baseline', 'c2b-content-baseline')).toBeNull();
  });

  it('refuses reservation when the CANDIDATE spec priorValue diverges from the durable systemPrompt', async () => {
    const { hash } = profileTargetFingerprint('c2b-content-prior', 'real-durable-prompt-2');
    const proposalId = 'prop-c2b-content-prior';
    await seedTreatmentProposal(proposalId, 'c2b-content-prior', 'after');
    await declareC1Experiment('c2b-content-prior', {
      proposalId,
      bundle: bundleForProfile('c2b-content-prior', hash),
      baselineSpec: systemPromptSpec('c2b-content-prior', {}, hash, 'real-durable-prompt-2'),
      candidateSpec: {
        ...systemPromptSpec('c2b-content-prior', { candidateValue: 'after' }, hash, 'real-durable-prompt-2'),
        priorValue: 'forged-prior-text',
      },
    });

    expect(await reserveRunEnrollment('run-c2b-content-prior', 'c2b-content-prior')).toBeNull();
  });

  it('refuses reservation when the CANDIDATE spec currentValue diverges from the durable systemPrompt', async () => {
    const { hash } = profileTargetFingerprint('c2b-content-current', 'real-durable-prompt-3');
    const proposalId = 'prop-c2b-content-current';
    await seedTreatmentProposal(proposalId, 'c2b-content-current', 'after');
    await declareC1Experiment('c2b-content-current', {
      proposalId,
      bundle: bundleForProfile('c2b-content-current', hash),
      baselineSpec: systemPromptSpec('c2b-content-current', {}, hash, 'real-durable-prompt-3'),
      candidateSpec: {
        ...systemPromptSpec('c2b-content-current', { candidateValue: 'after' }, hash, 'real-durable-prompt-3'),
        currentValue: 'forged-current-text',
      },
    });

    expect(await reserveRunEnrollment('run-c2b-content-current', 'c2b-content-current')).toBeNull();
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
    await seedTreatmentProposal(
      proposalId,
      profileIdForBundle,
      (candidateSpec as Record<string, unknown>).candidateValue,
    );
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

  it('returns invalid_binding when the CANDIDATE spec currentValue diverges from the durable systemPrompt despite a canonical ref/hash', async () => {
    const { config, hash } = profileTargetFingerprint('prepare-content-current', 'real-prepare-prompt');

    const baselineSpec = systemPromptSpec('prepare-content-current', {}, hash, 'real-prepare-prompt');
    const candidateSpec = {
      ...systemPromptSpec('prepare-content-current', { candidateValue: 'after' }, hash, 'real-prepare-prompt'),
      currentValue: 'forged-current-text',
    };

    const exp = await declareRawExperiment(
      'prop-prepare-content-current',
      baselineSpec,
      candidateSpec,
      hash,
      'prepare-content-current',
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

  /**
   * C2-B — a reservation is legal at the moment it is made, but the proposal
   * it depends on is a live, mutable row read fresh on every preparation
   * (never cached from reservation time). If that row is later corrupted —
   * wrong kind, wrong targetRef, or a tampered candidate value — preparation
   * must fail closed even though nothing about the reservation/experiment
   * itself changed. Verified with an INJECTED fake `proposalsRepo` rather
   * than mutating the real (trigger-immutable) proposal row, since the
   * dispatch-safety property under test is "prepareReservedTreatment trusts
   * whatever its proposalsRepo dependency returns for THIS check", not
   * "the ledger allows post-hoc proposal edits".
   */
  describe('a legal reservation still fails preparation closed if the proposal dependency now returns a corrupted binding', () => {
    async function setUpLegalReservation(profileId: string) {
      const { config, hash } = profileTargetFingerprint(profileId);
      const baselineSpec = systemPromptSpec(profileId, {}, hash);
      const candidateSpec = systemPromptSpec(profileId, { candidateValue: 'after' }, hash);
      const exp = await declareRawExperiment(`prop-${profileId}`, baselineSpec, candidateSpec, hash, profileId);
      const treatmentSpecHash = createHash('sha256').update(canonicalizeForHash(candidateSpec)).digest('hex');
      const enrollment = makeEnrollmentFixture({
        experimentId: exp.id,
        proposalId: exp.proposalId,
        profileId: config.id,
        baselineTargetRevisionHash: hash,
        treatmentSpecHash,
        cohort: 'candidate',
      });
      return { enrollment, exp };
    }

    it('sanity: the untouched setup DOES prepare ready (positive control)', async () => {
      const { enrollment } = await setUpLegalReservation('post-corrupt-control');
      const result = await prepareReservedTreatment(enrollment);
      expect(result.status).toBe('ready');
    });

    it('fails closed when the dependency now returns a WRONG-KIND proposal', async () => {
      const { enrollment, exp } = await setUpLegalReservation('post-corrupt-kind');
      const realProposal = await new AgentOrgProposalsRepository().findByIdAsync(exp.proposalId);
      const fakeProposalsRepo = {
        findByIdAsync: async () => ({ ...realProposal!, kind: 'refine-recipe' }),
      } as unknown as AgentOrgProposalsRepository;

      const result = await prepareReservedTreatment(enrollment, { proposalsRepo: fakeProposalsRepo });
      expect(result.status).toBe('invalid_binding');
    });

    it('fails closed when the dependency now returns a WRONG-TARGET proposal', async () => {
      const { enrollment, exp } = await setUpLegalReservation('post-corrupt-target');
      const realProposal = await new AgentOrgProposalsRepository().findByIdAsync(exp.proposalId);
      const fakeProposalsRepo = {
        findByIdAsync: async () => ({ ...realProposal!, targetRef: 'agent_config:some-unrelated-profile' }),
      } as unknown as AgentOrgProposalsRepository;

      const result = await prepareReservedTreatment(enrollment, { proposalsRepo: fakeProposalsRepo });
      expect(result.status).toBe('invalid_binding');
    });

    it('fails closed when the dependency now returns a WRONG-VALUE proposal', async () => {
      const { enrollment, exp } = await setUpLegalReservation('post-corrupt-value');
      const realProposal = await new AgentOrgProposalsRepository().findByIdAsync(exp.proposalId);
      const fakeProposalsRepo = {
        findByIdAsync: async () => ({
          ...realProposal!,
          changeJson: JSON.stringify({
            configPatch: { agentConfigId: 'post-corrupt-value', field: 'system_prompt', value: 'tampered-after-reservation' },
          }),
        }),
      } as unknown as AgentOrgProposalsRepository;

      const result = await prepareReservedTreatment(enrollment, { proposalsRepo: fakeProposalsRepo });
      expect(result.status).toBe('invalid_binding');
    });

    it('fails closed when the dependency now returns a proposal with malformed changeJson', async () => {
      const { enrollment, exp } = await setUpLegalReservation('post-corrupt-malformed');
      const realProposal = await new AgentOrgProposalsRepository().findByIdAsync(exp.proposalId);
      const fakeProposalsRepo = {
        findByIdAsync: async () => ({ ...realProposal!, changeJson: '{not valid json' }),
      } as unknown as AgentOrgProposalsRepository;

      const result = await prepareReservedTreatment(enrollment, { proposalsRepo: fakeProposalsRepo });
      expect(result.status).toBe('invalid_binding');
    });
  });

  /**
   * C2-B — the receipt material a later phase persists must be exact and
   * hash-only. Proven for BOTH cohorts off the SAME experiment/profile so a
   * reader can see the two prompts and the two hashes actually differ for a
   * real (non-no-op) candidate, and that neither raw prompt string leaks into
   * the receipt-safe material at all.
   */
  it('produces exact, hash-consistent receiptMaterial for BOTH cohorts, with distinct prompts/hashes and no raw prompt bytes', async () => {
    const REAL_PROMPT = 'You are the receipt-material baseline assistant. SECRET-BASELINE-TEXT-91a2';
    const CANDIDATE_PROMPT = 'You are the receipt-material candidate assistant. SECRET-CANDIDATE-TEXT-77b3';
    const { config, hash } = profileTargetFingerprint('receipt-material-profile', REAL_PROMPT);

    const baselineSpec = systemPromptSpec(
      'receipt-material-profile',
      { priorValue: REAL_PROMPT, currentValue: REAL_PROMPT, candidateValue: REAL_PROMPT },
      hash,
    );
    const candidateSpec = systemPromptSpec(
      'receipt-material-profile',
      { priorValue: REAL_PROMPT, currentValue: REAL_PROMPT, candidateValue: CANDIDATE_PROMPT },
      hash,
    );

    const exp = await declareRawExperiment(
      'prop-receipt-material',
      baselineSpec,
      candidateSpec,
      hash,
      'receipt-material-profile',
    );

    const treatmentSpecHash = createHash('sha256').update(canonicalizeForHash(candidateSpec)).digest('hex');
    const baselineEnrollment = makeEnrollmentFixture({
      experimentId: exp.id,
      proposalId: exp.proposalId,
      profileId: config.id,
      baselineTargetRevisionHash: hash,
      treatmentSpecHash,
      cohort: 'baseline',
    });
    const candidateEnrollment = makeEnrollmentFixture({
      experimentId: exp.id,
      proposalId: exp.proposalId,
      profileId: config.id,
      baselineTargetRevisionHash: hash,
      treatmentSpecHash,
      cohort: 'candidate',
    });

    const baselineResult = await prepareReservedTreatment(baselineEnrollment);
    const candidateResult = await prepareReservedTreatment(candidateEnrollment);
    if (baselineResult.status !== 'ready' || candidateResult.status !== 'ready') {
      throw new Error('expected both cohorts to prepare ready');
    }

    // The candidate is a real (non-no-op) change: the two cohorts get
    // different prompts and therefore different effective-prompt hashes.
    expect(baselineResult.systemPromptOverride).toBe(REAL_PROMPT);
    expect(candidateResult.systemPromptOverride).toBe(CANDIDATE_PROMPT);
    expect(baselineResult.systemPromptOverride).not.toBe(candidateResult.systemPromptOverride);
    expect(baselineResult.receiptMaterial.effectivePromptHash).not.toBe(
      candidateResult.receiptMaterial.effectivePromptHash,
    );

    const expectedTargetRef = toProfileTargetRef('receipt-material-profile');
    const refreshedProfile = new AgentConfigsRepository().getById('receipt-material-profile')!;

    for (const [result, expectedPrompt] of [
      [baselineResult, REAL_PROMPT],
      [candidateResult, CANDIDATE_PROMPT],
    ] as const) {
      expect(result.receiptMaterial.profileRevision).toBe(refreshedProfile.revision);
      expect(result.receiptMaterial.targetRef).toBe(expectedTargetRef);
      expect(result.receiptMaterial.targetRevisionHash).toBe(hash);
      expect(result.receiptMaterial.treatmentSpecHash).toBe(treatmentSpecHash);
      expect(result.receiptMaterial.effectivePromptHash).toBe(
        createHash('sha256').update(expectedPrompt).digest('hex'),
      );
      expect(result.receiptMaterial.effectivePromptHash).toMatch(/^[a-f0-9]{64}$/);
    }

    // No raw prompt bytes anywhere in the persisted-safe receipt material.
    const serialized = JSON.stringify([baselineResult.receiptMaterial, candidateResult.receiptMaterial]);
    expect(serialized).not.toContain(REAL_PROMPT);
    expect(serialized).not.toContain(CANDIDATE_PROMPT);
    expect(serialized).not.toContain('SECRET-BASELINE-TEXT-91a2');
    expect(serialized).not.toContain('SECRET-CANDIDATE-TEXT-77b3');
  });
});

/**
 * C2-C — the shared final commit helper. This is the ONLY place a reserved
 * enrollment may become `dispatched` with a durable receipt; it is designed
 * to be wired as the real prompt-dispatch boundary's `beforeDispatch` hook.
 */
describe('C2-C — commitReservedTreatmentDispatch: the real dispatch-boundary commit', () => {
  async function setUpReadyReservation(profileId: string, runEpisodeId: string) {
    const { hash } = profileTargetFingerprint(profileId);
    await declareC1Experiment(profileId, {
      proposalId: `prop-${profileId}`,
      bundle: bundleForProfile(profileId, hash),
      baselineSpec: systemPromptSpec(profileId, {}, hash),
      candidateSpec: systemPromptSpec(profileId, { candidateValue: `${profileId}-candidate` }, hash),
    });
    const enrollment = await reserveRunEnrollment(runEpisodeId, profileId);
    if (!enrollment) throw new Error('test setup: expected a reservation');
    const preparation = await prepareReservedTreatment(enrollment);
    if (preparation.status !== 'ready') {
      throw new Error(`test setup: expected ready preparation, got ${preparation.status}`);
    }
    return { enrollment, preparation };
  }

  it('commits the atomic reserved -> dispatched transition and an immutable receipt', async () => {
    const { enrollment, preparation } = await setUpReadyReservation(
      'c2c-commit-basic',
      'run-c2c-commit-basic',
    );

    const receipt = await commitReservedTreatmentDispatch(enrollment, preparation);

    expect(receipt.runEpisodeId).toBe(enrollment.runEpisodeId);
    expect(receipt.cohort).toBe(enrollment.cohort);
    expect(typeof receipt.id).toBe('string');

    const updatedEnrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      enrollment.runEpisodeId,
    );
    expect(updatedEnrollment?.state).toBe('dispatched');

    const storedReceipt = await new AgentOrgTreatmentReceiptsRepository().findByRunEpisodeIdAsync(
      enrollment.runEpisodeId,
    );
    expect(storedReceipt).not.toBeNull();
    expect(storedReceipt?.id).toBe(receipt.id);
    expect(storedReceipt?.effectivePromptHash).toBe(preparation.receiptMaterial.effectivePromptHash);
  });

  it('an identical retry (same enrollment, same fresh preparation) is idempotent and reuses the exact receipt', async () => {
    const { enrollment, preparation } = await setUpReadyReservation(
      'c2c-commit-idempotent',
      'run-c2c-commit-idempotent',
    );

    const first = await commitReservedTreatmentDispatch(enrollment, preparation);
    const second = await commitReservedTreatmentDispatch(enrollment, preparation);
    expect(second).toEqual(first);

    const stored = await new AgentOrgTreatmentReceiptsRepository().findByRunEpisodeIdAsync(
      enrollment.runEpisodeId,
    );
    expect(stored?.id).toBe(first.id);
  });

  it('drift between the initial preparation and the real commit blocks the receipt and marks target_drifted', async () => {
    const profileId = 'c2c-commit-drift';
    const { enrollment, preparation } = await setUpReadyReservation(profileId, 'run-c2c-commit-drift');

    // The target drifts AFTER the initial (early) preparation but BEFORE the
    // real dispatch-boundary commit — e.g. skill/memory preface construction
    // or session creation took long enough for a concurrent config edit to
    // land in between.
    new AgentConfigsRepository().update(profileId, {
      systemPrompt: 'a completely different prompt nobody reserved against',
    });

    await expect(commitReservedTreatmentDispatch(enrollment, preparation)).rejects.toMatchObject({
      name: 'TreatmentDispatchCommitError',
      reason: 'target_drifted',
    });

    const updatedEnrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      enrollment.runEpisodeId,
    );
    expect(updatedEnrollment?.state).toBe('treatment_failed');
    expect(updatedEnrollment?.failureCode).toBe('target_drifted');

    const storedReceipt = await new AgentOrgTreatmentReceiptsRepository().findByRunEpisodeIdAsync(
      enrollment.runEpisodeId,
    );
    expect(storedReceipt).toBeNull();
  });

  it('proposal corruption between the initial preparation and the real commit fails closed as pre_dispatch_failed', async () => {
    const profileId = 'c2c-commit-proposal-corrupt';
    const { enrollment, preparation } = await setUpReadyReservation(
      profileId,
      'run-c2c-commit-proposal-corrupt',
    );

    const realProposal = await new AgentOrgProposalsRepository().findByIdAsync(enrollment.proposalId);
    const fakeProposalsRepo = {
      findByIdAsync: async () => ({ ...realProposal!, kind: 'refine-recipe' }),
    } as unknown as AgentOrgProposalsRepository;

    await expect(
      commitReservedTreatmentDispatch(enrollment, preparation, { proposalsRepo: fakeProposalsRepo }),
    ).rejects.toMatchObject({ name: 'TreatmentDispatchCommitError', reason: 'pre_dispatch_failed' });

    const updatedEnrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      enrollment.runEpisodeId,
    );
    expect(updatedEnrollment?.state).toBe('treatment_failed');
    expect(updatedEnrollment?.failureCode).toBe('pre_dispatch_failed');

    const storedReceipt = await new AgentOrgTreatmentReceiptsRepository().findByRunEpisodeIdAsync(
      enrollment.runEpisodeId,
    );
    expect(storedReceipt).toBeNull();
  });

  it('a receipt-repository failure surfaces as pre_dispatch_failed and fails closed with no receipt', async () => {
    const { enrollment, preparation } = await setUpReadyReservation(
      'c2c-commit-repo-failure',
      'run-c2c-commit-repo-failure',
    );

    const failingReceiptsRepo = {
      dispatchAndFinalizeReceiptAsync: async () => {
        throw new Error('driver exploded with raw internal bytes');
      },
    } as unknown as AgentOrgTreatmentReceiptsRepository;

    await expect(
      commitReservedTreatmentDispatch(enrollment, preparation, { receiptsRepo: failingReceiptsRepo }),
    ).rejects.toMatchObject({ name: 'TreatmentDispatchCommitError', reason: 'pre_dispatch_failed' });

    const updatedEnrollment = await new AgentOrgExperimentEnrollmentsRepository().findByRunEpisodeIdAsync(
      enrollment.runEpisodeId,
    );
    expect(updatedEnrollment?.state).toBe('treatment_failed');
    expect(updatedEnrollment?.failureCode).toBe('pre_dispatch_failed');
  });

  it('a non-applied/idempotent receipt-repository result (e.g. binding_mismatch) fails closed as pre_dispatch_failed', async () => {
    const { enrollment, preparation } = await setUpReadyReservation(
      'c2c-commit-mismatch-result',
      'run-c2c-commit-mismatch-result',
    );

    const weirdReceiptsRepo = {
      dispatchAndFinalizeReceiptAsync: async () => ({
        status: 'binding_mismatch',
        receipt: null,
        enrollment,
      }),
    } as unknown as AgentOrgTreatmentReceiptsRepository;

    await expect(
      commitReservedTreatmentDispatch(enrollment, preparation, { receiptsRepo: weirdReceiptsRepo }),
    ).rejects.toMatchObject({ name: 'TreatmentDispatchCommitError', reason: 'pre_dispatch_failed' });
  });

  it('never leaks the run episode id, profile id, or prompt bytes in the thrown error', async () => {
    const profileId = 'c2c-commit-no-leak';
    const { enrollment, preparation } = await setUpReadyReservation(profileId, 'run-c2c-commit-no-leak');
    new AgentConfigsRepository().update(profileId, { systemPrompt: 'drifted-prompt-should-never-leak' });

    let caught: unknown;
    try {
      await commitReservedTreatmentDispatch(enrollment, preparation);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TreatmentDispatchCommitError);
    expect(String(caught)).not.toContain(enrollment.runEpisodeId);
    expect(String(caught)).not.toContain(profileId);
    expect(String(caught)).not.toContain('drifted-prompt-should-never-leak');
  });

  it('never re-derives or trusts caller-supplied treatment material — it only takes an enrollment plus its own fresh preparation', () => {
    // Structural guarantee: the function signature has no `opts`/spec/prompt
    // parameter through which a caller could inject an alternate treatment —
    // only the real reservation plus the exact initial preparation it must
    // reproduce. Pinned via arity rather than a runtime probe.
    expect(commitReservedTreatmentDispatch.length).toBe(2);
  });
});

/**
 * C3 — treatment-bound outcomes, executable metrics, and guardrails
 * (docs/ai/contracts/issue-causal-runtime-v2.json, phase C3).
 *
 * Fixed-format fake hashes: these tests reserve+dispatch+finalize receipts
 * directly through the real repositories (not the full C2 prepare/dispatch
 * boundary), so they need placeholder hashes that still satisfy the
 * receipts table's own CHECK constraints (sha256:<64hex> / bare 64hex).
 */
const C3_FAKE_TARGET_REVISION_HASH = `sha256:${'d'.repeat(64)}`;
const C3_FAKE_TREATMENT_SPEC_HASH = 'e'.repeat(64);
const C3_FAKE_EFFECTIVE_PROMPT_HASH = 'f'.repeat(64);

/** Reserve, dispatch, and finalize a real treatment receipt for one cohort member, then finalize its outcome. */
async function seedReceiptBackedOutcome(params: {
  experimentId: string;
  proposalId: string;
  profileId: string;
  cohort: 'baseline' | 'candidate';
  runEpisodeId: string;
  success: boolean;
}): Promise<void> {
  const enrollmentsRepo = new AgentOrgExperimentEnrollmentsRepository();
  await enrollmentsRepo.reserveAsync({
    maxExposure: 1000,
    runEpisodeId: params.runEpisodeId,
    experimentId: params.experimentId,
    proposalId: params.proposalId,
    profileId: params.profileId,
    cohort: params.cohort,
    assignmentDigest: `digest-${params.runEpisodeId}`,
    baselineTargetRevisionHash: C3_FAKE_TARGET_REVISION_HASH,
    treatmentSpecHash: C3_FAKE_TREATMENT_SPEC_HASH,
  });
  const receiptsRepo = new AgentOrgTreatmentReceiptsRepository();
  const result = await receiptsRepo.dispatchAndFinalizeReceiptAsync(params.runEpisodeId, {
    profileRevision: 1,
    targetRef: `agent_config:${params.profileId}`,
    targetRevisionHash: C3_FAKE_TARGET_REVISION_HASH,
    treatmentSpecHash: C3_FAKE_TREATMENT_SPEC_HASH,
    effectivePromptHash: C3_FAKE_EFFECTIVE_PROMPT_HASH,
  });
  if (result.status !== 'applied') {
    throw new Error(`test setup: expected receipt to apply, got '${result.status}'`);
  }
  await new AgentRunOutcomesRepository().finalizeAsync({
    rootSessionId: params.runEpisodeId,
    runEpisodeId: params.runEpisodeId,
    proposalId: params.proposalId,
    experimentVariant: params.cohort,
    terminalStatus: 'completed',
    objectiveVerdict: params.success ? 'success' : 'failure',
    objectiveEvidence: {
      producedArtifact: params.success,
      errorCount: params.success ? 0 : 1,
      approvalDenied: false,
    },
  });
}

describe('C3-1 promote is re-enabled once treatment-v2 receipts prove the effect', () => {
  it('reaches promote/verified when receipt-backed cohorts independently satisfy the stopping rule', async () => {
    // Bug this catches: the C0 gate that blanket-refused every promote for
    // 'paired-cohort-outcome' must not become a PERMANENT block — once real
    // treatment receipts exist and reproduce the effect, promote must be
    // reachable again (C2's own "re-enable promote... through the
    // receipt-filtered treatment-v2 path" requirement).
    const proposalId = 'prop-c3-promote';
    await new AgentOrgProposalsRepository().createAsync({
      id: proposalId,
      kind: 'refine-skill',
      risk: 'low',
      title: 'a candidate worth measuring',
    });
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, makeValidBundle(), { proposalId });

    for (let i = 0; i < 20; i += 1) {
      await seedReceiptBackedOutcome({
        experimentId: exp.id,
        proposalId,
        profileId: 'profile-c3-promote',
        cohort: 'baseline',
        runEpisodeId: `c3-promote-b-${i}`,
        success: i < 10, // 50%
      });
      await seedReceiptBackedOutcome({
        experimentId: exp.id,
        proposalId,
        profileId: 'profile-c3-promote',
        cohort: 'candidate',
        runEpisodeId: `c3-promote-c-${i}`,
        success: i < 18, // 90%
      });
    }

    const judged = await judgeExperimentAsync(exp.id);
    if (judged.status !== 'decided') throw new Error('expected a terminal decision');
    expect(judged.decision).toBe('promote');
    expect(judged.reason).toMatch(/objective-success-rate/);

    const proposal = await new AgentOrgProposalsRepository().findByIdAsync(proposalId);
    expect(proposal!.outcomeStatus).toBe('verified');
  });

  it('still refuses promote when the raw comparison favors it but NO receipts back the cohorts', async () => {
    // Regression guard for the existing C0 behavior: an unfiltered A/A-shaped
    // effect (no receipts at all) must still be refused, not silently
    // promoted just because SOME cohort read might now succeed.
    const proposalId = 'prop-c3-no-receipts';
    await new AgentOrgProposalsRepository().createAsync({
      id: proposalId,
      kind: 'refine-skill',
      risk: 'low',
      title: 'a candidate worth measuring',
    });
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, makeValidBundle(), { proposalId });
    const outcomes = new AgentRunOutcomesRepository();
    for (let i = 0; i < 20; i += 1) {
      await outcomes.finalizeAsync({
        rootSessionId: `c3-noreceipt-b-${i}`,
        proposalId,
        experimentVariant: 'baseline',
        terminalStatus: 'completed',
        objectiveVerdict: i < 10 ? 'success' : 'failure',
        objectiveEvidence: { producedArtifact: i < 10, errorCount: i < 10 ? 0 : 1, approvalDenied: false },
      });
      await outcomes.finalizeAsync({
        rootSessionId: `c3-noreceipt-c-${i}`,
        proposalId,
        experimentVariant: 'candidate',
        terminalStatus: 'completed',
        objectiveVerdict: i < 18 ? 'success' : 'failure',
        objectiveEvidence: { producedArtifact: i < 18, errorCount: i < 18 ? 0 : 1, approvalDenied: false },
      });
    }

    const judged = await judgeExperimentAsync(exp.id);
    if (judged.status !== 'decided') throw new Error('expected a terminal decision');
    expect(judged.decision).toBe('inconclusive');
    expect(judged.reason).toMatch(/treatment-v2/i);

    const proposal = await new AgentOrgProposalsRepository().findByIdAsync(proposalId);
    expect(proposal!.outcomeStatus).toBe('inconclusive');
  });
});

describe('C3-4 explicit-user-verdict-rate: a separate typed metric adapter over append-only feedback', () => {
  function feedbackBundle(minResponseCoverage: number): ProposalEvidenceBundle {
    return {
      ...makeValidBundle(),
      primaryMetric: { name: 'explicit-user-verdict-rate', direction: 'increase', minResponseCoverage },
    };
  }

  async function seedRun(params: {
    proposalId: string;
    cohort: 'baseline' | 'candidate';
    rootSessionId: string;
    verdict?: 'success' | 'partial' | 'failure';
    reason?: string;
  }): Promise<void> {
    await new AgentRunOutcomesRepository().finalizeAsync({
      rootSessionId: params.rootSessionId,
      proposalId: params.proposalId,
      experimentVariant: params.cohort,
      terminalStatus: 'completed',
      objectiveVerdict: 'inconclusive',
      objectiveEvidence: { producedArtifact: null, errorCount: null, approvalDenied: null },
    });
    if (params.verdict) {
      await new AgentRunOutcomesRepository().appendFeedbackAsync({
        rootSessionId: params.rootSessionId,
        source: 'explicit_user',
        verdict: params.verdict,
        confidence: 1,
        reason: params.reason ?? null,
      });
    }
  }

  it('promotes on a real response-rate effect, once treatment-v2 receipts back both cohorts and coverage clears the predeclared minimum', async () => {
    const proposalId = 'prop-c3-feedback-promote';
    await new AgentOrgProposalsRepository().createAsync({
      id: proposalId,
      kind: 'refine-skill',
      risk: 'low',
      title: 'x',
    });
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, feedbackBundle(0.5), { proposalId });

    // Baseline: 10 receipt-backed runs, all responded, all 'failure' (score 0).
    for (let i = 0; i < 10; i += 1) {
      const runEpisodeId = `c3-fb-b-${i}`;
      await seedReceiptBackedOutcome({
        experimentId: exp.id,
        proposalId,
        profileId: 'profile-c3-feedback',
        cohort: 'baseline',
        runEpisodeId,
        success: false,
      });
      await new AgentRunOutcomesRepository().appendFeedbackAsync({
        rootSessionId: runEpisodeId,
        source: 'explicit_user',
        verdict: 'failure',
        confidence: 1,
      });
    }
    // Candidate: 10 receipt-backed runs, all responded, all 'success' (score 1).
    for (let i = 0; i < 10; i += 1) {
      const runEpisodeId = `c3-fb-c-${i}`;
      await seedReceiptBackedOutcome({
        experimentId: exp.id,
        proposalId,
        profileId: 'profile-c3-feedback',
        cohort: 'candidate',
        runEpisodeId,
        success: true,
      });
      await new AgentRunOutcomesRepository().appendFeedbackAsync({
        rootSessionId: runEpisodeId,
        source: 'explicit_user',
        verdict: 'success',
        confidence: 1,
      });
    }

    const judged = await judgeExperimentAsync(exp.id);
    if (judged.status !== 'decided') throw new Error('expected a terminal decision');
    expect(judged.decision).toBe('promote');
    expect(judged.reason).toMatch(/explicit-user-verdict-rate/);
    expect(judged.results!.baseline.responseRate).toBe(1);
    expect(judged.results!.candidate.responseRate).toBe(1);

    const proposal = await new AgentOrgProposalsRepository().findByIdAsync(proposalId);
    expect(proposal!.outcomeStatus).toBe('verified');
  });

  it('stays collecting (never guesses a zero) while response coverage is below the predeclared minimum', async () => {
    const proposalId = 'prop-c3-feedback-coverage';
    await new AgentOrgProposalsRepository().createAsync({
      id: proposalId,
      kind: 'refine-skill',
      risk: 'low',
      title: 'x',
    });
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, feedbackBundle(0.8), { proposalId, maxExposure: 1000 });

    // 10 runs per cohort, but only 2 responded each — 20% coverage, below the 80% minimum.
    for (let i = 0; i < 10; i += 1) {
      await seedRun({
        proposalId,
        cohort: 'baseline',
        rootSessionId: `c3-fbcov-b-${i}`,
        verdict: i < 2 ? 'failure' : undefined,
      });
      await seedRun({
        proposalId,
        cohort: 'candidate',
        rootSessionId: `c3-fbcov-c-${i}`,
        verdict: i < 2 ? 'success' : undefined,
      });
    }

    const judged = await computeDecisionAsync(exp);
    expect(judged.status).toBe('collecting');
    expect(judged.reason).toMatch(/response rate/i);
  });

  it('refuses promotion on a material response-rate imbalance between arms, never regress', async () => {
    const proposalId = 'prop-c3-feedback-imbalance';
    await new AgentOrgProposalsRepository().createAsync({
      id: proposalId,
      kind: 'refine-skill',
      risk: 'low',
      title: 'x',
    });
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await declare(experiments, feedbackBundle(0.1), { proposalId, maxExposure: 1000 });

    const FEEDBACK_SECRET = 'it kept using sk-ant-api03-totallyFakeSecretValue and my board notes';

    // Baseline: 10 runs, ALL respond 'success' (rate 1.0, response rate 100%).
    for (let i = 0; i < 10; i += 1) {
      await seedRun({
        proposalId,
        cohort: 'baseline',
        rootSessionId: `c3-fbimb-b-${i}`,
        verdict: 'success',
        reason: i === 0 ? FEEDBACK_SECRET : undefined,
      });
    }
    // Candidate: 10 runs, only 2 respond (both 'success') — response rate 20%,
    // a 80-point gap from baseline's 100%. Candidate's OWN average looks
    // perfect (1.0), which is exactly the confound this gate exists to catch.
    for (let i = 0; i < 10; i += 1) {
      await seedRun({
        proposalId,
        cohort: 'candidate',
        rootSessionId: `c3-fbimb-c-${i}`,
        verdict: i < 2 ? 'success' : undefined,
      });
    }

    const judged = await computeDecisionAsync(exp);
    if (judged.status !== 'decided') throw new Error('expected a terminal decision');
    expect(judged.decision).toBe('inconclusive');
    expect(judged.reason).toMatch(/response-rate imbalance/i);
    // C3-7 — the result payload names only rates/percentages, never the raw
    // free-form feedback reason a human typed (which may carry secrets).
    expect(judged.reason).not.toContain(FEEDBACK_SECRET);
    expect(JSON.stringify(judged.results)).not.toContain(FEEDBACK_SECRET);
  });
});

describe('C3-6 guardrail breach stops new enrollment atomically', () => {
  it('refuses a new reservation and records a terminal regress once treatment-integrity-failure-rate breaches', async () => {
    const profileId = 'c3-guardrail-integrity';
    const { hash } = profileTargetFingerprint(profileId);
    const exp = await declareC1Experiment(profileId, {
      bundle: { ...bundleForProfile(profileId, hash), guardrails: ['treatment-integrity-failure-rate'] },
      baselineSpec: systemPromptSpec(profileId, {}, hash),
      candidateSpec: systemPromptSpec(profileId, { candidateValue: 'after' }, hash),
      stoppingRule: { minSamplesPerCohort: 5, minEffect: 0.05 },
    });

    // 3 healthy reservations, then 2 that fail pre-dispatch: 2/5 = 40% > the
    // 30% treatment-integrity-failure-rate ceiling.
    for (let i = 0; i < 3; i += 1) {
      const enrollment = await reserveRunEnrollment(`c3-integrity-ok-${i}`, profileId);
      expect(enrollment).not.toBeNull();
    }
    for (let i = 0; i < 2; i += 1) {
      const enrollment = await reserveRunEnrollment(`c3-integrity-fail-${i}`, profileId);
      expect(enrollment).not.toBeNull();
      await markRunEnrollmentPreDispatchFailed(`c3-integrity-fail-${i}`);
    }

    const refused = await reserveRunEnrollment('c3-integrity-next', profileId);
    expect(refused).toBeNull();

    const stored = await new AgentOrgExperimentsRepository().findByIdAsync(exp.id);
    expect(stored!.decision).toBe('regress');
    expect(stored!.decisionReason).toMatch(/treatment-integrity-failure-rate/);
    // C3-7 — the recorded reason never carries the raw profile id.
    expect(stored!.decisionReason).not.toContain(profileId);

    // Guardrail enforcement never mutates the durable target.
    const profile = new AgentConfigsRepository().getById(profileId);
    expect(profile!.systemPrompt).toBe('before');

    // Once stopped, the experiment stays stopped for a later reservation attempt too.
    const refusedAgain = await reserveRunEnrollment('c3-integrity-next-2', profileId);
    expect(refusedAgain).toBeNull();
  });

  it('does not stop enrollment for a healthy experiment with no guardrail breach', async () => {
    const profileId = 'c3-guardrail-healthy';
    const { hash } = profileTargetFingerprint(profileId);
    await declareC1Experiment(profileId, {
      bundle: bundleForProfile(profileId, hash),
      baselineSpec: systemPromptSpec(profileId, {}, hash),
      candidateSpec: systemPromptSpec(profileId, { candidateValue: 'after' }, hash),
      stoppingRule: { minSamplesPerCohort: 5, minEffect: 0.05 },
    });

    for (let i = 0; i < 6; i += 1) {
      const enrollment = await reserveRunEnrollment(`c3-healthy-${i}`, profileId);
      expect(enrollment).not.toBeNull();
    }
  });
});
