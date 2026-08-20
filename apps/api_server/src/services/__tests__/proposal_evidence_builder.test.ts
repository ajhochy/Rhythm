/**
 * C5 — the deterministic evidence builder (contract
 * docs/ai/contracts/issue-causal-runtime-v2.json, phase C5, requirements
 * 2-4).
 *
 * Proves:
 *  - a real refine-config (system-prompt-v1) proposal with qualifying prior
 *    facts for its target profile gets a proposal-evidence-v2 bundle whose
 *    target identity/revision/hash is EXACTLY the durable state (the same
 *    fingerprint org_proposal_experiment_service.ts's own eligibility check
 *    recomputes), whose source fact ids are real ledger rows, and whose
 *    counter-evidence search is typed and records real coverage;
 *  - every named failure mode (no qualifying facts, missing target state,
 *    a non-refine-config kind, an unresolvable change patch) leaves the
 *    proposal unexperimentable rather than inventing evidence — never a
 *    thrown exception, never a fabricated bundle;
 *  - no proposal GENERATOR fabricates source ids/target snapshots/counter-
 *    evidence/calibration metadata itself (requirement 2) — only this
 *    builder (or an explicit human operator) may ever produce one.
 */

import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { AgentRunOutcomesRepository } from '../../repositories/agent_run_outcomes_repository';
import { buildAttribution } from '../run_outcome_service';
import { toProfileTargetRef, buildProfileRevisionFingerprint } from '../org_proposal_experiment_service';
import { validateEvidenceBundle } from '../proposal_evidence_validator';
import { PROPOSAL_EVIDENCE_BUNDLE_V2_VERSION } from '../../models/proposal_evidence_bundle';
import { buildProposalEvidenceAsync } from '../proposal_evidence_builder';

const PROFILE_ID = 'nightly-recipe-agent';
const BASELINE_PROMPT = 'You are the nightly recipe agent (baseline).';
const CANDIDATE_PROMPT = 'You are the nightly recipe agent (refined candidate).';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

async function seedRefineConfigProposal(overrides: Record<string, unknown> = {}) {
  return new AgentOrgProposalsRepository().createAsync({
    kind: 'refine-config',
    risk: 'high',
    status: 'proposed',
    title: 'refine the nightly recipe agent prompt',
    diagnosisConfidence: 0.8,
    diagnosisConfidenceVersion: 'diagnosis-confidence-v1',
    targetRef: toProfileTargetRef(PROFILE_ID),
    changeJson: JSON.stringify({
      configPatch: { agentConfigId: PROFILE_ID, field: 'system_prompt', value: CANDIDATE_PROMPT },
    }),
    ...overrides,
  });
}

async function seedFact(outcomesRepo: AgentRunOutcomesRepository, overrides: Record<string, unknown> = {}) {
  const rootSessionId = (overrides.rootSessionId as string) ?? `ses-${Math.random().toString(36).slice(2)}`;
  return outcomesRepo.finalizeAsync({
    rootSessionId,
    sessionId: rootSessionId,
    profileId: PROFILE_ID,
    terminalStatus: 'error',
    objectiveVerdict: 'failure',
    objectiveEvidence: { producedArtifact: false, errorCount: 1, approvalDenied: false },
    attribution: buildAttribution(),
    ...overrides,
  } as never);
}

let outcomesRepo: AgentRunOutcomesRepository;

beforeEach(() => {
  setDb(makeDb());
  outcomesRepo = new AgentRunOutcomesRepository();
  new AgentConfigsRepository().insert({
    id: PROFILE_ID,
    label: PROFILE_ID,
    icon: 'x',
    systemPrompt: BASELINE_PROMPT,
  });
});

