import { createHash } from 'node:crypto';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

async function activateProposal(input: {
  kind: string;
  changeJson: string;
  beforeSnapshotJson: string;
}) {
  const proposals = new AgentOrgProposalsRepository();
  const proposal = await proposals.createAsync({
    kind: input.kind,
    risk: 'high',
    title: `W1 corrective 4 ${input.kind}`,
    changeJson: input.changeJson,
    beforeSnapshotJson: input.beforeSnapshotJson,
    dedupKey: `w1-c4:${input.kind}:${crypto.randomUUID()}`,
  });
  await proposals.updateStatusAsync(proposal.id, 'applied');
  await proposals.updateStatusAsync(proposal.id, 'measuring');
  return (await proposals.updateStatusAsync(proposal.id, 'active'))!;
}

beforeEach(async () => {
  setDb(makeDb());
  const service = await import('../services/org_proposal_apply_service');
  service.resetProposalPluginsForTests();
  const wiring = await import('../services/org_proposal_appliers_wiring');
  wiring.registerAllProposalAppliers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('issue-W1-corrective-4-c1: strict live scope mutation contract', () => {
  it.each([
    {
      label: 'duplicate current removal',
      kind: 'refine-scope',
      prior: '["a","a","b"]',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedSkillsJson', remove: ['a'] } }),
    },
    {
      label: 'duplicate requested remove',
      kind: 'refine-scope',
      prior: '["a","b"]',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedSkillsJson', remove: ['a', 'a'] } }),
    },
    {
      label: 'present empty remove beside add',
      kind: 'refine-scope',
      prior: '["a"]',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedSkillsJson', add: ['b'], remove: [] } }),
    },
    {
      label: 'overlapping add and remove',
      kind: 'refine-scope',
      prior: '["a","b"]',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedSkillsJson', add: ['a'], remove: ['a'] } }),
    },
    {
      label: 'missing remove hidden beside valid add',
      kind: 'refine-scope',
      prior: '["a"]',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedSkillsJson', add: ['b'], remove: ['missing'] } }),
    },
    {
      label: 'duplicate add',
      kind: 'broaden-scope',
      prior: '["a"]',
      change: (id: string) => ({ agentConfigId: id, field: 'allowedSkillsJson', add: ['b', 'b'] }),
    },
    {
      label: 'mixed-type broaden add',
      kind: 'broaden-scope',
      prior: '["a"]',
      change: (id: string) => ({ agentConfigId: id, field: 'allowedSkillsJson', add: ['b', 42] }),
    },
    {
      label: 'broaden smuggled remove',
      kind: 'broaden-scope',
      prior: '["a"]',
      change: (id: string) => ({ agentConfigId: id, field: 'allowedSkillsJson', add: ['b'], remove: ['a'] }),
    },
  ])('refuses $label before preparation or claim', async ({ label, kind, prior, change }) => {
    // Regression caught: permissive extraction filtered or ignored an invalid
    // operation and claimed a different mutation than the exact change bytes.
    const applyService = await import('../services/org_proposal_apply_service');
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const claim = vi.spyOn(AgentOrgProposalsRepository.prototype, 'claimAppliedWithSnapshotAsync');
    const configs = new AgentConfigsRepository();
    const config = configs.insert({ label: `C4 ${label}`, icon: 'shield', allowedSkillsJson: prior });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind,
      risk: 'high',
      title: `C4 ${label}`,
      changeJson: JSON.stringify(change(config.id)),
      dedupKey: `w1-c4:strict:${label}`,
    });

    expect(await applyService.validateProposalChange(proposal)).toMatchObject({ valid: false });
    await expect(applyService.applyProposal(proposal)).rejects.toBeDefined();
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(prior);
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
    expect(claim).not.toHaveBeenCalled();
    expect(projection).not.toHaveBeenCalled();
  });
});

