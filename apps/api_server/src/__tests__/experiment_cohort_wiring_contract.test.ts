/**
 * CONTRACT TEST — `verified` is reachable through the PRODUCTION path.
 *
 * W6 shipped the controlled-experiment gate with an explicit limitation: no
 * production caller declared, assigned or judged an experiment, so
 * `agent_org_proposals.outcome_status` could never hold `verified` outside the
 * test suite. This file proves that limitation is closed, and it deliberately
 * refuses to prove it by calling the experiment service directly — every step
 * goes through the shipping surface:
 *
 *   declare  → OrgProposalsController.declareExperiment (POST /:id/experiment)
 *   assign   → recordTerminalOutcome, the W4 terminal hook every run funnels
 *              through (opencode_stream_bridge.ts × 3, agent_runner.ts × 2)
 *   judge    → runOrgOptimizer, the loop the cron/route actually invokes
 *
 * Nothing here touches judgeExperimentAsync, assignSubjectAsync or
 * decideExperiment. If the wiring between those three surfaces is removed, this
 * file goes red — which is the point.
 */

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { AgentConfigsRepository, type RevisionedAgentConfig } from '../repositories/agent_configs_repository';
import { OrgProposalsController } from '../controllers/org_proposals_controller';
import {
  assignCohort,
  reserveRunEnrollment,
  markRunEnrollmentDispatched,
} from '../services/org_proposal_experiment_service';
import { recordTerminalOutcome } from '../services/run_outcome_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';

const TEST_PROFILE_ID = 'test-profile';
const BASELINE_SYSTEM_PROMPT = 'You are the nightly recipe agent (baseline).';
const CANDIDATE_SYSTEM_PROMPT = 'You are the nightly recipe agent (refined candidate).';
const PROFILE_TARGET_REF = `agent_config:${TEST_PROFILE_ID}`;

/**
 * Mirrors the canonical hashing pattern in
 * org_proposal_experiment_service.test.ts (lines 69-145) — this is a
 * test-only recomputation of the production durable target fingerprint, not
 * a new export from production code.
 */
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

