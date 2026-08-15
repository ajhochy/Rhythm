import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(async () => {
  setDb(makeDb());
  vi.restoreAllMocks();
  const service = await import('../services/org_proposal_apply_service');
  service.resetProposalPluginsForTests();
  const wiring = await import('../services/org_proposal_appliers_wiring');
  wiring.registerAllProposalAppliers();
});

async function makeDuplicateRefineConfigProposal() {
  const configs = new AgentConfigsRepository();
  const config = configs.insert({
    label: 'Corrective 6 strict config boundary',
    icon: 'shield',
    modelProvider: 'safe-provider',
    modelId: 'safe-model',
  });
  const first = JSON.stringify({
    agentConfigId: config.id,
    field: 'model',
    value: 'first-provider/first-model',
  });
  const second = JSON.stringify({
    agentConfigId: config.id,
    field: 'model',
    value: 'second-provider/second-model',
  });
  const changeJson = `{"configPatch":${first},"configPatch":${second}}`;
  const proposals = new AgentOrgProposalsRepository();
  const proposal = await proposals.createAsync({
    kind: 'refine-config',
    risk: 'high',
    title: 'Corrective 6 duplicate config patch',
    changeJson,
    dedupKey: `w1-c6:duplicate-config:${crypto.randomUUID()}`,
  });
  return { configs, config, proposals, proposal, changeJson };
}