describe('issue-W1-corrective-4-c2: proposal-kind-bound semantic snapshots', () => {
  it.each([
    ['malformed prior JSON', '{not-json', '["b"]'],
    ['scalar allowlist prior', '42', '["b"]'],
    ['duplicate prior entries', '["a","a"]', '["a","a","b"]'],
    ['malformed applied JSON', '["a"]', '{not-json'],
  ] as const)('refuses scope-state construction for %s', async (_label, prior, applied) => {
    // Regression caught: byte hashes were self-consistent while the bound
    // prior/applied values were not semantically valid scope states.
    const { createScopeStateV2Snapshot } = await import('../services/org_proposal_apply');
    const changeJson = '{"agentConfigId":"cfg","field":"allowedSkillsJson","add":["b"]}';
    expect(() => (createScopeStateV2Snapshot as any)(
      'cfg', 'allowedSkillsJson', prior, applied, changeJson, 'broaden-scope',
    )).toThrow();
  });

  it.each([
    {
      label: 'non-object core prior',
      field: 'corePermissionsJson' as const,
      prior: '[]',
      applied: '{"read":"allow"}',
      kind: 'refine-scope' as const,
      changeJson: '{"scopePatch":{"agentConfigId":"cfg","field":"corePermissionsJson","set":{"read":"allow"}}}',
    },
    {
      label: 'reserved allowlist name',
      field: 'allowedSkillsJson' as const,
      prior: '["a"]',
      applied: '["a","__proto__"]',
      kind: 'broaden-scope' as const,
      changeJson: '{"agentConfigId":"cfg","field":"allowedSkillsJson","add":["__proto__"]}',
    },
    {
      label: 'duplicate operation names',
      field: 'allowedSkillsJson' as const,
      prior: '["a"]',
      applied: '["a","b"]',
      kind: 'broaden-scope' as const,
      changeJson: '{"agentConfigId":"cfg","field":"allowedSkillsJson","add":["b","b"]}',
    },
    {
      label: 'core semantic no-op',
      field: 'corePermissionsJson' as const,
      prior: '{"read":"allow"}',
      applied: '{"read":"allow"}',
      kind: 'refine-scope' as const,
      changeJson: '{"scopePatch":{"agentConfigId":"cfg","field":"corePermissionsJson","set":{"read":"allow"}}}',
    },
  ])('refuses scope-state construction for $label', async ({ field, prior, applied, kind, changeJson }) => {
    const { createScopeStateV2Snapshot } = await import('../services/org_proposal_apply');
    expect(() => createScopeStateV2Snapshot('cfg', field, prior, applied, changeJson, kind)).toThrow();
  });

  it.each([
    { label: 'malformed prior JSON', mutate: (snapshot: Record<string, any>) => { snapshot.priorValue = '{not-json'; } },
    { label: 'scalar prior JSON', mutate: (snapshot: Record<string, any>) => { snapshot.priorValue = '42'; } },
    {
      label: 'malformed applied JSON',
      mutate: (snapshot: Record<string, any>) => {
        snapshot.expectedAppliedValue = '{not-json';
        snapshot.expectedAppliedHash = createHash('sha256').update(snapshot.expectedAppliedValue).digest('hex');
      },
    },
  ])('independently rejects integrity-valid forged state with $label', async ({ label, mutate }) => {
    // Regression caught: revert trusted constructor-shaped hashes instead of
    // replaying exact prior bytes plus exact change bytes itself.
    const { createScopeStateV2Snapshot, revertProposal } = await import('../services/org_proposal_apply');
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const configs = new AgentConfigsRepository();
    const prior = '["a"]';
    const applied = '["a","b"]';
    const config = configs.insert({ label: `C4 forged ${label}`, icon: 'shield', allowedSkillsJson: applied });
    const changeJson = JSON.stringify({ agentConfigId: config.id, field: 'allowedSkillsJson', add: ['b'] });
    const snapshot = createScopeStateV2Snapshot(
      config.id, 'allowedSkillsJson', prior, applied, changeJson, 'broaden-scope',
    ) as unknown as Record<string, any>;
    mutate(snapshot);
    const { integrityHash: _oldIntegrity, ...material } = snapshot;
    snapshot.integrityHash = createHash('sha256').update(JSON.stringify(material)).digest('hex');
    const active = await activateProposal({
      kind: 'broaden-scope', changeJson, beforeSnapshotJson: JSON.stringify(snapshot),
    });

    expect(await revertProposal(active)).toBe('conflict');
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(applied);
    expect((await new AgentOrgProposalsRepository().findByIdAsync(active.id))?.status).toBe('active');
    expect(projection).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'non-object core prior',
      field: 'corePermissionsJson' as const,
      kind: 'refine-scope' as const,
      seedPrior: '{"read":"ask"}',
      seedApplied: '{"read":"allow"}',
      prior: '[]',
      applied: '{"read":"allow"}',
      change: (id: string) => JSON.stringify({
        scopePatch: { agentConfigId: id, field: 'corePermissionsJson', set: { read: 'allow' } },
      }),
    },
    {
      label: 'reserved allowlist name',
      field: 'allowedSkillsJson' as const,
      kind: 'broaden-scope' as const,
      seedPrior: '["a"]',
      seedApplied: '["a","b"]',
      prior: '["a"]',
      applied: '["a","__proto__"]',
      change: (id: string) => JSON.stringify({
        agentConfigId: id, field: 'allowedSkillsJson', add: ['__proto__'],
      }),
    },
    {
      label: 'duplicate operation names',
      field: 'allowedSkillsJson' as const,
      kind: 'broaden-scope' as const,
      seedPrior: '["a"]',
      seedApplied: '["a","b"]',
      prior: '["a"]',
      applied: '["a","b"]',
      change: (id: string) => JSON.stringify({
        agentConfigId: id, field: 'allowedSkillsJson', add: ['b', 'b'],
      }),
    },
    {
      label: 'core semantic no-op',
      field: 'corePermissionsJson' as const,
      kind: 'refine-scope' as const,
      seedPrior: '{"read":"ask"}',
      seedApplied: '{"read":"allow"}',
      prior: '{"read":"allow"}',
      applied: '{"read":"allow"}',
      change: (id: string) => JSON.stringify({
        scopePatch: { agentConfigId: id, field: 'corePermissionsJson', set: { read: 'allow' } },
      }),
    },
  ])('refuses integrity-valid forged revert for $label', async ({
    label, field, kind, seedPrior, seedApplied, prior, applied, change,
  }) => {
    const { createScopeStateV2Snapshot, revertProposal } = await import('../services/org_proposal_apply');
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const configs = new AgentConfigsRepository();
    const config = configs.insert({
      label: `C4 forged semantic ${label}`,
      icon: 'shield',
      [field]: applied,
    });
    const seedChange = field === 'corePermissionsJson'
      ? JSON.stringify({
        scopePatch: { agentConfigId: config.id, field, set: { read: 'allow' } },
      })
      : JSON.stringify({ agentConfigId: config.id, field, add: ['b'] });
    const snapshot = createScopeStateV2Snapshot(
      config.id, field, seedPrior, seedApplied, seedChange, kind,
    ) as unknown as Record<string, any>;
    const changeJson = change(config.id);
    snapshot.priorValue = prior;
    snapshot.expectedAppliedValue = applied;
    snapshot.expectedAppliedHash = createHash('sha256').update(applied).digest('hex');
    snapshot.changeJsonHash = createHash('sha256').update(changeJson).digest('hex');
    snapshot.semanticProofHash = '0'.repeat(64);
    const { integrityHash: _oldIntegrity, ...material } = snapshot;
    snapshot.integrityHash = createHash('sha256').update(JSON.stringify(material)).digest('hex');
    const active = await activateProposal({
      kind, changeJson, beforeSnapshotJson: JSON.stringify(snapshot),
    });

    expect(await revertProposal(active)).toBe('conflict');
    expect(configs.getById(config.id)?.[field]).toBe(applied);
    expect((await new AgentOrgProposalsRepository().findByIdAsync(active.id))?.status).toBe('active');
    expect(projection).not.toHaveBeenCalled();
  });

  it('refuses a valid scope-state snapshot under a non-scope proposal kind', async () => {
    // Regression caught: snapshot.version alone authorized a whole-field
    // restore even when the live proposal was mislabeled refine-recipe.
    const { createScopeStateV2Snapshot, revertProposal } = await import('../services/org_proposal_apply');
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const configs = new AgentConfigsRepository();
    const prior = '["a"]';
    const applied = '["a","b"]';
    const config = configs.insert({ label: 'C4 mislabeled state', icon: 'shield', allowedSkillsJson: applied });
    const changeJson = JSON.stringify({ agentConfigId: config.id, field: 'allowedSkillsJson', add: ['b'] });
    const snapshot = (createScopeStateV2Snapshot as any)(
      config.id, 'allowedSkillsJson', prior, applied, changeJson, 'broaden-scope',
    );
    const active = await activateProposal({
      kind: 'refine-recipe', changeJson, beforeSnapshotJson: JSON.stringify(snapshot),
    });

    expect(await revertProposal(active)).toBe('conflict');
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(applied);
    expect((await new AgentOrgProposalsRepository().findByIdAsync(active.id))?.status).toBe('active');
    expect(projection).not.toHaveBeenCalled();
  });

  it('binds scope-delta revert to byte-exact change_json', async () => {
    // Regression caught: semantically equivalent JSON with different bytes
    // passed delta reversion because only the parsed remove list was checked.
    const { createScopeDeltaV2Snapshot, revertProposal } = await import('../services/org_proposal_apply');
    const configs = new AgentConfigsRepository();
    const prior = '["x","y"]';
    const config = configs.insert({ label: 'C4 delta bytes', icon: 'shield', allowedSkillsJson: prior });
    const originalChange = JSON.stringify({ agentConfigId: config.id, field: 'allowedSkillsJson', remove: ['x'] });
    const snapshot = (createScopeDeltaV2Snapshot as any)(
      config.id, 'allowedSkillsJson', prior, ['x'], 'prune-scope', originalChange,
    );
    configs.update(config.id, { allowedSkillsJson: snapshot.expectedAppliedValue });
    const liveChange = ` { "agentConfigId": "${config.id}", "field": "allowedSkillsJson", "remove": [ "x" ] } `;
    const active = await activateProposal({
      kind: 'prune-scope', changeJson: liveChange, beforeSnapshotJson: JSON.stringify(snapshot),
    });

    expect(await revertProposal(active)).toBe('conflict');
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(snapshot.expectedAppliedValue);
    expect((await new AgentOrgProposalsRepository().findByIdAsync(active.id))?.status).toBe('active');
  });

  it('returns a deliberate unsafe result for parseable null scope snapshots', async () => {
    // Regression caught: JSON null reached snapshot.version and only failed
    // through a caught TypeError, obscuring the fail-closed lifecycle result.
    const { revertProposal } = await import('../services/org_proposal_apply');
    const active = await activateProposal({
      kind: 'refine-scope',
      changeJson: '{"scopePatch":{"agentConfigId":"cfg","field":"allowedSkillsJson","add":["b"]}}',
      beforeSnapshotJson: 'null',
    });
    expect(await revertProposal(active)).toBe('unsafe-legacy-scope');
    expect((await new AgentOrgProposalsRepository().findByIdAsync(active.id))?.status).toBe('active');
  });
});

