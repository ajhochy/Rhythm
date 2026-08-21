import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { startTestServer } from './helpers/real_server';

describe('D1.4 tool-install approval route boundary', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let proposalId: string;
  let token: string;
  let findProposal: (id: string) => Promise<{ status: string } | null>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'false');
    const [
      { runMigrations }, { setDb }, { createApp }, { AgentConfigsRepository },
      { AgentOrgProposalsRepository }, { ToolSafetyReportsRepository },
      { UsersRepository }, { SessionsRepository }, safetyPolicy,
      evidence, experiment, guardrails,
    ] = await Promise.all([
      import('../database/migrations'), import('../database/db'), import('../app'),
      import('../repositories/agent_configs_repository'), import('../repositories/agent_org_proposals_repository'),
      import('../repositories/tool_safety_reports_repository'), import('../repositories/users_repository'),
      import('../repositories/sessions_repository'), import('../services/tool_install_safety_policy'),
      import('../models/proposal_evidence_bundle'), import('../services/org_proposal_experiment_service'),
      import('../models/guardrail_registry'),
    ]);
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const configs = new AgentConfigsRepository();
    const config = configs.insert({ label: 'D1 authenticated route', icon: 'shield', systemPrompt: 'test' });
    const proposals = new AgentOrgProposalsRepository(db);
    const bundle = {
      version: evidence.PROPOSAL_EVIDENCE_BUNDLE_VERSION,
      sourceEvidence: { sessionIds: ['session-1'], eventIds: [] },
      counterEvidenceSearch: { query: 'tool install', searchedAt: '2026-08-21T00:00:00.000Z', contradictingCount: 0 },
      target: { ref: experiment.toProfileTargetRef(config.id), hash: experiment.buildProfileRevisionFingerprint(config) },
      expectedOutcome: 'improve scheduling', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
      guardrails: [...guardrails.GUARDRAIL_NAMES], experimentAdapter: 'usage-count', rollbackRule: 'revoke',
      generatorVersion: 'd1-route-test', confidenceCalibrationVersion: 'uncalibrated',
    };
    const proposal = await proposals.createAsync({
      kind: 'tool-install', risk: 'high', status: 'proposed', title: 'Install example tool',
      changeJson: JSON.stringify({ toolName: 'example-tool', packageSource: 'npm:example-tool', installMethod: 'npm install', agentConfigId: config.id, testPrompts: ['version-check', 'help-check'], evidenceBundle: bundle }),
    });
    proposalId = proposal.id;
    await new ToolSafetyReportsRepository(db).createAsync({
      proposalId, proposalFingerprint: safetyPolicy.buildToolInstallProposalFingerprint(proposal),
      toolName: 'example-tool', packageSource: 'npm:example-tool', installMethod: 'npm install',
      sandboxDurationMs: 1, testPromptsRunCount: 2, verdict: 'conditional', evidenceJson: '{}',
    });
    const user = new UsersRepository().create({ name: 'D1 reviewer', email: 'd1-reviewer@example.test', role: 'admin' });
    token = new SessionsRepository().create(user.id).token;
    findProposal = (id) => proposals.findByIdAsync(id);
    ({ baseUrl, close } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await close();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('requires authentication and an exact confirmation; client report fields cannot forge approval', async () => {
    const unauthenticated = await fetch(`${baseUrl}/agent-org-proposals/${proposalId}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolSafetyConfirmation: 'approve-conditional-tool-install' }),
    });
    expect(unauthenticated.status).toBe(401);

    const forged = await fetch(`${baseUrl}/agent-org-proposals/${proposalId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolSafetyConfirmation: 'approve-conditional-tool-install-nope', verdict: 'safe', report: { verdict: 'safe' } }),
    });
    expect(forged.status).toBeGreaterThanOrEqual(400);
    expect((await findProposal(proposalId))?.status).toBe('proposed');

    const confirmed = await fetch(`${baseUrl}/agent-org-proposals/${proposalId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      // The persisted report is conditional. These hostile fields are ignored;
      // only the authenticated exact confirmation has effect.
      body: JSON.stringify({ toolSafetyConfirmation: 'approve-conditional-tool-install', verdict: 'unsafe', report: { verdict: 'unsafe' } }),
    });
    expect(confirmed.status).toBe(200);
    expect((await findProposal(proposalId))?.status).toBe('applied');
  });

  it('preserves compare-and-set lifecycle behavior under double approval', async () => {
    const approve = () => fetch(`${baseUrl}/agent-org-proposals/${proposalId}/approve`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolSafetyConfirmation: 'approve-conditional-tool-install' }),
    });
    const [first, second] = await Promise.all([approve(), approve()]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect((await findProposal(proposalId))?.status).toBe('applied');
  });
});