describe('W1 corrective 6 A1: strict common human boundary', () => {
  it('validation rejects duplicate configPatch bytes without side effects', async () => {
    const fixture = await makeDuplicateRefineConfigProposal();
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const service = await import('../services/org_proposal_apply_service');

    await expect(service.validateProposalChange(fixture.proposal)).resolves.toMatchObject({
      valid: false,
    });
    expect(fixture.configs.getById(fixture.config.id)).toMatchObject({
      modelProvider: 'safe-provider',
      modelId: 'safe-model',
    });
    expect(await fixture.proposals.findByIdAsync(fixture.proposal.id)).toMatchObject({
      status: 'proposed',
      changeJson: fixture.changeJson,
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
    expect(projection).not.toHaveBeenCalled();
  });

  it('direct human apply independently rejects duplicate configPatch bytes without side effects', async () => {
    const fixture = await makeDuplicateRefineConfigProposal();
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const service = await import('../services/org_proposal_apply_service');

    await expect(service.applyProposal(fixture.proposal)).rejects.toThrow(/duplicate/i);
    expect(fixture.configs.getById(fixture.config.id)).toMatchObject({
      modelProvider: 'safe-provider',
      modelId: 'safe-model',
    });
    expect(await fixture.proposals.findByIdAsync(fixture.proposal.id)).toMatchObject({
      status: 'proposed',
      changeJson: fixture.changeJson,
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
    expect(projection).not.toHaveBeenCalled();
  });
});

describe('W1 corrective 6 A2: protected scope cannot use generic kinds', () => {
  it.each([
    ['allowedMcpsJson', '["mcp-only"]'],
    ['allowedSkillsJson', '["skill-only"]'],
    ['corePermissionsJson', '{"read":"deny"}'],
  ] as const)(
    'common validation rejects refine-config targeting %s without effects',
    async (field, value) => {
      const configs = new AgentConfigsRepository();
      const config = configs.insert({
        label: `Corrective 6 protected ${field}`,
        icon: 'shield',
        allowedMcpsJson: null,
        allowedSkillsJson: null,
        corePermissionsJson: null,
      });
      const proposals = new AgentOrgProposalsRepository();
      const proposal = await proposals.createAsync({
        kind: 'refine-config',
        risk: 'high',
        title: `Corrective 6 protected ${field}`,
        changeJson: JSON.stringify({
          configPatch: { agentConfigId: config.id, field, value },
        }),
        dedupKey: `w1-c6:protected-validation:${field}:${crypto.randomUUID()}`,
      });
      const writer = await import('../services/opencode_agent_writer');
      const projection = vi.spyOn(writer, 'writeAgentProfileFile');
      const service = await import('../services/org_proposal_apply_service');

      await expect(service.validateProposalChange(proposal)).resolves.toMatchObject({ valid: false });
      expect(configs.getById(config.id)).toMatchObject({
        allowedMcpsJson: null,
        allowedSkillsJson: null,
        corePermissionsJson: null,
      });
      expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
        status: 'proposed',
        beforeSnapshotJson: null,
        decidedByUserId: null,
      });
      expect(projection).not.toHaveBeenCalled();
    },
  );

  it('the generic refine-config applier defensively rejects protected scope even if its validator is bypassed', async () => {
    const configs = new AgentConfigsRepository();
    const config = configs.insert({
      label: 'Corrective 6 direct generic scope defense',
      icon: 'shield',
      allowedSkillsJson: null,
    });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-config',
      risk: 'high',
      title: 'Corrective 6 direct generic scope defense',
      changeJson: JSON.stringify({
        configPatch: {
          agentConfigId: config.id,
          field: 'allowedSkillsJson',
          value: '["only"]',
        },
      }),
      dedupKey: `w1-c6:protected-direct:${crypto.randomUUID()}`,
    });
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const wiring = await import('../services/org_proposal_appliers_wiring');
    let directApplier: ((value: typeof proposal) => unknown) | undefined;
    wiring.registerAllProposalAppliers({
      registerProposalValidator: () => undefined,
      registerProposalApplier: (kind, applier) => {
        if (kind === 'refine-config') directApplier = applier;
      },
    });

    expect(directApplier).toBeTypeOf('function');
    expect(() => directApplier?.(proposal)).toThrow(/scope|protected|field/i);
    expect(configs.getById(config.id)?.allowedSkillsJson).toBeNull();
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
    expect(projection).not.toHaveBeenCalled();
  });

  it('the direct refine-config applier rejects unconsumed configPatch keys', async () => {
    const configs = new AgentConfigsRepository();
    const config = configs.insert({
      label: 'Corrective 6 direct nested smuggle',
      icon: 'shield',
      modelProvider: 'safe-provider',
      modelId: 'safe-model',
    });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-config',
      risk: 'high',
      title: 'Corrective 6 direct nested smuggle',
      changeJson: JSON.stringify({
        configPatch: {
          agentConfigId: config.id,
          field: 'model',
          value: 'other-provider/other-model',
          hidden: { allowedSkillsJson: ['smuggled-skill'] },
        },
      }),
      dedupKey: `w1-c6:direct-nested-smuggle:${crypto.randomUUID()}`,
    });
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const wiring = await import('../services/org_proposal_appliers_wiring');
    let directApplier: ((value: typeof proposal) => unknown) | undefined;
    wiring.registerAllProposalAppliers({
      registerProposalValidator: () => undefined,
      registerProposalApplier: (kind, applier) => {
        if (kind === 'refine-config') directApplier = applier;
      },
    });

    expect(directApplier).toBeTypeOf('function');
    expect(() => directApplier?.(proposal)).toThrow(/configPatch|missing|unsupported/i);
    expect(configs.getById(config.id)).toMatchObject({
      modelProvider: 'safe-provider',
      modelId: 'safe-model',
    });
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({ status: 'proposed' });
    expect(projection).not.toHaveBeenCalled();
  });

  it('rejects protected scope hidden beside an otherwise valid generic config patch', async () => {
    const configs = new AgentConfigsRepository();
    const config = configs.insert({
      label: 'Corrective 6 mixed generic payload',
      icon: 'shield',
      modelProvider: 'safe-provider',
      modelId: 'safe-model',
      allowedSkillsJson: null,
    });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-config',
      risk: 'high',
      title: 'Corrective 6 hidden protected scope',
      changeJson: JSON.stringify({
        configPatch: {
          agentConfigId: config.id,
          field: 'model',
          value: 'other-provider/other-model',
        },
        hiddenScope: {
          allowedSkillsJson: ['only-this-skill'],
        },
      }),
      dedupKey: `w1-c6:hidden-scope:${crypto.randomUUID()}`,
    });
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const service = await import('../services/org_proposal_apply_service');

    await expect(service.validateProposalChange(proposal)).resolves.toMatchObject({ valid: false });
    expect(configs.getById(config.id)).toMatchObject({
      modelProvider: 'safe-provider',
      modelId: 'safe-model',
      allowedSkillsJson: null,
    });
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
    expect(projection).not.toHaveBeenCalled();
  });

  it('rejects protected scope hidden inside a generic config patch without effects', async () => {
    const configs = new AgentConfigsRepository();
    const config = configs.insert({
      label: 'Corrective 6 nested generic smuggle',
      icon: 'shield',
      modelProvider: 'safe-provider',
      modelId: 'safe-model',
    });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-config',
      risk: 'high',
      title: 'Corrective 6 nested protected scope',
      changeJson: JSON.stringify({
        configPatch: {
          agentConfigId: config.id,
          field: 'model',
          value: 'other-provider/other-model',
          hidden: { allowedSkillsJson: ['smuggled-skill'] },
          removeSkills: ['another-smuggled-marker'],
        },
      }),
      dedupKey: `w1-c6:nested-hidden-scope:${crypto.randomUUID()}`,
    });
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const service = await import('../services/org_proposal_apply_service');

    await expect(service.validateProposalChange(proposal)).resolves.toMatchObject({ valid: false });
    await expect(service.applyProposal(proposal)).rejects.toThrow(/scope|unsupported|configPatch/i);
    expect(configs.getById(config.id)).toMatchObject({
      modelProvider: 'safe-provider',
      modelId: 'safe-model',
    });
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
    expect(projection).not.toHaveBeenCalled();
  });
});