describe('issue-W1-corrective-4-c3: recursive scope risk and human gate', () => {
  it.each([
    { wrapper: { scopePatch: { agentConfigId: 'cfg', field: 'corePermissionsJson', set: { read: 'allow' } } } },
    { wrapper: { scopePatch: { agentConfigId: 'cfg', field: 'corePermissionsJson', unset: ['read'] } } },
    { agentConfigId: 'cfg', field: 'corePermissionsJson', read: 'allow' },
  ])('classifies recursively nested core scope as high', async (change) => {
    // Regression caught: core set/unset content under a text-only kind could
    // enter unattended apply because only allowlist aliases were inspected.
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(classifyProposalRisk({ kind: 'refine-recipe', changeJson: JSON.stringify(change) })).toBe('high');
  });

  it('refuses nested core scope from unattended apply without lifecycle effects', async () => {
    const { applyProposal } = await import('../services/org_proposal_apply');
    const configs = new AgentConfigsRepository();
    const prior = '{"read":"ask"}';
    const config = configs.insert({ label: 'C4 auto core', icon: 'shield', corePermissionsJson: prior });
    const changeJson = JSON.stringify({
      wrapper: { scopePatch: { agentConfigId: config.id, field: 'corePermissionsJson', set: { read: 'allow' } } },
    });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-recipe', risk: 'low', title: 'C4 auto core', changeJson,
      dedupKey: 'w1-c4:auto-core',
    });

    expect(await applyProposal(proposal, { proposalsRepo: proposals, configsRepo: configs }))
      .toMatchObject({ status: 'refused-high-risk' });
    expect(configs.getById(config.id)?.corePermissionsJson).toBe(prior);
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed', beforeSnapshotJson: null, decidedByUserId: null,
    });
  });

  it('preserves low risk for unrelated text containing set/unset words', async () => {
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(classifyProposalRisk({
      kind: 'refine-recipe',
      changeJson: JSON.stringify({ revisedBody: 'Set the table, then unset the reminder.' }),
    })).toBe('low');
  });
});

