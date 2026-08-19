/**
 * C5-5 — the operator declaration route accepts a builder-produced bundle
 * and STILL accepts an explicit operator bundle after the same validation
 * (contract docs/ai/contracts/issue-causal-runtime-v2.json, phase C5,
 * requirement 5).
 *
 * Drives the real production surface — `OrgProposalsController.
 * declareExperiment` (POST /agent-org-proposals/:id/experiment) — never the
 * builder function directly, so this proves the WIRING, not just that the
 * builder itself works (that is proposal_evidence_builder.test.ts's job).
 */

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentRunOutcomesRepository } from '../repositories/agent_run_outcomes_repository';
import { OrgProposalsController } from '../controllers/org_proposals_controller';
import { toProfileTargetRef } from '../services/org_proposal_experiment_service';
import { buildAttribution } from '../services/run_outcome_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';

const PROFILE_ID = 'nightly-recipe-agent';
const BASELINE_PROMPT = 'You are the nightly recipe agent (baseline).';
const CANDIDATE_PROMPT = 'You are the nightly recipe agent (refined candidate).';
const PROFILE_TARGET_REF = toProfileTargetRef(PROFILE_ID);

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

async function seedProposal(): Promise<string> {
  const created = await new AgentOrgProposalsRepository().createAsync({
    kind: 'refine-config',
    risk: 'high',
    status: 'proposed',
    title: 'refine the nightly recipe agent prompt',
    targetRef: PROFILE_TARGET_REF,
    changeJson: JSON.stringify({
      configPatch: { agentConfigId: PROFILE_ID, field: 'system_prompt', value: CANDIDATE_PROMPT },
    }),
  });
  return created.id;
}

async function declare(
  proposalId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown; thrown: unknown }> {
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
    { params: { id: proposalId }, body } as unknown as Request,
    res,
    next,
  );
  return { ...captured, thrown };
}

const DECLARE_PLUMBING = {
  baselineSpec: null,
  candidateSpec: null,
  assignmentKey: 'c5-route-wiring-fixture',
  stoppingRule: { minSamplesPerCohort: 3, minEffect: 0.2 },
  maxExposure: 100,
};

beforeEach(() => {
  setDb(makeDb());
  new AgentConfigsRepository().insert({
    id: PROFILE_ID,
    label: PROFILE_ID,
    icon: 'x',
    systemPrompt: BASELINE_PROMPT,
  });
});

describe('C5-5 declareExperiment builds evidence automatically when none is supplied', () => {
  it('declares successfully from a builder-produced bundle when the operator omits evidenceBundle', async () => {
    await new AgentRunOutcomesRepository().finalizeAsync({
      rootSessionId: 'ses-bad-1',
      sessionId: 'ses-bad-1',
      profileId: PROFILE_ID,
      terminalStatus: 'error',
      objectiveVerdict: 'failure',
      objectiveEvidence: { producedArtifact: false, errorCount: 1, approvalDenied: false },
      attribution: buildAttribution(),
    });
    const proposalId = await seedProposal();

    const result = await declare(proposalId, { ...DECLARE_PLUMBING });
    expect(result.thrown).toBeNull();
    expect(result.status).toBe(201);

    const stored = getDb()
      .prepare(`SELECT evidence_bundle_json FROM agent_org_experiments WHERE proposal_id = ?`)
      .get(proposalId) as { evidence_bundle_json: string };
    const storedBundle = JSON.parse(stored.evidence_bundle_json);
    expect(storedBundle.version).toBe('proposal-evidence-v2');
  });

  it('refuses with a clear reason when no bundle is supplied and none can be built (no qualifying facts)', async () => {
    const proposalId = await seedProposal();

    const result = await declare(proposalId, { ...DECLARE_PLUMBING });
    expect(result.status).toBe(200); // never reached — thrown short-circuits before res.status
    expect(result.thrown).toBeTruthy();
    expect(String((result.thrown as Error).message)).toMatch(/no evidence bundle|no qualifying/i);

    expect(
      (getDb().prepare(`SELECT COUNT(*) AS n FROM agent_org_experiments`).get() as { n: number }).n,
    ).toBe(0);
  });

  it('still accepts an explicit operator-supplied bundle unchanged — the builder is a fallback, not a replacement', async () => {
    const proposalId = await seedProposal();
    const operatorBundle = {
      version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
      sourceEvidence: { sessionIds: ['seed-session'], eventIds: ['seed-event'] },
      counterEvidenceSearch: {
        query: 'operator-typed counter-evidence search',
        searchedAt: new Date().toISOString(),
        contradictingCount: 0,
      },
      target: { ref: PROFILE_TARGET_REF, hash: 'sha256:doesnotmatter-for-this-declare-only-check' },
      expectedOutcome: 'more runs reach an objective success verdict',
      primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
      guardrails: ['terminal-error-rate'],
      experimentAdapter: 'paired-cohort-outcome',
      rollbackRule: 'restore before_snapshot_json',
      generatorVersion: 'operator-hand-typed',
      confidenceCalibrationVersion: 'calibration-v1',
    };

    const result = await declare(proposalId, { ...DECLARE_PLUMBING, evidenceBundle: operatorBundle });
    expect(result.thrown).toBeNull();
    expect(result.status).toBe(201);

    const stored = getDb()
      .prepare(`SELECT evidence_bundle_json FROM agent_org_experiments WHERE proposal_id = ?`)
      .get(proposalId) as { evidence_bundle_json: string };
    expect(JSON.parse(stored.evidence_bundle_json).generatorVersion).toBe('operator-hand-typed');
  });
});