describe('W1 corrective 6 A3: recursive detector aggregates subtree context', () => {
  it('preserves canonical agent-targeting non-scope operations while scanning their extras', async () => {
    const scope = await import('../services/scope_mutation_contract');

    expect(scope.containsScopeBearingPayload({
      agentConfigId: 'manager',
      allowed_delegates_json: { add: ['specialist'] },
    })).toBe(false);
    expect(scope.containsScopeBearingPayload({
      agentConfigId: 'manager',
      allowed_delegates_json: {
        add: ['specialist'],
        hidden: { allowedSkillsJson: ['smuggled-skill'] },
      },
    })).toBe(true);
  });

  it.each([
    ['string', 'cfg'],
    ['number', 42],
    ['null', null],
    ['array', ['cfg']],
    ['object', { id: 'cfg' }],
  ])('treats own agentConfigId presence as target evidence for %s values', async (_label, value) => {
    const scope = await import('../services/scope_mutation_contract');
    const risk = await import('../services/org_risk_classifier');
    const change = { agentConfigId: value, operation: { remove: ['grant'] } };

    expect(scope.containsScopeBearingPayload(change)).toBe(true);
    expect(risk.classifyProposalRisk({
      kind: 'refine-recipe',
      changeJson: JSON.stringify(change),
    })).toBe('high');
  });

  it.each([
    ['array target then operation', { wrapper: [{ agentConfigId: 'cfg' }, { operation: { remove: ['x'] } }] }],
    ['array operation then target', { wrapper: [{ operation: { remove: ['x'] } }, { agentConfigId: 'cfg' }] }],
    ['object sibling target then operation', { wrapper: { left: { agentConfigId: 'cfg' }, right: { add: ['x'] } } }],
    ['object sibling operation then target', { wrapper: { left: { unset: ['read'] }, right: { agentConfigId: 'cfg' } } }],
    ['malformed typed target', { wrapper: [{ target: { type: 'agent_config', id: 42 } }, { set: { read: 'allow' } }] }],
  ])('aggregates target and operation evidence across %s', async (_label, change) => {
    const scope = await import('../services/scope_mutation_contract');
    const risk = await import('../services/org_risk_classifier');

    expect(scope.containsScopeBearingPayload(change)).toBe(true);
    expect(risk.classifyProposalRisk({
      kind: 'refine-recipe',
      changeJson: JSON.stringify(change),
    })).toBe('high');
  });

  it.each([
    { revisedBody: 'Add clarity, remove repetition, set expectations, and unset ambiguity.' },
    { recipePatch: { add: ['salt'], remove: ['pepper'] } },
    { wrapper: [{ recipePatch: { set: 'table', unset: 'alarm' } }, { note: 'remove it' }] },
  ])('preserves unrelated prose and recipe controls', async (change) => {
    const scope = await import('../services/scope_mutation_contract');
    const risk = await import('../services/org_risk_classifier');

    expect(scope.containsScopeBearingPayload(change)).toBe(false);
    expect(risk.classifyProposalRisk({
      kind: 'refine-recipe',
      changeJson: JSON.stringify(change),
    })).toBe('low');
  });

  it('refuses split-context scope evidence in unattended apply without lifecycle or target effects', async () => {
    const configs = new AgentConfigsRepository();
    const config = configs.insert({
      label: 'Corrective 6 unattended detector target',
      icon: 'shield',
      allowedSkillsJson: '["base"]',
    });
    const proposals = new AgentOrgProposalsRepository();
    const changeJson = JSON.stringify({
      wrapper: [{ agentConfigId: config.id }, { operation: { remove: ['base'] } }],
    });
    const proposal = await proposals.createAsync({
      kind: 'refine-recipe',
      risk: 'low',
      title: 'Corrective 6 unattended split detector',
      changeJson,
      dedupKey: `w1-c6:detector-unattended:${crypto.randomUUID()}`,
    });
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const unattended = await import('../services/org_proposal_apply');

    await expect(unattended.applyProposal(proposal, { proposalsRepo: proposals }))
      .resolves.toMatchObject({ status: 'refused-high-risk' });
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe('["base"]');
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
    expect(projection).not.toHaveBeenCalled();
  });

  it('refuses malformed target evidence at the human boundary even with a permissive kind validator', async () => {
    const proposals = new AgentOrgProposalsRepository();
    const changeJson = JSON.stringify({ agentConfigId: null, operation: { add: ['grant'] } });
    const proposal = await proposals.createAsync({
      kind: 'test-nonscope-kind',
      risk: 'high',
      title: 'Corrective 6 human malformed detector',
      changeJson,
      dedupKey: `w1-c6:detector-human:${crypto.randomUUID()}`,
    });
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const service = await import('../services/org_proposal_apply_service');
    service.registerProposalValidator('test-nonscope-kind', () => ({ valid: true }));

    await expect(service.validateProposalChange(proposal)).resolves.toMatchObject({ valid: false });
    await expect(service.applyProposal(proposal)).rejects.toThrow(/scope|protected/i);
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
    expect(projection).not.toHaveBeenCalled();
  });
});

