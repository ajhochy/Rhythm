/**
 * Tests for org_proposal_appliers_wiring.ts's buildRealExternalAdoptionDeps()
 * — the REAL production implementation of ExternalAdoptionApplyDeps (#1114).
 *
 * Before #1114, `installCuratedMcp` called `opencodeClient.ensureCuratedMcps
 * ({register:true})` with NO `servers` override, meaning it only ever
 * ensured the STATIC curated catalog (CURATED_MCP_SERVERS) — a genuinely NEW
 * server discovered via external_discovery_search.ts's mcp-registry search
 * would silently install NOTHING. This also never wired the adopted server
 * to the requesting agent's OWN scope (secretary-MCP-scope lesson) — a
 * successful "install" left the server enabled for every agent, not just
 * the one whose capability-gap it filled.
 *
 * opencodeClient is mocked (mirrors issue_850_contract.test.ts's own
 * pattern for this same singleton) — these tests prove ROUTING (server
 * shape built + passed, allowedMcpsJson wired) without touching a real
 * opencode.json or engine.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';

const mockEnsureCuratedMcps = vi.fn();
vi.mock('../opencode_engine', () => ({
  opencodeClient: {
    ensureCuratedMcps: (...args: unknown[]) => mockEnsureCuratedMcps(...args),
  },
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
  mockEnsureCuratedMcps.mockReset();
});

describe('#1114 — buildRealExternalAdoptionDeps().installCuratedMcp', () => {
  it('builds a CuratedMcpServer from serverName + installCommand and ensures ONLY that one server (not the static catalog)', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: true,
      registered: true,
      servers: [{ id: 'weather-mcp', name: 'weather-mcp', type: 'local', command: ['npx', '-y', '@x/weather-mcp'], requiredEnv: [] }],
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    const result = await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
    });

    expect(mockEnsureCuratedMcps).toHaveBeenCalledTimes(1);
    const call = mockEnsureCuratedMcps.mock.calls[0][0] as { servers?: unknown[]; register?: boolean };
    expect(call.register).toBe(true);
    expect(call.servers).toHaveLength(1); // ONLY the discovered server, not CURATED_MCP_SERVERS
    expect(call.servers?.[0]).toMatchObject({
      id: 'weather-mcp',
      name: 'weather-mcp',
      type: 'local',
      command: ['npx', '-y', '@x/weather-mcp'],
      requiredEnv: [],
    });
    expect(result.changed).toBe(true);
    expect(result.registered).toBe(true);
  });

  it('throws when installCommand is missing — no ambiguous silent no-op install', async () => {
    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    await expect(deps.installCuratedMcp({ serverName: 'no-install-cmd' })).rejects.toThrow(
      /installCommand/,
    );
    expect(mockEnsureCuratedMcps).not.toHaveBeenCalled();
  });

  it('wires the adopted server into JUST the needing agent\'s allowedMcpsJson (scoped, not global)', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: true,
      registered: true,
      servers: [{ id: 'weather-mcp', name: 'weather-mcp', type: 'local', command: ['npx', '-y', '@x/weather-mcp'], requiredEnv: [] }],
    });

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    const result = await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
      agentConfigId: config.id,
    });

    const updated = configsRepo.getById(config.id);
    const allowed = JSON.parse(updated!.allowedMcpsJson!) as string[];
    expect(allowed).toContain('rhythm'); // prior scope preserved
    expect(allowed).toContain('weather-mcp'); // newly adopted server appended

    // Reversibly wired: the prior allowlist is captured for a future revert.
    expect(result.beforeSnapshotJson).toBeTruthy();
    const snapshot = JSON.parse(result.beforeSnapshotJson!) as {
      agentConfigId: string;
      priorAllowedMcpsJson: string | null;
    };
    expect(snapshot.agentConfigId).toBe(config.id);
    expect(JSON.parse(snapshot.priorAllowedMcpsJson!)).toEqual(['rhythm']);
  });

  it('does not duplicate the server id in allowedMcpsJson on a repeat wire', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: false,
      registered: false,
      servers: [],
    });

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'x',
      allowedMcpsJson: JSON.stringify(['weather-mcp']),
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
      agentConfigId: config.id,
    });

    const updated = configsRepo.getById(config.id);
    const allowed = JSON.parse(updated!.allowedMcpsJson!) as string[];
    expect(allowed.filter((s) => s === 'weather-mcp')).toHaveLength(1);
  });

  it('installs without wiring or throwing when no agentConfigId is given (gap had no known requester)', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: true,
      registered: true,
      servers: [{ id: 'weather-mcp', name: 'weather-mcp', type: 'local', command: ['npx', '-y', '@x/weather-mcp'], requiredEnv: [] }],
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    const result = await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
    });

    expect(result.changed).toBe(true);
    expect(result.beforeSnapshotJson).toBeUndefined();
  });

  it('installs without wiring when agentConfigId does not resolve to a live agent_configs row', async () => {
    mockEnsureCuratedMcps.mockResolvedValue({
      changed: true,
      registered: true,
      servers: [{ id: 'weather-mcp', name: 'weather-mcp', type: 'local', command: ['npx', '-y', '@x/weather-mcp'], requiredEnv: [] }],
    });

    const { buildRealExternalAdoptionDeps } = await import('../org_proposal_appliers_wiring');
    const deps = buildRealExternalAdoptionDeps();
    const result = await deps.installCuratedMcp({
      serverName: 'weather-mcp',
      installCommand: 'npx -y @x/weather-mcp',
      agentConfigId: 'does-not-exist',
    });

    expect(result.changed).toBe(true);
    expect(result.beforeSnapshotJson).toBeUndefined();
  });
});

/**
 * C4-5 (docs/ai/contracts/issue-causal-runtime-v2.json, phase C4) — durable
 * apply of a refine-config proposal that has a VERIFIED (promote) experiment
 * must revalidate the tested baseline/candidate against the current durable
 * target, never applying a stale winner.
 */