describe('C5-3 builds a proposal-evidence-v2 bundle from real durable facts', () => {
  it('fills target.ref/target.hash EXACTLY as the experiment eligibility check will recompute them', async () => {
    await seedFact(outcomesRepo);
    const proposal = await seedRefineConfigProposal();
    const config = new AgentConfigsRepository().getById(PROFILE_ID)!;

    const result = await buildProposalEvidenceAsync(proposal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bundle.target.ref).toBe(toProfileTargetRef(PROFILE_ID));
    expect(result.bundle.target.hash).toBe(buildProfileRevisionFingerprint(config));
    expect(result.bundle.version).toBe(PROPOSAL_EVIDENCE_BUNDLE_V2_VERSION);
  });

  it('selects real qualifying fact ids as sourceEvidence, never fabricated ids', async () => {
    const f1 = await seedFact(outcomesRepo, { rootSessionId: 'ses-bad-1' });
    const f2 = await seedFact(outcomesRepo, { rootSessionId: 'ses-bad-2' });
    const proposal = await seedRefineConfigProposal();

    const result = await buildProposalEvidenceAsync(proposal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(new Set(result.bundle.sourceEvidence.eventIds)).toEqual(new Set([f1.id, f2.id]));
    expect(new Set(result.bundle.sourceEvidence.sessionIds)).toEqual(new Set(['ses-bad-1', 'ses-bad-2']));
  });

  it('records a typed, closed counter-evidence search method and real coverage/contradictingCount', async () => {
    await seedFact(outcomesRepo, { rootSessionId: 'ses-bad-1' });
    await seedFact(outcomesRepo, {
      rootSessionId: 'ses-good-1',
      terminalStatus: 'completed',
      objectiveVerdict: 'success',
      objectiveEvidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    const proposal = await seedRefineConfigProposal();

    const result = await buildProposalEvidenceAsync(proposal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.bundle.counterEvidenceSearch.method).toBe('same-profile-ledger-scan');
    expect(result.bundle.counterEvidenceSearch.coverage).toBe(1);
    expect(result.bundle.counterEvidenceSearch.contradictingCount).toBe(1);
  });

  it('the builder-produced bundle passes the SAME validator an operator bundle must pass', async () => {
    await seedFact(outcomesRepo);
    const proposal = await seedRefineConfigProposal();

    const result = await buildProposalEvidenceAsync(proposal);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const validation = validateEvidenceBundle(result.bundle);
    expect(validation.valid).toBe(true);
  });
});

describe('C5-4 fail-closed: no qualifying facts, missing target state, unresolvable change', () => {
  it('leaves the proposal unexperimentable when its target profile has no qualifying (failing) facts', async () => {
    const proposal = await seedRefineConfigProposal();
    const result = await buildProposalEvidenceAsync(proposal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no qualifying|qualifying behavioral fact/i);
  });

  it('leaves the proposal unexperimentable when the target agent_config no longer exists (missing target state)', async () => {
    await seedFact(outcomesRepo);
    const proposal = await seedRefineConfigProposal({
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: 'ghost-profile', field: 'system_prompt', value: CANDIDATE_PROMPT },
      }),
      targetRef: toProfileTargetRef('ghost-profile'),
    });
    const result = await buildProposalEvidenceAsync(proposal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/no longer exists|does not exist|missing/i);
  });

  it('refuses a proposal kind other than refine-config — this builder is not a general-purpose fabricator', async () => {
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'create-recipe',
      risk: 'low',
      status: 'proposed',
      title: 'a different kind of proposal',
      changeJson: JSON.stringify({ title: 'some recipe' }),
    });
    const result = await buildProposalEvidenceAsync(proposal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('refine-config');
  });

  it('refuses a refine-config proposal whose change_json is a prose-only diagnosis (no machine-applyable patch)', async () => {
    await seedFact(outcomesRepo);
    const proposal = await seedRefineConfigProposal({
      changeJson: JSON.stringify({ diagnosis: 'the prompt is too verbose', concreteFix: 'shorten it' }),
    });
    const result = await buildProposalEvidenceAsync(proposal);
    expect(result.ok).toBe(false);
  });
});

describe('C5-2 no proposal generator fabricates evidence itself', () => {
  it('no generator file imports or constructs an evidence-bundle-shaped object', () => {
    const generatorsDir = path.join(__dirname, '../generators');
    const files = fs
      .readdirSync(generatorsDir)
      .filter((f) => f.endsWith('.ts') && !fs.statSync(path.join(generatorsDir, f)).isDirectory());
    expect(files.length).toBeGreaterThan(0);
    const forbidden = /PROPOSAL_EVIDENCE_BUNDLE_V(1|2)?_?VERSION|ProposalEvidenceBundle|counterEvidenceSearch|sourceEvidence\s*:/;
    for (const file of files) {
      const content = fs.readFileSync(path.join(generatorsDir, file), 'utf8');
      expect(content, `${file} must not construct an evidence bundle itself`).not.toMatch(forbidden);
    }
  });
});
