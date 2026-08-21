/** D4.3 (#1441) — fail-closed trust-gated automatic promotion. */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { setDb } from '../../database/db';
import { runMigrations } from '../../database/migrations';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { PromotionTrustStateRepository } from '../../repositories/promotion_trust_state_repository';
import { PostApplyEventsRepository } from '../../repositories/post_apply_events_repository';
import { ToolSafetyReportsRepository } from '../../repositories/tool_safety_reports_repository';
import { registerAllProposalAppliers } from '../org_proposal_appliers_wiring';
import { resetProposalPluginsForTests } from '../org_proposal_apply_service';
import { attemptAutoPromotionAsync } from '../auto_promotion_gate';
import { buildToolInstallProposalFingerprint } from '../tool_install_safety_policy';
import { buildProfileRevisionFingerprint, toProfileTargetRef } from '../org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';

let db: Database.Database;
let proposals: AgentOrgProposalsRepository;
let trust: PromotionTrustStateRepository;
let configs: AgentConfigsRepository;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  resetProposalPluginsForTests();
  registerAllProposalAppliers();
  proposals = new AgentOrgProposalsRepository(db);
  trust = new PromotionTrustStateRepository(db);
  configs = new AgentConfigsRepository();
  configs.insert({ id: 'd4-profile', label: 'D4 profile', icon: 'x', systemPrompt: 'before' });
});

async function verifiedConfigProposal(id = 'd4-proposal') {
  const proposal = await proposals.createAsync({
    id, kind: 'refine-config', risk: 'high', status: 'proposed', title: id,
    targetRef: 'agent_config:d4-profile',
    changeJson: JSON.stringify({ configPatch: { agentConfigId: 'd4-profile', field: 'system_prompt', value: 'after' } }),
  });
  await proposals.setOutcomeStatusAtRevisionAsync({
    proposalId: proposal.id, expectedRevision: proposal.revision, outcomeStatus: 'verified',
  });
  return (await proposals.findByIdAsync(proposal.id))!;
}

async function enableTrust(overrides: Partial<{ eligible: boolean; enabled: boolean; regressions: number; enabledAt: string | null }> = {}) {
  await trust.recordEligibilityAsync({
    totalVerified: 10,
    totalRegressions: overrides.regressions ?? 0,
    autoPromotionEligible: overrides.eligible ?? true,
  });
  await trust.updateAsync({
    autoPromotionEnabled: overrides.enabled ?? true,
    enabledAt: overrides.enabledAt === undefined ? '2026-08-21T00:00:00.000Z' : overrides.enabledAt,
  });
}

async function verifiedToolInstallProposal(id: string) {
  const profile = configs.getById('d4-profile')!;
  const proposal = await proposals.createAsync({
    id, kind: 'tool-install', risk: 'high', status: 'proposed', title: id,
    changeJson: JSON.stringify({
      toolName: 'd4-tool', packageSource: 'npm:d4-tool', installMethod: 'npm install', agentConfigId: 'd4-profile',
      testPrompts: ['version-check', 'help-check'],
      evidenceBundle: {
        version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
        sourceEvidence: { sessionIds: ['d4-session'], eventIds: [] },
        counterEvidenceSearch: { query: 'd4 tool install', searchedAt: '2026-08-21T00:00:00.000Z', contradictingCount: 0 },
        target: { ref: toProfileTargetRef(profile.id), hash: buildProfileRevisionFingerprint(profile) },
        expectedOutcome: 'safe tool behavior', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
        guardrails: ['terminal-error-rate'], experimentAdapter: 'paired-cohort-outcome',
        rollbackRule: 'restore', generatorVersion: 'd4-test', confidenceCalibrationVersion: 'd4-test',
      },
    }),
  });
  const vetted = await proposals.updateStatusAsync(id, 'sandbox-running', undefined, proposal.revision);
  const reviewable = await proposals.updateStatusAsync(id, 'sandbox-vetted', undefined, vetted!.revision);
  await proposals.setOutcomeStatusAtRevisionAsync({ proposalId: id, expectedRevision: reviewable!.revision, outcomeStatus: 'verified' });
  return (await proposals.findByIdAsync(id))!;
}

async function reportToolSafety(proposal: Awaited<ReturnType<typeof verifiedToolInstallProposal>>, verdict: 'safe' | 'conditional' | 'unsafe', fingerprint?: string) {
  await new ToolSafetyReportsRepository(db).createAsync({
    proposalId: proposal.id,
    proposalFingerprint: fingerprint ?? buildToolInstallProposalFingerprint(proposal),
    toolName: 'd4-tool', packageSource: 'npm:d4-tool', installMethod: 'npm install',
    sandboxDurationMs: 1, testPromptsRunCount: 2, verdict,
  });
}

const available = { isAvailable: () => true };