describe('C4-5 — refine-config durable apply revalidates against its tested experiment', () => {
  const targetHash = `sha256:${'a'.repeat(64)}`;

  async function seedVerifiedExperiment(input: {
    proposalId: string;
    profileId: string;
    priorValue: string;
    candidateValue: string;
  }): Promise<void> {
    const { AgentOrgExperimentsRepository } = await import('../../repositories/agent_org_experiments_repository');
    const { getDb } = await import('../../database/db');
    const targetRef = `agent_config:${input.profileId}`;
    const spec = {
      agentConfigId: input.profileId,
      field: 'system_prompt',
      priorValue: input.priorValue,
      currentValue: input.priorValue,
      candidateValue: input.candidateValue,
      evidenceTarget: { ref: targetRef, hash: targetHash },
    };
    const experiments = new AgentOrgExperimentsRepository();
    const exp = await experiments.declareAsync({
      proposalId: input.proposalId,
      adapter: 'paired-cohort-outcome',
      evidenceBundleJson: JSON.stringify({ experimentAdapter: 'paired-cohort-outcome' }),
      baselineSpecJson: JSON.stringify(spec),
      candidateSpecJson: JSON.stringify(spec),
      assignmentKey: `exp-${input.proposalId}`,
      stoppingRule: { minSamplesPerCohort: 2, minEffect: 0.05 },
      maxExposure: 1000,
    });
    // Directly stamp a terminal 'promote' decision — this test proves the
    // APPLY-time revalidation, not the decision engine (already covered
    // exhaustively in org_proposal_experiment_service.test.ts).
    getDb().prepare(`UPDATE agent_org_experiments SET decision = 'promote' WHERE id = ?`).run(exp.id);
  }

  it('applies cleanly when the current target still matches the exact tested baseline and candidate bytes', async () => {
    const { registerAllProposalAppliers } = await import('../org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { applyProposal } = await import('../org_proposal_apply_service');
    const { AgentOrgProposalsRepository } = await import('../../repositories/agent_org_proposals_repository');

    const configsRepo = new AgentConfigsRepository();
    const profile = configsRepo.insert({ label: 'c4-5-clean', icon: 'x', systemPrompt: 'before' });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      status: 'proposed',
      title: 'refine system prompt',
      targetRef: `agent_config:${profile.id}`,
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: profile.id, field: 'system_prompt', value: 'after' },
      }),
    });
    await seedVerifiedExperiment({
      proposalId: proposal.id,
      profileId: profile.id,
      priorValue: 'before',
      candidateValue: 'after',
    });

    const result = await applyProposal(proposal);
    expect(result.measurable).toBe(true);
    expect(configsRepo.getById(profile.id)?.systemPrompt).toBe('after');
  });

  it('refuses (never applies a stale winner) when the target has drifted since the experiment was tested', async () => {
    const { registerAllProposalAppliers } = await import('../org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { applyProposal } = await import('../org_proposal_apply_service');
    const { AgentOrgProposalsRepository } = await import('../../repositories/agent_org_proposals_repository');

    const configsRepo = new AgentConfigsRepository();
    const profile = configsRepo.insert({ label: 'c4-5-drift', icon: 'x', systemPrompt: 'before' });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      status: 'proposed',
      title: 'refine system prompt',
      targetRef: `agent_config:${profile.id}`,
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: profile.id, field: 'system_prompt', value: 'after' },
      }),
    });
    await seedVerifiedExperiment({
      proposalId: proposal.id,
      profileId: profile.id,
      priorValue: 'before',
      candidateValue: 'after',
    });

    // The target moved AFTER the experiment tested it (e.g. a separate
    // approved edit), BEFORE this apply ever ran.
    configsRepo.update(profile.id, { systemPrompt: 'drifted-by-someone-else' });

    await expect(applyProposal(proposal)).rejects.toThrow(/target has drifted/i);
    // Never applies the stale winner — the drifted value is untouched.
    expect(configsRepo.getById(profile.id)?.systemPrompt).toBe('drifted-by-someone-else');
  });

  it("refuses when the proposal's own change_json no longer matches the exact tested candidate value", async () => {
    const { registerAllProposalAppliers } = await import('../org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { applyProposal } = await import('../org_proposal_apply_service');
    const { AgentOrgProposalsRepository } = await import('../../repositories/agent_org_proposals_repository');

    const configsRepo = new AgentConfigsRepository();
    const profile = configsRepo.insert({ label: 'c4-5-tamper', icon: 'x', systemPrompt: 'before' });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      status: 'proposed',
      title: 'refine system prompt',
      targetRef: `agent_config:${profile.id}`,
      // A DIFFERENT candidate value than the one the experiment tested.
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: profile.id, field: 'system_prompt', value: 'after-tampered' },
      }),
    });
    await seedVerifiedExperiment({
      proposalId: proposal.id,
      profileId: profile.id,
      priorValue: 'before',
      candidateValue: 'after',
    });

    await expect(applyProposal(proposal)).rejects.toThrow(/no longer matches the exact candidate/i);
    expect(configsRepo.getById(profile.id)?.systemPrompt).toBe('before');
  });

  it('is unaffected when the refine-config proposal has NO experiment at all (an untested human edit)', async () => {
    const { registerAllProposalAppliers } = await import('../org_proposal_appliers_wiring');
    registerAllProposalAppliers();
    const { applyProposal } = await import('../org_proposal_apply_service');
    const { AgentOrgProposalsRepository } = await import('../../repositories/agent_org_proposals_repository');

    const configsRepo = new AgentConfigsRepository();
    const profile = configsRepo.insert({ label: 'c4-5-untested', icon: 'x', systemPrompt: 'before' });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-config',
      risk: 'low',
      status: 'proposed',
      title: 'refine system prompt (no experiment)',
      targetRef: `agent_config:${profile.id}`,
      changeJson: JSON.stringify({
        configPatch: { agentConfigId: profile.id, field: 'system_prompt', value: 'after' },
      }),
    });

    const result = await applyProposal(proposal);
    expect(result.measurable).toBe(true);
    expect(configsRepo.getById(profile.id)?.systemPrompt).toBe('after');
  });
});