describe('W1 corrective 6 A4: exact raw kind policy', () => {
  it.each([
    ' refine-recipe ',
    'refine-recipe ',
    '\trefine-recipe\n',
    '   ',
    '',
    'unknown-kind',
  ])('classifies non-member raw kind %j as high', async (kind) => {
    const risk = await import('../services/org_risk_classifier');
    expect(risk.classifyProposalRisk({ kind })).toBe('high');
  });

  it.each(['refine-skill', 'consolidate-skill', 'refine-recipe'])(
    'keeps exact low-risk member %s low',
    async (kind) => {
      const risk = await import('../services/org_risk_classifier');
      expect(risk.classifyProposalRisk({ kind })).toBe('low');
    },
  );

  it('refuses a whitespace-padded low kind in unattended apply without status effects', async () => {
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: ' refine-recipe ',
      risk: 'low',
      title: 'Corrective 6 whitespace kind',
      changeJson: JSON.stringify({ revisedBody: 'Safe prose only.' }),
      dedupKey: `w1-c6:whitespace-kind:${crypto.randomUUID()}`,
    });
    const unattended = await import('../services/org_proposal_apply');

    await expect(unattended.applyProposal(proposal, { proposalsRepo: proposals }))
      .resolves.toMatchObject({ status: 'refused-high-risk' });
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
  });

  it('uses exact raw membership for the security-note kind gate', async () => {
    const risk = await import('../services/org_risk_classifier');
    expect(risk.requiresSecurityNote('webhook-wiring')).toBe(true);
    expect(risk.requiresSecurityNote(' webhook-wiring ')).toBe(false);
  });
});