describe('issue-W1-corrective-4-c4: final status failure compensation', () => {
  it.each([
    { kind: 'broaden-scope', version: 'state' as const },
    { kind: 'prune-scope', version: 'delta' as const },
  ])('re-applies exact target bytes when $version status transition throws', async ({ kind, version }) => {
    // Regression caught: target restore succeeded, final status update threw,
    // and the proposal stayed active against the wrong target bytes.
    const apply = await import('../services/org_proposal_apply');
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('written');
    const configs = new AgentConfigsRepository();
    const prior = version === 'state' ? '["a"]' : '["x","y"]';
    const applied = version === 'state' ? '["a","b"]' : '["y"]';
    const config = configs.insert({ label: `C4 status ${version}`, icon: 'shield', allowedSkillsJson: applied });
    const changeJson = version === 'state'
      ? JSON.stringify({ agentConfigId: config.id, field: 'allowedSkillsJson', add: ['b'] })
      : JSON.stringify({ agentConfigId: config.id, field: 'allowedSkillsJson', remove: ['x'] });
    const snapshot = version === 'state'
      ? (apply.createScopeStateV2Snapshot as any)(config.id, 'allowedSkillsJson', prior, applied, changeJson, kind)
      : (apply.createScopeDeltaV2Snapshot as any)(config.id, 'allowedSkillsJson', prior, ['x'], kind, changeJson);
    const active = await activateProposal({ kind, changeJson, beforeSnapshotJson: JSON.stringify(snapshot) });
    getDb().exec(`CREATE TRIGGER fail_reverted_status BEFORE UPDATE ON agent_org_proposals
      WHEN NEW.status = 'reverted' BEGIN SELECT RAISE(ABORT, 'forced reverted-status failure'); END;`);

    expect(await apply.revertProposal(active)).toBe('conflict');
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(applied);
    expect((await new AgentOrgProposalsRepository().findByIdAsync(active.id))?.status).toBe('active');
    expect(projection).toHaveBeenCalledTimes(2);
  });

  it('treats a null final status result as failure and compensates', async () => {
    const apply = await import('../services/org_proposal_apply');
    const writer = await import('../services/opencode_agent_writer');
    vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('written');
    const configs = new AgentConfigsRepository();
    const prior = '["a"]';
    const applied = '["a","b"]';
    const config = configs.insert({ label: 'C4 null status', icon: 'shield', allowedSkillsJson: applied });
    const changeJson = JSON.stringify({ agentConfigId: config.id, field: 'allowedSkillsJson', add: ['b'] });
    const snapshot = (apply.createScopeStateV2Snapshot as any)(
      config.id, 'allowedSkillsJson', prior, applied, changeJson, 'broaden-scope',
    );
    const active = await activateProposal({
      kind: 'broaden-scope', changeJson, beforeSnapshotJson: JSON.stringify(snapshot),
    });
    const proposals = new AgentOrgProposalsRepository();
    const original = proposals.updateStatusAsync.bind(proposals);
    vi.spyOn(proposals, 'updateStatusAsync').mockImplementation(async (id, status, patch) =>
      status === 'reverted' ? null : original(id, status, patch));

    expect(await apply.revertProposal(active, { proposalsRepo: proposals, configsRepo: configs })).toBe('conflict');
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(applied);
    expect((await new AgentOrgProposalsRepository().findByIdAsync(active.id))?.status).toBe('active');
  });

  it('preserves concurrent bytes when final-status compensation loses CAS', async () => {
    const apply = await import('../services/org_proposal_apply');
    const writer = await import('../services/opencode_agent_writer');
    vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('written');
    const configs = new AgentConfigsRepository();
    const prior = '["a"]';
    const applied = '["a","b"]';
    const concurrent = '["operator"]';
    const config = configs.insert({ label: 'C4 compensation miss', icon: 'shield', allowedSkillsJson: applied });
    const changeJson = JSON.stringify({ agentConfigId: config.id, field: 'allowedSkillsJson', add: ['b'] });
    const snapshot = (apply.createScopeStateV2Snapshot as any)(
      config.id, 'allowedSkillsJson', prior, applied, changeJson, 'broaden-scope',
    );
    const active = await activateProposal({
      kind: 'broaden-scope', changeJson, beforeSnapshotJson: JSON.stringify(snapshot),
    });
    getDb().exec(`CREATE TRIGGER fail_reverted_status BEFORE UPDATE ON agent_org_proposals
      WHEN NEW.status = 'reverted' BEGIN SELECT RAISE(ABORT, 'forced reverted-status failure'); END;`);
    const originalCas = AgentConfigsRepository.prototype.compareAndSetScopeField;
    let calls = 0;
    vi.spyOn(AgentConfigsRepository.prototype, 'compareAndSetScopeField')
      .mockImplementation(function (this: AgentConfigsRepository, ...args) {
        calls += 1;
        if (calls === 2) configs.update(config.id, { allowedSkillsJson: concurrent });
        return originalCas.apply(this, args);
      });

    expect(await apply.revertProposal(active)).toBe('conflict');
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(concurrent);
    expect((await new AgentOrgProposalsRepository().findByIdAsync(active.id))?.status).toBe('active');
  });
});