describe('D2.5 — direct post-apply eligibility metadata', () => {
  it.each([
    { field: 'model', value: 'anthropic/after', changeType: 'prompt' },
    { field: 'system_prompt', value: 'after prompt', changeType: 'prompt' },
    { field: 'allowedDelegatesJson', value: '["worker"]', changeType: 'tool' },
  ] as const)('refine-config $field emits $changeType metadata', async ({ field, value, changeType }) => {
    // Regression caught: an eligible existing-row mutation is applied but is
    // not enrolled under the approved prompt/tool lifecycle classification.
    const { registerAllProposalAppliers } = await import('../org_proposal_appliers_wiring');
    const { applyProposal } = await import('../org_proposal_apply_service');
    const { AgentOrgProposalsRepository } = await import('../../repositories/agent_org_proposals_repository');
    registerAllProposalAppliers();
    const configsRepo = new AgentConfigsRepository();
    const profile = configsRepo.insert({ label: `metadata-${field}`, icon: 'x' });
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'refine-config',
      risk: 'high',
      status: 'proposed',
      title: `metadata ${field}`,
      dedupKey: `metadata-${field}`,
      changeJson: JSON.stringify({ configPatch: { agentConfigId: profile.id, field, value } }),
    });

    const result = await applyProposal(proposal);
    expect(result.postApplyTarget).toEqual({ profileId: profile.id, changeType });
  });

  it.each(['allowedSkillsJson', 'allowedMcpsJson'] as const)(
    'refine-config never enrolls protected %s mutations',
    async (field) => {
      const { registerAllProposalAppliers } = await import('../org_proposal_appliers_wiring');
      const { applyProposal } = await import('../org_proposal_apply_service');
      const { AgentOrgProposalsRepository } = await import('../../repositories/agent_org_proposals_repository');
      registerAllProposalAppliers();
      const profile = new AgentConfigsRepository().insert({ label: `protected-${field}`, icon: 'x' });
      const proposal = await new AgentOrgProposalsRepository().createAsync({
        kind: 'refine-config', risk: 'high', status: 'proposed', title: `protected ${field}`,
        dedupKey: `protected-${field}`,
        changeJson: JSON.stringify({ configPatch: { agentConfigId: profile.id, field, value: '[]' } }),
      });

      await expect(applyProposal(proposal)).rejects.toThrow(/protected scope field/);
      expect(new AgentConfigsRepository().getById(profile.id)?.[field]).toBeNull();
    },
  );
});