describe('W1 corrective 6 A5: field-specific effective semantics', () => {
  it('rejects tools-map bytes for allowedSkillsJson while preserving allowedMcpsJson tools-map support', async () => {
    const scope = await import('../services/scope_mutation_contract');
    const skillsChange = JSON.stringify({
      scopePatch: {
        agentConfigId: 'cfg',
        field: 'allowedSkillsJson',
        add: ['new-skill'],
      },
    });
    const mcpsChange = JSON.stringify({
      scopePatch: {
        agentConfigId: 'cfg',
        field: 'allowedMcpsJson',
        add: ['new-mcp'],
      },
    });

    expect(() => scope.prepareScopeMutation(
      'refine-scope',
      skillsChange,
      '{"existing":null}',
    )).toThrow(/allowedSkillsJson|array|shape/i);
    expect(scope.prepareScopeMutation(
      'refine-scope',
      mcpsChange,
      '{"existing":null}',
    ).expectedAppliedValue).toBe('{"existing":null,"new-mcp":[]}');
  });

  it('human apply rejects an allowedSkillsJson map before snapshot, target, status, or projection effects', async () => {
    const configs = new AgentConfigsRepository();
    const prior = '{"existing":null}';
    const config = configs.insert({
      label: 'Corrective 6 skills shape boundary',
      icon: 'shield',
      allowedSkillsJson: prior,
    });
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-scope',
      risk: 'high',
      title: 'Corrective 6 skills shape boundary',
      changeJson: JSON.stringify({
        scopePatch: {
          agentConfigId: config.id,
          field: 'allowedSkillsJson',
          add: ['new-skill'],
        },
      }),
      dedupKey: `w1-c6:skills-shape:${crypto.randomUUID()}`,
    });
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const service = await import('../services/org_proposal_apply_service');

    await expect(service.validateProposalChange(proposal)).resolves.toMatchObject({ valid: false });
    await expect(service.applyProposal(proposal)).rejects.toThrow(/allowedSkillsJson|array|shape/i);
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(prior);
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
    expect(projection).not.toHaveBeenCalled();
  });

  it('rejects byte-changing core permission patches that are no-ops under the runtime projector', async () => {
    const scope = await import('../services/scope_mutation_contract');
    const changeJson = JSON.stringify({
      scopePatch: {
        agentConfigId: 'cfg',
        field: 'corePermissionsJson',
        set: { bash: { sh: 'ask' } },
      },
    });

    expect(() => scope.prepareScopeMutation(
      'refine-scope',
      changeJson,
      '{"bash":{"*":"allow"}}',
    )).toThrow(/effective|semantic|no.op/i);
  });

  it.each([
    {
      label: 'a redundant same-action specific rule',
      prior: '{"bash":{"*":"ask"}}',
      set: { bash: { 'git *': 'ask' } },
    },
    {
      label: 'an earlier rule already shadowed by a later wildcard',
      prior: '{"bash":{"git *":"deny","*":"allow"}}',
      set: { bash: { 'git *': 'allow' } },
    },
  ])('rejects $label under last-match runtime semantics', async ({ prior, set }) => {
    const scope = await import('../services/scope_mutation_contract');
    const changeJson = JSON.stringify({
      scopePatch: {
        agentConfigId: 'cfg',
        field: 'corePermissionsJson',
        set,
      },
    });

    expect(() => scope.prepareScopeMutation('refine-scope', changeJson, prior))
      .toThrow(/effective|semantic|no.op/i);
  });

  it('accepts a specific permission rule that changes the runtime action', async () => {
    const scope = await import('../services/scope_mutation_contract');
    const changeJson = JSON.stringify({
      scopePatch: {
        agentConfigId: 'cfg',
        field: 'corePermissionsJson',
        set: { bash: { 'git *': 'allow' } },
      },
    });

    expect(scope.prepareScopeMutation(
      'refine-scope',
      changeJson,
      '{"bash":{"*":"ask"}}',
    ).expectedAppliedValue).toBe('{"bash":{"*":"ask","git *":"allow"}}');
  });
});