describe('issue-W1-corrective-4-c5: normal exact scope mutations stay supported', () => {
  it.each([
    {
      label: 'array add/remove',
      prior: '["a","b"]',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedSkillsJson', add: ['c'], remove: ['a'] } }),
      expected: '["b","c"]',
    },
    {
      label: 'ordinary-key tools map',
      prior: '{"toString":["read"],"hasOwnProperty":null}',
      change: (id: string) => ({ scopePatch: { agentConfigId: id, field: 'allowedSkillsJson', add: ['next'], remove: ['toString'] } }),
      expected: '{"hasOwnProperty":null,"next":[]}',
    },
  ])('prepares an unambiguous $label mutation exactly', async ({ label, prior, change, expected }) => {
    const service = await import('../services/org_proposal_apply_service');
    const configs = new AgentConfigsRepository();
    const config = configs.insert({ label: `C4 green ${label}`, icon: 'shield', allowedSkillsJson: prior });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-scope', risk: 'high', title: `C4 green ${label}`,
      changeJson: JSON.stringify(change(config.id)), dedupKey: `w1-c4:green:${label}`,
    });

    expect(await service.validateProposalChange(proposal)).toEqual({ valid: true });
    const prepared = await service.applyProposal(proposal);
    expect(JSON.parse(prepared.beforeSnapshotJson ?? 'null')).toMatchObject({
      proposalKind: 'refine-scope', expectedAppliedValue: expected,
    });
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(prior);
  });

  it('prepares an unambiguous core set/unset mutation exactly', async () => {
    const service = await import('../services/org_proposal_apply_service');
    const configs = new AgentConfigsRepository();
    const prior = '{"read":"ask","edit":"allow"}';
    const config = configs.insert({ label: 'C4 green core', icon: 'shield', corePermissionsJson: prior });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-scope',
      risk: 'high',
      title: 'C4 green core',
      changeJson: JSON.stringify({
        scopePatch: {
          agentConfigId: config.id,
          field: 'corePermissionsJson',
          set: { read: 'allow' },
          unset: ['edit'],
        },
      }),
      dedupKey: 'w1-c4:green:core',
    });

    expect(await service.validateProposalChange(proposal)).toEqual({ valid: true });
    const prepared = await service.applyProposal(proposal);
    expect(JSON.parse(prepared.beforeSnapshotJson ?? 'null')).toMatchObject({
      proposalKind: 'refine-scope',
      expectedAppliedValue: '{"read":"allow"}',
    });
    expect(configs.getById(config.id)?.corePermissionsJson).toBe(prior);
  });
});