describe('D4.3 auto promotion gate', () => {
  it('preserves human review when static/default availability is disabled', async () => {
    const proposal = await verifiedConfigProposal();
    await enableTrust();

    await attemptAutoPromotionAsync(proposal.id);

    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('proposed');
    expect(configs.getById('d4-profile')?.systemPrompt).toBe('before');
  });

  it.each([
    ['ineligible', { eligible: false }],
    ['disabled', { enabled: false }],
    ['regressed', { regressions: 1 }],
    ['missing enabledAt', { enabledAt: null }],
  ])('preserves human review when trust is %s', async (_name, state) => {
    const proposal = await verifiedConfigProposal(`d4-${_name}`);
    await enableTrust(state);

    await attemptAutoPromotionAsync(proposal.id, { availability: available });

    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('proposed');
    expect(configs.getById('d4-profile')?.systemPrompt).toBe('before');
  });

  it('uses the human claim/apply path and enrolls D2 after successful auto-apply', async () => {
    const proposal = await verifiedConfigProposal();
    await enableTrust();

    const result = await attemptAutoPromotionAsync(proposal.id, { availability: available });

    expect(result.status).toBe('applied');
    expect(configs.getById('d4-profile')?.systemPrompt).toBe('after');
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('measuring');
    expect(await new PostApplyEventsRepository(db).findByProposalIdAsync(proposal.id)).not.toBeNull();
  });

  it('is idempotent on re-entry and does not reapply the proposal', async () => {
    const proposal = await verifiedConfigProposal();
    await enableTrust();
    await attemptAutoPromotionAsync(proposal.id, { availability: available });

    const result = await attemptAutoPromotionAsync(proposal.id, { availability: available });

    expect(result.status).toBe('already-applied');
    expect((db.prepare('SELECT COUNT(*) AS count FROM agent_org_post_apply_events').get() as { count: number }).count).toBe(1);
  });

  it('retries only D2 enrollment after a committed profile mutation and is idempotent after recovery', async () => {
    const proposal = await verifiedConfigProposal('d4-enrollment-failure');
    await enableTrust();

    const first = await attemptAutoPromotionAsync(proposal.id, {
      availability: available,
      finalizePostApply: async () => { throw new Error('synthetic D2 enrollment failure'); },
    });
    const revisionAfterCommit = configs.getById('d4-profile')!.revision;
    const second = await attemptAutoPromotionAsync(proposal.id, { availability: available });
    const third = await attemptAutoPromotionAsync(proposal.id, { availability: available });

    expect(first.status).toBe('enrollment-pending');
    expect(second.status).toBe('already-applied');
    expect(third.status).toBe('already-applied');
    expect(configs.getById('d4-profile')?.systemPrompt).toBe('after');
    expect(configs.getById('d4-profile')?.revision).toBe(revisionAfterCommit);
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('measuring');
    expect(await new PostApplyEventsRepository(db).findByProposalIdAsync(proposal.id)).not.toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS count FROM agent_org_post_apply_events').get() as { count: number }).count).toBe(1);
  });

  it('treats a null D2 finalizer result as enrollment-pending in strict auto mode', async () => {
    const proposal = await verifiedConfigProposal('d4-null-enrollment');
    await enableTrust();

    const result = await attemptAutoPromotionAsync(proposal.id, {
      availability: available,
      finalizePostApply: async () => null,
    });

    expect(result.status).toBe('enrollment-pending');
    expect(configs.getById('d4-profile')?.systemPrompt).toBe('after');
    expect(await new PostApplyEventsRepository(db).findByProposalIdAsync(proposal.id)).toBeNull();
  });

  it.each([
    ['missing', undefined, undefined],
    ['conditional', 'conditional', undefined],
    ['unsafe', 'unsafe', undefined],
    ['stale fingerprint', 'safe', 'sha256:stale'],
  ] as const)('blocks tool-install automation with %s durable safety evidence', async (_name, verdict, fingerprint) => {
    const proposal = await verifiedToolInstallProposal(`tool-${_name}`);
    await enableTrust();
    if (verdict) await reportToolSafety(proposal, verdict, fingerprint);

    const result = await attemptAutoPromotionAsync(proposal.id, { availability: available });

    expect(result.status).toBe('tool-safety-blocked');
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('sandbox-vetted');
  });

  it('permits only a matching durable SAFE tool report, but never claims an unavailable installer applied', async () => {
    const proposal = await verifiedToolInstallProposal('tool-safe');
    await enableTrust();
    await reportToolSafety(proposal, 'safe');

    const result = await attemptAutoPromotionAsync(proposal.id, { availability: available });

    expect(result.status).toBe('apply-failed');
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('failed');
  });

  it('fails closed when tool safety report infrastructure throws', async () => {
    const proposal = await verifiedToolInstallProposal('tool-report-failure');
    await enableTrust();
    const reports = new ToolSafetyReportsRepository(db);
    reports.findByProposalIdAsync = async () => { throw new Error('report repository unavailable'); };

    await expect(attemptAutoPromotionAsync(proposal.id, { availability: available, reports }))
      .resolves.toEqual({ status: 'tool-safety-blocked' });
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('sandbox-vetted');
  });

  it('returns a conflict for the losing concurrent CAS attempt without inventing a second D2 enrollment', async () => {
    const proposal = await verifiedConfigProposal('d4-cas');
    await enableTrust();

    const results = await Promise.all([
      attemptAutoPromotionAsync(proposal.id, { availability: available }),
      attemptAutoPromotionAsync(proposal.id, { availability: available }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['applied', 'conflict']);
    expect((db.prepare('SELECT COUNT(*) AS count FROM agent_org_post_apply_events').get() as { count: number }).count).toBe(1);
  });
});