async function makeMeasuringScopeRow(
  transform?: (fixture: {
    configId: string;
    exactChangeJson: string;
    snapshotJson: string;
  }) => { changeJson?: string; beforeSnapshotJson?: string | null },
) {
  const scope = await import('../services/scope_mutation_contract');
  const configs = new AgentConfigsRepository();
  const proposals = new AgentOrgProposalsRepository();
  const prior = '["remove-me","keep-me"]';
  const applied = '["keep-me"]';
  const config = configs.insert({
    label: 'Corrective 6 measurement target',
    icon: 'shield',
    allowedSkillsJson: applied,
  });
  const exactChangeJson = JSON.stringify({
    agentConfigId: config.id,
    field: 'allowedSkillsJson',
    remove: ['remove-me'],
  });
  const snapshotJson = JSON.stringify(scope.createScopeDeltaV2Snapshot(
    config.id,
    'allowedSkillsJson',
    prior,
    ['remove-me'],
    'prune-scope',
    exactChangeJson,
  ));
  const changed = transform?.({ configId: config.id, exactChangeJson, snapshotJson }) ?? {};
  const created = await proposals.createAsync({
    kind: 'prune-scope',
    risk: 'high',
    title: 'Corrective 6 measurement boundary',
    changeJson: changed.changeJson ?? exactChangeJson,
    beforeSnapshotJson:
      changed.beforeSnapshotJson === undefined ? snapshotJson : changed.beforeSnapshotJson,
    dedupKey: `w1-c6:measurement:${crypto.randomUUID()}`,
  });
  await proposals.updateStatusAsync(created.id, 'applied');
  const measuring = (await proposals.updateStatusAsync(created.id, 'measuring'))!;
  return { configs, proposals, config, prior, applied, exactChangeJson, snapshotJson, measuring };
}

async function makeMeasuringRefineScopeRow(
  transform?: (fixture: {
    configId: string;
    exactChangeJson: string;
    snapshotJson: string;
  }) => { changeJson?: string; beforeSnapshotJson?: string | null },
) {
  const scope = await import('../services/scope_mutation_contract');
  const configs = new AgentConfigsRepository();
  const proposals = new AgentOrgProposalsRepository();
  const prior = '["base"]';
  const applied = '["base","grant"]';
  const config = configs.insert({
    label: 'Corrective 6 refine measurement target',
    icon: 'shield',
    allowedSkillsJson: applied,
  });
  const exactChangeJson = JSON.stringify({
    scopePatch: {
      agentConfigId: config.id,
      field: 'allowedSkillsJson',
      add: ['grant'],
    },
    sessionIds: ['session-1'],
    evidence: [{ category: 'tool-unavailable-attempted' }],
  });
  const snapshotJson = JSON.stringify(scope.createScopeStateV2Snapshot(
    config.id,
    'allowedSkillsJson',
    prior,
    applied,
    exactChangeJson,
    'refine-scope',
  ));
  const changed = transform?.({ configId: config.id, exactChangeJson, snapshotJson }) ?? {};
  const created = await proposals.createAsync({
    kind: 'refine-scope',
    risk: 'high',
    title: 'Corrective 6 refine measurement boundary',
    changeJson: changed.changeJson ?? exactChangeJson,
    beforeSnapshotJson:
      changed.beforeSnapshotJson === undefined ? snapshotJson : changed.beforeSnapshotJson,
    dedupKey: `w1-c6:refine-measurement:${crypto.randomUUID()}`,
  });
  await proposals.updateStatusAsync(created.id, 'applied');
  const measuring = (await proposals.updateStatusAsync(created.id, 'measuring'))!;
  return { configs, proposals, config, prior, applied, exactChangeJson, snapshotJson, measuring };
}

