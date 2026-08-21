import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { ToolSafetyReportsRepository } from '../../repositories/tool_safety_reports_repository';
import {
  buildToolInstallProposalFingerprint,
  evaluateToolInstallSafetyAsync,
  type ToolInstallSafetyDeps,
} from '../tool_install_safety_policy';
import { buildProfileRevisionFingerprint, toProfileTargetRef } from '../org_proposal_experiment_service';
import { GUARDRAIL_NAMES } from '../../models/guardrail_registry';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { applyProposal } from '../org_proposal_apply_service';
import { applyProposal as applyUnattendedProposal } from '../org_proposal_apply';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function safetyDeps(reports: ToolSafetyReportsRepository, verdict: 'safe' | 'conditional' | 'unsafe' | 'unknown'): ToolInstallSafetyDeps {
  return {
    reports,
    vet: async () => ({
      verdict,
      reason: verdict === 'unknown' ? 'sandbox_unavailable' : null,
      sandboxDurationMs: 3,
      testPromptsRunCount: 2,
      forbiddenPathViolationsJson: '[]',
      networkCallsObservedJson: verdict === 'conditional' ? '[{"host":"registry.invalid","count":1}]' : '[]',
      fileSystemWritesObservedJson: '[]',
      credentialAccessAttemptsCount: 0,
      evidenceJson: '{}',
    }),
  };
}

describe('D1.4 tool-install safety policy', () => {
  let proposals: AgentOrgProposalsRepository;
  let reports: ToolSafetyReportsRepository;
  let proposalId: string;

  beforeEach(async () => {
    const db = makeDb();
    setDb(db);
    proposals = new AgentOrgProposalsRepository(db);
    reports = new ToolSafetyReportsRepository(db);
    const config = new AgentConfigsRepository().insert({ label: 'D1 policy', icon: 'shield' });
    const evidenceBundle = {
      version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
      sourceEvidence: { sessionIds: ['session-1'], eventIds: [] },
      counterEvidenceSearch: { query: 'tool install', searchedAt: '2026-08-21T00:00:00.000Z', contradictingCount: 0 },
      target: { ref: toProfileTargetRef(config.id), hash: buildProfileRevisionFingerprint(config) },
      expectedOutcome: 'improve scheduling',
      primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
      guardrails: [...GUARDRAIL_NAMES],
      experimentAdapter: 'usage-count', rollbackRule: 'revoke', generatorVersion: 'd1-test', confidenceCalibrationVersion: 'uncalibrated',
    };
    const proposal = await proposals.createAsync({
      kind: 'tool-install', risk: 'high', title: 'Install example-tool', status: 'proposed',
      changeJson: JSON.stringify({ toolName: 'example-tool', packageSource: 'npm:example-tool', installMethod: 'npm install', agentConfigId: config.id, testPrompts: ['version-check', 'help-check'], evidenceBundle }),
    });
    proposalId = proposal.id;
  });

  it('allows a safe report after it is durably persisted and re-read', async () => {
    const proposal = (await proposals.findByIdAsync(proposalId))!;
    const result = await evaluateToolInstallSafetyAsync(proposal, { deps: safetyDeps(reports, 'safe') });
    expect(result).toEqual({ allowed: true, reason: null, verdict: 'safe' });
    expect((await reports.findByProposalIdAsync(proposal.id))?.proposalFingerprint).toBe(
      buildToolInstallProposalFingerprint(proposal),
    );
  });

  it('blocks automatic conditional approval but allows only the explicit human confirmation', async () => {
    const proposal = (await proposals.findByIdAsync(proposalId))!;
    const automatic = await evaluateToolInstallSafetyAsync(proposal, { deps: safetyDeps(reports, 'conditional') });
    expect(automatic).toEqual({ allowed: false, reason: 'conditional_confirmation_required', verdict: 'conditional' });

    const confirmed = await evaluateToolInstallSafetyAsync(proposal, {
      explicitHumanConfirmation: true,
      deps: safetyDeps(reports, 'conditional'),
    });
    expect(confirmed).toEqual({ allowed: true, reason: null, verdict: 'conditional' });
  });

  it.each(['unsafe', 'unknown'] as const)('blocks a %s verdict', async (verdict) => {
    const proposal = (await proposals.findByIdAsync(proposalId))!;
    const result = await evaluateToolInstallSafetyAsync(proposal, { deps: safetyDeps(reports, verdict) });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('safety_verdict_blocked');
  });

  it('blocks unavailable/error vetting without creating an approval-authoritative report', async () => {
    const proposal = (await proposals.findByIdAsync(proposalId))!;
    const result = await evaluateToolInstallSafetyAsync(proposal, {
      deps: { reports, vet: async () => { throw new Error('candidate-controlled error text'); } },
    });
    expect(result).toEqual({ allowed: false, reason: 'vetting_unavailable', verdict: 'unknown' });
    expect(await reports.findByProposalIdAsync(proposal.id)).toBeNull();
  });

  it('blocks a stale/mismatched or malformed durable report without trusting request data', async () => {
    const proposal = (await proposals.findByIdAsync(proposalId))!;
    await reports.createAsync({
      proposalId: proposal.id, proposalFingerprint: '0'.repeat(64), toolName: 'other-tool', packageSource: 'npm:other-tool', installMethod: 'npm install',
      sandboxDurationMs: 1, testPromptsRunCount: 2, verdict: 'safe', evidenceJson: '{malformed',
    });
    const result = await evaluateToolInstallSafetyAsync(proposal, { deps: safetyDeps(reports, 'safe') });
    expect(result).toEqual({ allowed: false, reason: 'report_mismatch', verdict: 'unknown' });
  });

  it('blocks a fingerprint-matched but malformed durable report', async () => {
    const proposal = (await proposals.findByIdAsync(proposalId))!;
    await reports.createAsync({
      proposalId: proposal.id, proposalFingerprint: buildToolInstallProposalFingerprint(proposal),
      toolName: 'example-tool', packageSource: 'npm:example-tool', installMethod: 'npm install',
      sandboxDurationMs: 1, testPromptsRunCount: 2, verdict: 'safe', evidenceJson: '{malformed',
    });
    const result = await evaluateToolInstallSafetyAsync(proposal, { deps: safetyDeps(reports, 'safe') });
    expect(result).toEqual({ allowed: false, reason: 'report_malformed', verdict: 'unknown' });
  });

  it('refuses direct reusable apply bypasses until the central policy allows them', async () => {
    const proposal = (await proposals.findByIdAsync(proposalId))!;
    await expect(
      applyProposal(proposal, { deps: safetyDeps(reports, 'conditional') }),
    ).rejects.toThrow('conditional_confirmation_required');
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('proposed');

    await expect(
      applyProposal(proposal, {
        explicitHumanConfirmation: true,
        deps: safetyDeps(reports, 'conditional'),
      }),
    ).resolves.toMatchObject({ measurable: false });
  });

  it('refuses the separate unattended optimizer apply path before it can mutate status', async () => {
    const proposal = (await proposals.findByIdAsync(proposalId))!;
    await expect(applyUnattendedProposal(proposal, { proposalsRepo: proposals })).resolves.toEqual({ status: 'refused-high-risk' });
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('proposed');
  });
});
