/**
 * Acceptance contract for config-doctor-core-permissions.
 *
 * The LLM and opencode reload are external boundaries. All profile storage,
 * diagnosis proposal assembly, registered-applier validation, projection, and
 * revert paths below are the real api_server surfaces.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

const state = vi.hoisted(() => ({ home: '' }));
const run = vi.hoisted(() => vi.fn());
const originalNodeEnv = process.env.NODE_ENV;
const originalVitest = process.env.VITEST;

vi.mock('os', () => ({ homedir: () => state.home, default: { homedir: () => state.home } }));
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { reloadConfig: vi.fn(), ensureCuratedMcps: vi.fn() },
}));
vi.mock('../services/agent_runner', () => ({
  resolveRunModel: () => ({ providerID: 'anthropic', modelID: 'claude-sonnet-4-6' }),
  run: (...args: unknown[]) => run(...args),
}));

import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function verificationGatePermissions() {
  return {
    read: 'allow', glob: 'allow', grep: 'allow', edit: 'allow', write: 'allow',
    skill: 'allow', webfetch: 'allow', websearch: 'allow', bash: { '*': 'allow' },
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    auditRunId: 'contract-audit', generatedAt: new Date().toISOString(), engineAvailable: true,
    profiles: [], skills: [], skillOverlapCandidates: [], recipes: [], delegationEdges: [],
    webhookEndpoints: [], deniedToolAggregates: [], drift: [], gaps: [], workflowFailureSignals: [],
    ...overrides,
  } as import('../services/org_audit_service').OrgAuditSnapshot;
}

function signal(agentConfigId: string, evidence = 'profile needs local tools'): import('../services/workflow_failure_signal_extractor').WorkflowFailureSignal {
  return {
    category: 'retry-loop', agentConfigId, count: 1, confidence: 'high',
    sessionIds: ['diagnosis-session'], evidence, dedupToken: `${agentConfigId}:contract`,
  };
}

beforeEach(() => {
  setDb(makeDb());
  state.home = join('/tmp', `rhythm-config-doctor-contract-${randomUUID()}`);
  process.env.NODE_ENV = 'development';
  process.env.VITEST = 'false';
  run.mockReset();
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.VITEST = originalVitest;
  if (state.home) rmSync(state.home, { recursive: true, force: true });
  state.home = '';
});

describe('config-doctor core-permissions acceptance contract', () => {
  it('issue-config-doctor-core-permissions-c1: core-permission diagnosis resolves to an applyable deep-merge scope patch', async () => {
    // Falsifies regression: the scope enum only admits MCP/skill arrays, so a
    // legitimate read/glob/bash diagnosis is persisted prose-only or replaces bash's pattern map.
    const configs = new AgentConfigsRepository();
    const profile = configs.insert({
      label: 'Verification Gate', icon: 'verified',
      corePermissionsJson: JSON.stringify({ bash: { '*': 'ask', 'git push*': 'ask' }, webfetch: 'allow' }),
    });
    const proposals = new AgentOrgProposalsRepository();
    const { generateDiagnosisProposals } = await import('../services/generators/workflow_signal_generator');

    const result = await generateDiagnosisProposals(snapshot({ workflowFailureSignals: [signal(profile.id)] }), {
      configsRepo: configs,
      proposalsRepo: proposals,
      diagnose: async () => ({
        diagnosis: 'The profile needs read, glob, and bash.', rootCause: 'scope', fixType: 'scope-change',
        concreteFix: 'Grant read, glob, and bash.', confidence: 'high',
        scopePatch: { agentConfigId: 'untrusted', field: 'corePermissionsJson', set: { read: 'allow', glob: 'allow', bash: { '*': 'allow' } } } as never,
      }),
    });

    expect(result.created).toHaveLength(1);
    const change = JSON.parse(result.created[0].changeJson!) as { scopePatch?: { field: string; set: Record<string, unknown> } };
    expect(change.scopePatch).toEqual({
      agentConfigId: profile.id, field: 'corePermissionsJson',
      set: { read: 'allow', glob: 'allow', bash: { '*': 'allow' } },
    });
  });

  it('issue-config-doctor-core-permissions-c2: approved core-permission patch projects and reverts exactly', async () => {
    // Falsifies regression: approval mutates only array allowlists or snapshots an
    // unusable representation, so the .md projection or revert loses permissions.
    const configs = new AgentConfigsRepository();
    const profile = configs.insert({
      label: 'Verification Gate', icon: 'verified',
      corePermissionsJson: JSON.stringify({ bash: { '*': 'ask', 'git push*': 'ask' }, webfetch: 'allow' }),
    });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-scope', risk: 'high', title: 'Grant local verification permissions',
      targetRef: `profile:${profile.id}`,
      changeJson: JSON.stringify({ scopePatch: {
        agentConfigId: profile.id, field: 'corePermissionsJson',
        set: { read: 'allow', glob: 'allow', bash: { '*': 'allow' } },
      } }),
      dedupKey: `core-permissions-projection:${profile.id}`,
    });
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    const { applyProposal } = await import('../services/org_proposal_apply_service');
    const { revertProposal } = await import('../services/org_proposal_apply');
    registerAllProposalAppliers();

    const { applyApprovedScopeProposal } = await import('../services/org_proposal_scope_lifecycle');
    const applyResult = await applyProposal(proposal);
    // Preparation alone must not touch the target.
    expect(configs.getById(profile.id)?.corePermissionsJson).toBe(profile.corePermissionsJson);
    const lifecycle = await applyApprovedScopeProposal({
      proposal,
      decidedByUserId: 1,
      changeJson: (applyResult.changeJson ?? proposal.changeJson)!,
      beforeSnapshotJson: applyResult.beforeSnapshotJson!,
      pair: applyResult.scopePair!,
    });
    expect(lifecycle.kind).toBe('measuring');
    const after = configs.getById(profile.id)!;
    expect(JSON.parse(after.corePermissionsJson!)).toEqual({
      bash: { '*': 'allow', 'git push*': 'ask' }, webfetch: 'allow', read: 'allow', glob: 'allow',
    });
    const file = join(state.home, '.config', 'opencode', 'agents', `${profile.id}.md`);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('  bash:');
    expect(readFileSync(file, 'utf8')).toContain('  read: allow');

    expect(applyResult.beforeSnapshotJson).toBeTruthy();
    const measuring = lifecycle.kind === 'measuring' ? lifecycle.proposal : null;
    const active = await proposals.updateStatusAsync(proposal.id, 'active');
    expect(measuring).not.toBeNull();
    await revertProposal(active!);
    expect(configs.getById(profile.id)?.corePermissionsJson).toBe(profile.corePermissionsJson);
  });

  it('issue-config-doctor-core-permissions-c3: cross-layer scope names are rejected with a clear validation message', async () => {
    // Falsifies regression: core tool names can be emitted as MCP names (or an
    // MCP server as a core permission), creating a valid-looking but dangerous patch.
    const configs = new AgentConfigsRepository();
    const profile = configs.insert({ label: 'Gate', icon: 'verified' });
    const proposals = new AgentOrgProposalsRepository();
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    const { validateProposalChange } = await import('../services/org_proposal_apply_service');
    registerAllProposalAppliers();
    const mcpMisuse = await proposals.createAsync({ kind: 'refine-scope', risk: 'high', title: 'bad mcp', dedupKey: 'bad-mcp', changeJson: JSON.stringify({ scopePatch: { agentConfigId: profile.id, field: 'allowedMcpsJson', add: ['bash', 'read', 'edit'] } }) });
    const permissionMisuse = await proposals.createAsync({ kind: 'refine-scope', risk: 'high', title: 'bad permission', dedupKey: 'bad-permission', changeJson: JSON.stringify({ scopePatch: { agentConfigId: profile.id, field: 'corePermissionsJson', set: { rhythm: 'allow' } } }) });

    await expect(validateProposalChange(mcpMisuse)).resolves.toMatchObject({ valid: false, reason: expect.stringMatching(/core permission.*MCP/i) });
    await expect(validateProposalChange(permissionMisuse)).resolves.toMatchObject({ valid: false, reason: expect.stringMatching(/MCP.*core permission/i) });
  });

  it('issue-config-doctor-core-permissions-c4: verification-gate core permissions are visible to diagnosis', async () => {
    // Falsifies regression: the diagnosis prompt omits corePermissions, letting
    // the model claim this already-capable profile has no local file/shell tools.
    const configs = new AgentConfigsRepository();
    const profile = configs.insert({ label: 'Verification Gate', icon: 'verified', corePermissionsJson: JSON.stringify(verificationGatePermissions()), allowedMcpsJson: JSON.stringify(['rhythm']) });
    run.mockImplementation(async ({ prompt }: { prompt: string }) => ({
      sessionId: 'diagnosis', status: 'done',
      result: prompt.includes('corePermissions: ' + JSON.stringify(verificationGatePermissions()))
        ? JSON.stringify({ diagnosis: 'Permissions are already present.', rootCause: 'external', fixType: 'external-noop', concreteFix: 'No scope change.', confidence: 'high' })
        : JSON.stringify({ diagnosis: 'No local tools.', rootCause: 'scope', fixType: 'scope-change', concreteFix: 'Add read.', confidence: 'high' }),
    }));
    const { defaultDiagnose } = await import('../services/generators/workflow_signal_generator');
    const { resolveCoreCapabilitySurface } = await import('../services/profile_capability_surface');
    const { resolveProfileMcpScope } = await import('../services/agent_profile_scope');
    const result = await defaultDiagnose({
      affectedSkill: profile.id, signals: [signal(profile.id)], agentConfig: profile,
      profile: { id: profile.id, label: profile.label, isManager: false, enabled: true, allowedMcps: ['rhythm'], allowedSkills: [], allowedDelegates: [], corePermissions: verificationGatePermissions() } as never,
      mcpScope: resolveProfileMcpScope(profile.allowedMcpsJson ?? null, profile.id, profile.label),
      coreCapabilities: resolveCoreCapabilitySurface(profile),
      skillBody: null, deniedTools: [], delegationOutbound: [], delegationInbound: [],
    });
    expect(result?.fixType).toBe('external-noop');
  });

  it('issue-config-doctor-core-permissions-c5: same-window abort batch collapses to one external-noop signal', async () => {
    // Falsifies regression: a parent cancellation is counted as six independent
    // profile failures, feeding the optimizer six chances to invent scope changes.
    const configs = new AgentConfigsRepository();
    configs.insert({ id: 'verification-gate', label: 'Verification Gate', icon: 'verified' });
    const sessions = new (await import('../repositories/agent_sessions_repository')).AgentSessionsRepository();
    const at = '2026-07-26T05:13:15.000Z';
    Array.from({ length: 6 }, (_, i) => {
      const session = sessions.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: `abort-${i}`, mcpRole: 'verification-gate' });
      sessions.setErrorStatus(session.id, 'Error: Aborted');
      getDb().prepare('UPDATE agent_sessions SET created_at = ?, updated_at = ? WHERE id = ?').run('2026-07-26T05:08:41.000Z', at, session.id);
    });
    const captured: import('../services/workflow_failure_signal_extractor').WorkflowFailureSignal[] = [];
    const { generateRunQualityProposals } = await import('../services/generators/run_quality_generator');
    const result = await generateRunQualityProposals(snapshot(), {
      db: getDb(),
      getRollup: () => ({
        generatedAt: at, windowDays: 14,
        agents: [{
          agentKind: 'verification-gate', agentLabel: 'Verification Gate', totalRuns: 6,
          completedRuns: 0, escalatedRuns: 6, inProgressRuns: 0, unmeasuredRuns: 0,
          notEnoughData: false, completionRate: 0, escalationRate: 1, totalTokens: 0,
          wastedTokens: 0, wastePercentOfSpend: 0, totalUserCorrections: 0,
          avgCorrectionsPerRun: 0, repeatedMistakes: [{ message: 'Aborted', count: 6 }],
        }],
      }),
      diagnosis: {
        configsRepo: configs,
        diagnose: async (ctx) => {
          captured.push(...ctx.signals);
          return {
            diagnosis: 'The orchestrator cancelled one batch.', rootCause: 'external',
            fixType: 'external-noop', concreteFix: 'No profile change.', confidence: 'high',
          };
        },
      },
    });
    expect(result).toMatchObject({ flaggedAgents: 1, created: [] });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      category: 'external-abort', agentConfigId: 'verification-gate', count: 1, confidence: 'high',
    });
    expect(captured[0].evidence).toMatch(/external-noop/i);
  });

  it('issue-config-doctor-core-permissions-c6: legacy MCP and skill allowlist patches remain applyable', async () => {
    // Falsifies regression: broadening ScopePatch for maps accidentally routes
    // legacy array patches through object-merge semantics or rejects them.
    const configs = new AgentConfigsRepository();
    const profile = configs.insert({ label: 'Secretary', icon: 'mail', allowedMcpsJson: JSON.stringify(['rhythm']), allowedSkillsJson: JSON.stringify(['triage']) });
    const proposals = new AgentOrgProposalsRepository();
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    const { applyProposal } = await import('../services/org_proposal_apply_service');
    const { applyApprovedScopeProposal } = await import('../services/org_proposal_scope_lifecycle');
    registerAllProposalAppliers();
    for (const [field, add] of [['allowedMcpsJson', ['gmail-work']], ['allowedSkillsJson', ['follow-up']]] as const) {
      const proposal = await proposals.createAsync({ kind: 'refine-scope', risk: 'high', title: `add ${add[0]}`, dedupKey: `${field}-${add[0]}`, changeJson: JSON.stringify({ scopePatch: { agentConfigId: profile.id, field, add } }) });
      const prepared = await applyProposal(proposal);
      expect(prepared).toMatchObject({ measurable: true, changeJson: proposal.changeJson });
      const outcome = await applyApprovedScopeProposal({
        proposal,
        decidedByUserId: 1,
        changeJson: prepared.changeJson!,
        beforeSnapshotJson: prepared.beforeSnapshotJson!,
        pair: prepared.scopePair!,
      });
      expect(outcome.kind).toBe('measuring');
    }
    const updated = configs.getById(profile.id)!;
    expect(JSON.parse(updated.allowedMcpsJson!)).toEqual(['rhythm', 'gmail-work']);
    expect(JSON.parse(updated.allowedSkillsJson!)).toEqual(['triage', 'follow-up']);
  });
});