describe('W1 corrective 6 A6: strict measurement boundary', () => {
  it.each([
    {
      label: 'missing snapshot',
      transform: () => ({ beforeSnapshotJson: null }),
    },
    {
      label: 'duplicate snapshot',
      transform: ({ snapshotJson }: { snapshotJson: string }) => ({
        beforeSnapshotJson: snapshotJson.replace(
          '"version":"scope-state-v2"',
          '"version":"shadow","version":"scope-state-v2"',
        ),
      }),
    },
  ])('leaves refine-scope with invalid $label in measuring before rerun', async ({ transform }) => {
    const fixture = await makeMeasuringRefineScopeRow(
      transform as Parameters<typeof makeMeasuringRefineScopeRow>[0],
    );
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const measure = await import('../services/org_proposal_measure');
    let rerunCalls = 0;

    await expect(measure.measureProposal(fixture.measuring, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
      rerunScenario: async () => {
        rerunCalls += 1;
        return { status: 'completed', reason: 'must not run' };
      },
    })).resolves.toBe('skipped');
    expect(rerunCalls).toBe(0);
    expect(fixture.configs.getById(fixture.config.id)?.allowedSkillsJson).toBe(fixture.applied);
    expect(await fixture.proposals.findByIdAsync(fixture.measuring.id)).toMatchObject({
      status: 'measuring',
      beforeSnapshotJson: fixture.measuring.beforeSnapshotJson,
    });
    expect(projection).not.toHaveBeenCalled();
  });

  it('keeps a valid bound refine-scope only after behavioral rerun', async () => {
    const fixture = await makeMeasuringRefineScopeRow();
    const measure = await import('../services/org_proposal_measure');
    let rerunCalls = 0;

    await expect(measure.measureProposal(fixture.measuring, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
      rerunScenario: async (_proposal, context) => {
        rerunCalls += 1;
        expect(context.patchedProfileId).toBe(fixture.config.id);
        return { status: 'completed', reason: 'bound rerun passed' };
      },
    })).resolves.toBe('kept');
    expect(rerunCalls).toBe(1);
    expect(fixture.configs.getById(fixture.config.id)?.allowedSkillsJson).toBe(fixture.applied);
    expect((await fixture.proposals.findByIdAsync(fixture.measuring.id))?.status).toBe('active');
  });

  it('does not activate refine-scope when the target drifts during behavioral rerun', async () => {
    const fixture = await makeMeasuringRefineScopeRow();
    const operatorValue = '["operator-during-rerun"]';
    const measure = await import('../services/org_proposal_measure');

    await expect(measure.measureProposal(fixture.measuring, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
      rerunScenario: async () => {
        fixture.configs.update(fixture.config.id, { allowedSkillsJson: operatorValue });
        return { status: 'completed', reason: 'stale result must not activate' };
      },
    })).resolves.toBe('skipped');
    expect(fixture.configs.getById(fixture.config.id)?.allowedSkillsJson).toBe(operatorValue);
    expect((await fixture.proposals.findByIdAsync(fixture.measuring.id))?.status).toBe('measuring');
  });

  it.each([
    {
      label: 'duplicate change_json',
      transform: ({ exactChangeJson }: { exactChangeJson: string }) => ({
        changeJson: exactChangeJson.replace(
          '"remove":["remove-me"]',
          '"remove":["shadow"],"remove":["remove-me"]',
        ),
      }),
    },
    {
      label: 'missing snapshot',
      transform: () => ({ beforeSnapshotJson: null }),
    },
    {
      label: 'legacy snapshot',
      transform: ({ configId }: { configId: string }) => ({
        beforeSnapshotJson: JSON.stringify({
          agentConfigId: configId,
          field: 'allowedSkillsJson',
          priorValue: '["remove-me","keep-me"]',
        }),
      }),
    },
    {
      label: 'duplicate snapshot',
      transform: ({ snapshotJson }: { snapshotJson: string }) => ({
        beforeSnapshotJson: snapshotJson.replace(
          '"version":"scope-delta-v2"',
          '"version":"shadow","version":"scope-delta-v2"',
        ),
      }),
    },
    {
      label: 'unbound exact change bytes',
      transform: ({ exactChangeJson }: { exactChangeJson: string }) => ({
        changeJson: ` ${exactChangeJson} `,
      }),
    },
  ])('leaves invalid $label in measuring with zero effects', async ({ transform }) => {
    const fixture = await makeMeasuringScopeRow(transform as Parameters<typeof makeMeasuringScopeRow>[0]);
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const measure = await import('../services/org_proposal_measure');

    await expect(measure.measureProposal(fixture.measuring, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
      exercisedTools: async () => new Set<string>(),
    })).resolves.toBe('skipped');
    expect(fixture.configs.getById(fixture.config.id)?.allowedSkillsJson).toBe(fixture.applied);
    expect(await fixture.proposals.findByIdAsync(fixture.measuring.id)).toMatchObject({
      status: 'measuring',
      beforeSnapshotJson: fixture.measuring.beforeSnapshotJson,
      changeJson: fixture.measuring.changeJson,
    });
    expect(projection).not.toHaveBeenCalled();
  });

  it('leaves a bound removal in measuring when the live target has drifted', async () => {
    const fixture = await makeMeasuringScopeRow();
    const operatorValue = '["operator-concurrent-value"]';
    fixture.configs.update(fixture.config.id, { allowedSkillsJson: operatorValue });
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');
    const measure = await import('../services/org_proposal_measure');
    let exercisedCalls = 0;

    await expect(measure.measureProposal(fixture.measuring, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
      exercisedTools: async () => {
        exercisedCalls += 1;
        return new Set<string>();
      },
    })).resolves.toBe('skipped');
    expect(exercisedCalls).toBe(0);
    expect(fixture.configs.getById(fixture.config.id)?.allowedSkillsJson).toBe(operatorValue);
    expect((await fixture.proposals.findByIdAsync(fixture.measuring.id))?.status).toBe('measuring');
    expect(projection).not.toHaveBeenCalled();
  });

  it('does not activate a removal when the target drifts during telemetry lookup', async () => {
    const fixture = await makeMeasuringScopeRow();
    const operatorValue = '["operator-during-telemetry"]';
    const measure = await import('../services/org_proposal_measure');

    await expect(measure.measureProposal(fixture.measuring, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
      exercisedTools: async () => {
        fixture.configs.update(fixture.config.id, { allowedSkillsJson: operatorValue });
        return new Set<string>();
      },
    })).resolves.toBe('skipped');
    expect(fixture.configs.getById(fixture.config.id)?.allowedSkillsJson).toBe(operatorValue);
    expect((await fixture.proposals.findByIdAsync(fixture.measuring.id))?.status).toBe('measuring');
  });

  it('keeps a strictly valid bound v2 scope measurement', async () => {
    const fixture = await makeMeasuringScopeRow();
    const measure = await import('../services/org_proposal_measure');

    await expect(measure.measureProposal(fixture.measuring, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
      exercisedTools: async () => new Set<string>(),
    })).resolves.toBe('kept');
    expect(fixture.configs.getById(fixture.config.id)?.allowedSkillsJson).toBe(fixture.applied);
    expect((await fixture.proposals.findByIdAsync(fixture.measuring.id))?.status).toBe('active');
  });

  it('reverts a strictly valid bound v2 scope measurement when the removed entry was exercised', async () => {
    const fixture = await makeMeasuringScopeRow();
    const writer = await import('../services/opencode_agent_writer');
    vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('written');
    const measure = await import('../services/org_proposal_measure');

    await expect(measure.measureProposal(fixture.measuring, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
      exercisedTools: async () => new Set(['remove-me']),
    })).resolves.toBe('reverted');
    expect(fixture.configs.getById(fixture.config.id)?.allowedSkillsJson).toBe(fixture.prior);
    expect((await fixture.proposals.findByIdAsync(fixture.measuring.id))?.status).toBe('reverted');
  });
});