function durableTargetFingerprint(profile: RevisionedAgentConfig): string {
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

function systemPromptSpec(candidateValue: string, profileTargetHash: string): Record<string, unknown> {
  return {
    agentConfigId: TEST_PROFILE_ID,
    field: 'system_prompt',
    priorValue: BASELINE_SYSTEM_PROMPT,
    currentValue: BASELINE_SYSTEM_PROMPT,
    candidateValue,
    evidenceTarget: { ref: PROFILE_TARGET_REF, hash: profileTargetHash },
  };
}

let profileTargetHash: string;

// The optimizer run loop builds an audit snapshot from the engine. Same mock
// shape the other full-loop contract tests use (issue_936_contract.test.ts).
const listMcp = vi.fn();
const listSkills = vi.fn();

vi.mock('../services/opencode_engine', () => ({
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

const ASSIGNMENT_KEY = 'experiment-cohort-wiring-fixture';

/** A complete, current-version, promotion-capable bundle. */
function bundle(): Record<string, unknown> {
  return {
    version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
    sourceEvidence: { sessionIds: ['seed-session'], eventIds: ['seed-event'] },
    counterEvidenceSearch: {
      query: 'contradicting evidence for the recipe refinement',
      searchedAt: new Date().toISOString(),
      contradictingCount: 0,
    },
    target: { ref: PROFILE_TARGET_REF, hash: profileTargetHash },
    expectedOutcome: 'more runs reach an objective success verdict',
    primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
    guardrails: ['terminal-error-rate'],
    experimentAdapter: 'paired-cohort-outcome',
    rollbackRule: 'restore before_snapshot_json',
    generatorVersion: 'recipe-generator-v1',
    confidenceCalibrationVersion: 'calibration-v1',
  };
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function session(id: string): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_kind, cwd, name, parent_session_id)
       VALUES (?, 'build', '/tmp', ?, NULL)`,
    )
    .run(id, id);
}

async function seedProposal(): Promise<string> {
  // C2-B: a reservable/preparable treatment must be backed by an EXACT
  // strict refine-config proposal row bound to this profile/field/candidate
  // value, not merely an experiment whose specs happen to validate alone.
  const created = await new AgentOrgProposalsRepository().createAsync({
    kind: 'refine-config',
    risk: 'low',
    status: 'active',
    title: 'refine the nightly recipe agent prompt',
    targetRef: PROFILE_TARGET_REF,
    changeJson: JSON.stringify({
      configPatch: { agentConfigId: TEST_PROFILE_ID, field: 'system_prompt', value: CANDIDATE_SYSTEM_PROMPT },
    }),
  });
  return created.id;
}

/** Drive the operator's declare route. Returns the created experiment row. */
async function declareViaRoute(
  proposalId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; body: unknown }> {
  const controller = new OrgProposalsController();
  const captured: { status: number; body: unknown } = { status: 200, body: null };
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;
  let thrown: unknown = null;
  const next = ((err: unknown) => {
    thrown = err;
  }) as NextFunction;
  await controller.declareExperiment(
    {
      params: { id: proposalId },
      body: {
        evidenceBundle: bundle(),
        baselineSpec: systemPromptSpec(BASELINE_SYSTEM_PROMPT, profileTargetHash),
        candidateSpec: systemPromptSpec(CANDIDATE_SYSTEM_PROMPT, profileTargetHash),
        assignmentKey: ASSIGNMENT_KEY,
        stoppingRule: { minSamplesPerCohort: 3, minEffect: 0.2 },
        maxExposure: 100,
        ...overrides,
      },
    } as unknown as Request,
    res,
    next,
  );
  if (thrown) throw thrown;
  return captured;
}

/**
 * Sessions labelled by what the deterministic assignment key WILL produce for
 * them. The test never writes the cohort — it only arranges for the candidate
 * arm's runs to succeed and the baseline arm's to fail, so a real effect exists
 * for the gate to find. If the wiring stops labelling rows, the cohorts are
 * empty and no arrangement here can rescue the decision.
 */
function sessionsPerCohort(count: number): { baseline: string[]; candidate: string[] } {
  const baseline: string[] = [];
  const candidate: string[] = [];
  for (let i = 0; baseline.length < count || candidate.length < count; i++) {
    const id = `run-${i}`;
    const arm = assignCohort(ASSIGNMENT_KEY, id) === 'baseline' ? baseline : candidate;
    if (arm.length < count) arm.push(id);
  }
  return { baseline, candidate };
}

/** C1: reserve enrollment before dispatch. */
async function reserveRun(sessionId: string): Promise<Awaited<ReturnType<typeof reserveRunEnrollment>>> {
  session(sessionId);
  return reserveRunEnrollment(sessionId, TEST_PROFILE_ID);
}

/**
 * Mirror the shipped AgentRunner lifecycle: a reserved run is marked
 * dispatched before the prompt runs — reserved -> terminalized directly is
 * an illegal transition the B1 guard rejects. Overflow/refused runs never
 * reserved (reservation === null) must not be marked. This is the only
 * dispatch simulation in this file.
 */
async function finishRun(
  sessionId: string,
  reservation: Awaited<ReturnType<typeof reserveRunEnrollment>>,
  succeeded: boolean,
): Promise<void> {
  if (reservation) {
    const transition = await markRunEnrollmentDispatched(sessionId);
    if (transition.status !== 'applied' && transition.status !== 'no_op') {
      throw new Error(
        `driveRun fixture: expected reserved->dispatched to apply or no-op, got "${transition.status}" for ${sessionId}`,
      );
    }
  }
  await recordTerminalOutcome({
    sessionId,
    terminalStatus: succeeded ? 'completed' : 'error',
    evidence: {
      producedArtifact: succeeded,
      errorCount: succeeded ? 0 : 1,
      approvalDenied: false,
    },
  });
}

async function driveRun(sessionId: string, succeeded: boolean): Promise<void> {
  const reservation = await reserveRun(sessionId);
  await finishRun(sessionId, reservation, succeeded);
}

let originalTreatmentV2Enabled: boolean;

beforeEach(() => {
  setDb(makeDb());
  listMcp.mockReset().mockResolvedValue({});
  listSkills.mockReset().mockResolvedValue([]);
  delete process.env.RHYTHM_OPTIMIZER_MODE;
  // C6 item 1 — this suite exercises the real reserve/prepare/commit chain
  // through the shipping surfaces, which now requires treatment-v2 enabled.
  originalTreatmentV2Enabled = env.treatmentV2Enabled;
  env.treatmentV2Enabled = true;

  const profile = new AgentConfigsRepository().insert({
    id: TEST_PROFILE_ID,
    label: TEST_PROFILE_ID,
    icon: 'x',
    systemPrompt: BASELINE_SYSTEM_PROMPT,
  });
  profileTargetHash = durableTargetFingerprint(profile);
});

afterEach(() => {
  env.treatmentV2Enabled = originalTreatmentV2Enabled;
});

describe('the terminal hook assigns a cohort before the ledger row is written', () => {
  it('labels finalized runs with a proposal and a variant, and produces both arms', async () => {
    const proposalId = await seedProposal();
    await declareViaRoute(proposalId);

    const { baseline, candidate } = sessionsPerCohort(3);
    for (const id of [...baseline, ...candidate]) await driveRun(id, true);

    const enrolled = await new AgentRunOutcomesRepository().listByExperimentAsync(proposalId);
    expect(enrolled).toHaveLength(6);
    expect(enrolled.filter((o) => o.experimentVariant === 'baseline')).toHaveLength(3);
    expect(enrolled.filter((o) => o.experimentVariant === 'candidate')).toHaveLength(3);
  });

  it('records a subject refused by the exposure cap as NOT in the experiment', async () => {
    const proposalId = await seedProposal();
    await declareViaRoute(proposalId, { maxExposure: 2 });

    // The C1 cap is atomic over CONCURRENT commitment (reserved/dispatched,
    // not lifetime totals — see agent_org_experiment_enrollments_repository's
    // COUNT_ACTIVE), so the reservations must be interleaved before any of
    // them finalizes: reserving all four while the first two are still
    // in-flight is what actually exercises the cap.
    const ids = ['cap-a', 'cap-b', 'cap-c', 'cap-d'];
    const reservations = new Map<string, Awaited<ReturnType<typeof reserveRun>>>();
    for (const id of ids) reservations.set(id, await reserveRun(id));
    for (const id of ids) await finishRun(id, reservations.get(id) ?? null, true);

    const outcomes = new AgentRunOutcomesRepository();
    // Exactly the cap is enrolled; the overflow rows exist but carry no cohort,
    // so they can never be counted into either arm.
    expect(await outcomes.listByExperimentAsync(proposalId)).toHaveLength(2);
    for (const id of ids) {
      const view = await outcomes.findByRootSessionIdAsync(id);
      expect(view).not.toBeNull();
    }
    const unlabelled = (
      getDb()
        .prepare(
          `SELECT COUNT(*) AS n FROM agent_run_outcomes
            WHERE experiment_variant IS NULL AND proposal_id IS NULL`,
        )
        .get() as { n: number }
    ).n;
    expect(unlabelled).toBe(2);
  });

  it('never enrolls a run while the optimizer is off', async () => {
    const proposalId = await seedProposal();
    await declareViaRoute(proposalId);
    process.env.RHYTHM_OPTIMIZER_MODE = 'off';

    await driveRun('off-run', true);

    expect(await new AgentRunOutcomesRepository().listByExperimentAsync(proposalId)).toHaveLength(0);
  });
});

describe('verified is reachable end to end through the production loop', () => {
  async function driveAnEffect(): Promise<string> {
    const proposalId = await seedProposal();
    await declareViaRoute(proposalId);
    const { baseline, candidate } = sessionsPerCohort(3);
    for (const id of baseline) await driveRun(id, false);
    for (const id of candidate) await driveRun(id, true);
    return proposalId;
  }

  it(
    'C0 — a synthetic paired-cohort-outcome effect cannot stamp verified without treatment-v2 receipts',
    async () => {
      const proposalId = await driveAnEffect();

      const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
      const result = await runOrgOptimizer({ mode: 'auto' });

      // The randomised split favoured the candidate arm, but nothing applied a
      // per-run treatment (C1/C2 do not exist yet): this is causally an A/A
      // result, and the fail-closed gate refuses to call it verified.
      expect(result.experiments).toEqual({
        judged: 1,
        promoted: 0,
        regressed: 0,
        inconclusive: 1,
        collecting: 0,
      });
      expect(result.experimentsReportOnly).toBeUndefined();

      const proposal = await new AgentOrgProposalsRepository().findByIdAsync(proposalId);
      expect(proposal?.outcomeStatus).toBe('inconclusive');
      // W6-c8 — the DEPLOYMENT field is untouched by the outcome write.
      expect(proposal?.status).toBe('active');
    },
  );

  it('the mirror fixture — candidate worse than baseline — reaches regressed', async () => {
    const proposalId = await seedProposal();
    await declareViaRoute(proposalId);
    const { baseline, candidate } = sessionsPerCohort(3);
    for (const id of baseline) await driveRun(id, true);
    for (const id of candidate) await driveRun(id, false);

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const result = await runOrgOptimizer({ mode: 'auto' });

    expect(result.experiments?.regressed).toBe(1);
    const proposal = await new AgentOrgProposalsRepository().findByIdAsync(proposalId);
    expect(proposal?.outcomeStatus).toBe('regressed');
  });

  it('shadow mode reports the same C0-gated verdict and writes nothing', async () => {
    const proposalId = await driveAnEffect();

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const result = await runOrgOptimizer({ mode: 'shadow' });

    expect(result.experimentsReportOnly).toBe(true);
    // Shadow's report-only sweep shares computeDecisionAsync with the acting
    // path, so it is truthful about the C0 fail-closed gate too: it would NOT
    // have promoted, because paired-cohort-outcome has no treatment-v2 proof.
    expect(result.experiments?.promoted).toBe(0);
    expect(result.experiments?.inconclusive).toBe(1);

    const proposal = await new AgentOrgProposalsRepository().findByIdAsync(proposalId);
    expect(proposal?.outcomeStatus).toBe('unproven');
    const experiments = getDb()
      .prepare(`SELECT decision, results_json FROM agent_org_experiments`)
      .all() as Array<{ decision: string | null; results_json: string | null }>;
    expect(experiments).toEqual([{ decision: null, results_json: null }]);
  });
});

describe('the declare route is a gate, not a pass-through', () => {
  it('refuses an invalid evidence bundle before anything is stored', async () => {
    const proposalId = await seedProposal();
    const incomplete = bundle();
    delete incomplete.counterEvidenceSearch;

    await expect(declareViaRoute(proposalId, { evidenceBundle: incomplete })).rejects.toThrow(
      /counterEvidenceSearch|counter-evidence/i,
    );
    expect(
      (getDb().prepare(`SELECT COUNT(*) AS n FROM agent_org_experiments`).get() as { n: number }).n,
    ).toBe(0);
  });

  it('refuses a proxy adapter that cannot establish verified improvement', async () => {
    const proposalId = await seedProposal();
    const proxy = { ...bundle(), experimentAdapter: 'llm-body-score' };
    const declared = await declareViaRoute(proposalId, { evidenceBundle: proxy });
    expect(declared.status).toBe(201);

    const { baseline, candidate } = sessionsPerCohort(3);
    for (const id of baseline) await driveRun(id, false);
    for (const id of candidate) await driveRun(id, true);

    const { runOrgOptimizer } = await import('../services/org_optimizer_run_service');
    const result = await runOrgOptimizer({ mode: 'auto' });

    expect(result.experiments?.promoted).toBe(0);
    expect(result.experiments?.inconclusive).toBe(1);
    const proposal = await new AgentOrgProposalsRepository().findByIdAsync(proposalId);
    expect(proposal?.outcomeStatus).toBe('inconclusive');
  });
});
