import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';

function makeDb(): Database.Database {
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
  const created = await proposals.createAsync({
    kind: input.kind,
    risk: 'high',
    title: `W1 corrective 5 ${input.kind}`,
    changeJson: input.changeJson,
    beforeSnapshotJson: input.beforeSnapshotJson,
    dedupKey: `w1-c5:${input.kind}:${crypto.randomUUID()}`,
  });
  // Fixture only: place the row in the durable post-apply state directly. The
  // generic status API refuses ANY scope arrival at `applied` (package C), so
  // this raw write stands in for a pair the atomic primitive already
  // committed; these tests exercise the revert/measure side of the lifecycle.
  getDb().prepare(`UPDATE agent_org_proposals SET status = 'applied' WHERE id = ?`).run(created.id);
  await proposals.updateStatusAsync(created.id, 'measuring');
  return (await proposals.updateStatusAsync(created.id, 'active'))!;
}

beforeEach(async () => {
  setDb(makeDb());
  vi.restoreAllMocks();
  const service = await import('../services/org_proposal_apply_service');
  service.resetProposalPluginsForTests();
  const wiring = await import('../services/org_proposal_appliers_wiring');
  wiring.registerAllProposalAppliers();
});

describe('issue-W1-corrective-5-c1: one strict raw JSON boundary', () => {
  it('accepts ordinary standard JSON and reserved member names without unsafe assignment', async () => {
    // Regression caught: a hand-written parser rejects legal JSON or mutates
    // Object.prototype while decoding security-sensitive bytes.
    const strict = await import('../services/strict_json');
    const parsed = strict.parseStrictJson(
      '{"ordinary":[true,false,null,-1.25e+2,"text"],"__proto__":{"safe":1},"constructor":2}',
      'probe',
    ) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['ordinary', '__proto__', 'constructor']);
    expect(Object.prototype).not.toHaveProperty('safe');
  });

  it.each([
    ['same-level', '{"a":1,"a":2}'],
    ['escape-equivalent', '{"a":1,"\\u0061":2}'],
    ['nested-object', '{"outer":{"x":1,"x":2}}'],
    ['object-in-array', '[{"x":1,"\\u0078":2}]'],
  ])('rejects duplicate decoded member names: %s', async (_label, raw) => {
    // Regression caught: JSON.parse silently selected the final privileged
    // member and discarded the earlier exact bytes.
    const strict = await import('../services/strict_json');
    expect(() => strict.parseStrictJson(raw, 'probe')).toThrow(/duplicate/i);
  });

  it.each(['{', '[1,]', '{"a":01}', '{"a":"\\x20"}', 'true false']) (
    'rejects malformed or non-standard JSON: %s',
    async (raw) => {
      const strict = await import('../services/strict_json');
      expect(() => strict.parseStrictJson(raw, 'probe')).toThrow(/JSON/i);
    },
  );

  it('rejects duplicate keys in change_json and prior scope bytes before semantic preparation', async () => {
    const scope = await import('../services/scope_mutation_contract');
    expect(() => scope.prepareScopeMutation(
      'broaden-scope',
      '{"agentConfigId":"cfg","field":"allowedSkillsJson","add":["shadow"],"add":["visible"]}',
      '["base"]',
    )).toThrow(/duplicate/i);
    expect(() => scope.prepareScopeMutation(
      'prune-scope',
      '{"agentConfigId":"cfg","field":"allowedSkillsJson","remove":["dup"]}',
      '{"dup":["read"],"\\u0064up":["write"]}',
    )).toThrow(/duplicate/i);
  });

  it('rejects duplicate prior bytes through the legacy scope-list helper boundary', async () => {
    const { computeScopeList } = await import('../services/org_proposal_apply');
    expect(() => computeScopeList('{"server":["read"],"\\u0073erver":["write"]}', {
      add: ['other'],
    })).toThrow(/duplicate/i);
  });

  it('classifies duplicate change_json as high and human preparation refuses it before claim or target mutation', async () => {
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    const service = await import('../services/org_proposal_apply_service');
    const configs = new AgentConfigsRepository();
    const config = configs.insert({
      label: 'C5 duplicate human boundary',
      icon: 'shield',
      allowedSkillsJson: '["base"]',
    });
    const changeJson =
      `{"agentConfigId":"${config.id}","field":"allowedSkillsJson",` +
      '"add":["shadow"],"add":["visible"]}';
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: 'C5 duplicate human boundary',
      changeJson,
      dedupKey: `w1-c5:duplicate-human:${crypto.randomUUID()}`,
    });
    const claim = vi.spyOn(proposals, 'claimAppliedWithSnapshotAsync');

    expect(classifyProposalRisk({ kind: 'refine-recipe', changeJson })).toBe('high');
    await expect(service.applyProposal(proposal)).rejects.toThrow(/duplicate/i);
    expect(claim).not.toHaveBeenCalled();
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe('["base"]');
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
  });

  it('rejects duplicate raw before_snapshot_json before target, projection, or status changes', async () => {
    const apply = await import('../services/org_proposal_apply');
    const writer = await import('../services/opencode_agent_writer');
    const configs = new AgentConfigsRepository();
    const prior = '["base"]';
    const applied = '["base","grant"]';
    const config = configs.insert({
      label: 'C5 duplicate snapshot boundary',
      icon: 'shield',
      allowedSkillsJson: applied,
    });
    const changeJson = JSON.stringify({
      agentConfigId: config.id,
      field: 'allowedSkillsJson',
      add: ['grant'],
    });
    const snapshot = apply.createScopeStateV2Snapshot(
      config.id,
      'allowedSkillsJson',
      prior,
      applied,
      changeJson,
      'broaden-scope',
    );
    const duplicateSnapshot = JSON.stringify(snapshot).replace(
      '"version":"scope-state-v2"',
      '"version":"shadow","version":"scope-state-v2"',
    );
    const active = await activateProposal({
      kind: 'broaden-scope',
      changeJson,
      beforeSnapshotJson: duplicateSnapshot,
    });
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');

    expect(await apply.revertProposal(active)).not.toBe('reverted');
    expect(configs.getById(config.id)?.allowedSkillsJson).toBe(applied);
    expect(await new AgentOrgProposalsRepository().findByIdAsync(active.id)).toMatchObject({
      status: 'active',
      changeJson,
      beforeSnapshotJson: duplicateSnapshot,
    });
    expect(projection).not.toHaveBeenCalled();
  });
});

describe('issue-W1-corrective-5-c2: exact scope semantics', () => {
  it.each(['allowedMcpsJson', 'allowedSkillsJson'] as const)(
    'treats null %s as unrestricted and rejects add/remove rather than narrowing it',
    async (field) => {
      // Regression caught: null was normalized to [] and an add narrowed an
      // unrestricted profile to a single grant.
      const { prepareScopeMutation } = await import('../services/scope_mutation_contract');
      expect(() => prepareScopeMutation(
        'broaden-scope',
        JSON.stringify({ agentConfigId: 'cfg', field, add: ['only'] }),
        null,
      )).toThrow(/unrestricted/i);
      expect(() => prepareScopeMutation(
        'prune-scope',
        JSON.stringify({ agentConfigId: 'cfg', field, remove: ['only'] }),
        null,
      )).toThrow(/unrestricted/i);
    },
  );

  it.each(['refine-recipe', '', null, 42])(
    'rejects unsupported runtime proposal kind %s',
    async (kind) => {
      const scope = await import('../services/scope_mutation_contract');
      expect(() => (scope.parseScopeMutation as any)(
        kind,
        '{"scopePatch":{"agentConfigId":"cfg","field":"allowedSkillsJson","add":["b"]}}',
      )).toThrow(/kind/i);
    },
  );

  it('enforces state and delta constructor kind families at runtime', async () => {
    // Regression caught: TypeScript-only parameter types allowed invalid
    // rollback records to be signed and persisted by untyped callers.
    const scope = await import('../services/scope_mutation_contract');
    expect(() => (scope.createScopeStateV2Snapshot as any)(
      'cfg',
      'allowedSkillsJson',
      '["a"]',
      '["a","b"]',
      '{"scopePatch":{"agentConfigId":"cfg","field":"allowedSkillsJson","add":["b"]}}',
      'refine-recipe',
    )).toThrow(/kind/i);
    expect(() => (scope.createScopeDeltaV2Snapshot as any)(
      'cfg',
      'allowedSkillsJson',
      '["a","b"]',
      ['a'],
      'refine-scope',
      '{"scopePatch":{"agentConfigId":"cfg","field":"allowedSkillsJson","remove":["a"]}}',
    )).toThrow(/kind/i);
  });

  it.each([
    {
      label: 'nested sibling operation',
      change: {
        source: 'diagnosis',
        scopePatch: { agentConfigId: 'cfg', field: 'allowedSkillsJson', add: ['b'] },
        shadow: { agentConfigId: 'cfg', field: 'allowedSkillsJson', remove: ['a'] },
      },
    },
    {
      label: 'root scope alias',
      change: {
        scopePatch: { agentConfigId: 'cfg', field: 'allowedSkillsJson', add: ['b'] },
        removeSkills: ['a'],
      },
    },
    {
      label: 'nested canonical field alias',
      change: {
        scopePatch: { agentConfigId: 'cfg', field: 'allowedSkillsJson', add: ['b'] },
        metadata: { allowedMcpsJson: ['shadow'] },
      },
    },
  ])('rejects refine-scope $label outside the selected canonical scopePatch', async ({ change }) => {
    // Regression caught: validation selected scopePatch but ignored a second
    // scope-bearing instruction elsewhere in the same signed payload.
    const { prepareScopeMutation } = await import('../services/scope_mutation_contract');
    expect(() => prepareScopeMutation('refine-scope', JSON.stringify(change), '["a"]'))
      .toThrow(/scope|smuggl|outside/i);
  });

  it('preserves valid non-null array, tools-map, and core-permission mutations', async () => {
    const { prepareScopeMutation } = await import('../services/scope_mutation_contract');
    expect(prepareScopeMutation(
      'refine-scope',
      '{"scopePatch":{"agentConfigId":"cfg","field":"allowedSkillsJson","add":["c"],"remove":["a"]}}',
      '["a","b"]',
    ).expectedAppliedValue).toBe('["b","c"]');
    expect(prepareScopeMutation(
      'refine-scope',
      '{"scopePatch":{"agentConfigId":"cfg","field":"allowedMcpsJson","add":["next"],"remove":["old"]}}',
      '{"old":["read"],"kept":null}',
    ).expectedAppliedValue).toBe('{"kept":null,"next":[]}');
    expect(prepareScopeMutation(
      'refine-scope',
      '{"scopePatch":{"agentConfigId":"cfg","field":"corePermissionsJson","set":{"read":"allow"},"unset":["edit"]}}',
      '{"read":"ask","edit":"allow"}',
    ).expectedAppliedValue).toBe('{"read":"allow"}');
  });
});

describe('issue-W1-corrective-5-c3: shared recursive scope-bearing detector', () => {
  it.each([
    { label: 'scopePatch null', value: { wrapper: { scopePatch: null } } },
    { label: 'scopePatch empty', value: { scopePatch: {} } },
    { label: 'canonical field key', value: { wrapper: { allowedSkillsJson: [] } } },
    { label: 'split field operation', value: { field: 'allowedMcpsJson', operation: { value: [] } } },
    { label: 'scope alias', value: { wrapper: { removeAllowedSkills: ['x'] } } },
    { label: 'agent config operation', value: { agentConfigId: 'cfg', operation: { add: ['x'] } } },
    { label: 'nested agent config patch', value: { agentConfigId: 'cfg', patch: { add: ['x'] } } },
    {
      label: 'nested typed target changes',
      value: { target: { type: 'agent_config', id: 'cfg' }, changes: { remove: ['x'] } },
    },
  ])('detects $label regardless of nesting or malformed shape', async ({ value }) => {
    const { containsScopeBearingPayload } = await import('../services/scope_mutation_contract');
    expect(containsScopeBearingPayload(value)).toBe(true);
  });

  it.each([
    { revisedBody: 'Set the table, unset a reminder, add context, and remove repetition.' },
    { recipePatch: { add: 'salt' } },
    { recipePatch: { set: 'the table', unset: 'the alarm', remove: 'noise' } },
  ])('keeps unrelated prose and recipe operations non-scope-bearing', async (value) => {
    const { containsScopeBearingPayload } = await import('../services/scope_mutation_contract');
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(containsScopeBearingPayload(value)).toBe(false);
    expect(classifyProposalRisk({ kind: 'refine-recipe', changeJson: JSON.stringify(value) })).toBe('low');
  });

  it.each([
    { wrapper: { scopePatch: null } },
    { scopePatch: {} },
    { wrapper: { allowedSkillsJson: [] } },
    { field: 'corePermissionsJson', operation: { set: { read: 'allow' } } },
    { agentConfigId: 'cfg', operation: { add: ['x'] } },
  ])('classifies every scope-bearing shape high under a low-risk kind', async (change) => {
    const { classifyProposalRisk } = await import('../services/org_risk_classifier');
    expect(classifyProposalRisk({ kind: 'refine-recipe', changeJson: JSON.stringify(change) }))
      .toBe('high');
  });

  it('independently refuses unattended scope-bearing payloads without lifecycle effects', async () => {
    // Regression caught: a stale stored low risk plus nested empty scopePatch
    // advanced proposed -> measuring with a null actor.
    const { applyProposal } = await import('../services/org_proposal_apply');
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'refine-recipe',
      risk: 'low',
      title: 'C5 unattended nested scope',
      changeJson: '{"wrapper":{"scopePatch":{}}}',
      dedupKey: `w1-c5:unattended:${crypto.randomUUID()}`,
    });

    expect(await applyProposal(proposal, { proposalsRepo: proposals }))
      .toMatchObject({ status: 'refused-high-risk' });
    expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
      status: 'proposed',
      beforeSnapshotJson: null,
      decidedByUserId: null,
    });
  });

  it.each(['null', '42', '{}', '{"agentConfigId":"cfg","field":"allowedSkillsJson","priorValue":"[]"}'])(
    'refuses mislabeled scope-bearing revert with invalid snapshot %s before every side effect',
    async (beforeSnapshotJson) => {
      // Regression caught: kind-only scope detection let refine-recipe rows
      // with invalid snapshots transition to reverted.
      const apply = await import('../services/org_proposal_apply');
      const writer = await import('../services/opencode_agent_writer');
      const changeJson = '{"wrapper":{"scopePatch":{}}}';
      const active = await activateProposal({
        kind: 'refine-recipe',
        changeJson,
        beforeSnapshotJson,
      });
      const projection = vi.spyOn(writer, 'writeAgentProfileFile');

      expect(await apply.revertProposal(active)).not.toBe('reverted');
      expect(await new AgentOrgProposalsRepository().findByIdAsync(active.id)).toMatchObject({
        status: 'active',
        changeJson,
        beforeSnapshotJson,
      });
      expect(projection).not.toHaveBeenCalled();
    },
  );
});

type ScopeFixture = Awaited<ReturnType<typeof makeScopeFixture>>;

async function makeScopeFixture(
  version: 'scope-state-v2' | 'scope-delta-v2',
  sourceStatus: 'active' | 'measuring' = 'active',
) {
  const apply = await import('../services/org_proposal_apply');
  const configs = new AgentConfigsRepository();
  const proposals = new AgentOrgProposalsRepository();
  const prior = version === 'scope-state-v2' ? '["base"]' : '["remove","keep"]';
  const applied = version === 'scope-state-v2' ? '["base","grant"]' : '["keep"]';
  const config = configs.insert({
    label: `C5 atomic ${version} ${crypto.randomUUID()}`,
    icon: 'shield',
    allowedSkillsJson: applied,
  });
  const changeJson = JSON.stringify({
    agentConfigId: config.id,
    field: 'allowedSkillsJson',
    ...(version === 'scope-state-v2' ? { add: ['grant'] } : { remove: ['remove'] }),
  });
  const snapshot = version === 'scope-state-v2'
    ? apply.createScopeStateV2Snapshot(
        config.id,
        'allowedSkillsJson',
        prior,
        applied,
        changeJson,
        'broaden-scope',
      )
    : apply.createScopeDeltaV2Snapshot(
        config.id,
        'allowedSkillsJson',
        prior,
        ['remove'],
        'prune-scope',
        changeJson,
      );
  const created = await proposals.createAsync({
    kind: version === 'scope-state-v2' ? 'broaden-scope' : 'prune-scope',
    risk: 'high',
    title: `C5 atomic ${version}`,
    changeJson,
    beforeSnapshotJson: JSON.stringify(snapshot),
    baselineScore: 1,
    postScore: 2,
    measureReason: 'original',
    dedupKey: `w1-c5:atomic:${crypto.randomUUID()}`,
  });
  // Fixture only: place the row in the durable post-apply state directly. The
  // generic status API refuses ANY scope arrival at `applied` (package C), so
  // this raw write stands in for a pair the atomic primitive already
  // committed; these tests exercise the revert/measure side of the lifecycle.
  getDb().prepare(`UPDATE agent_org_proposals SET status = 'applied' WHERE id = ?`).run(created.id);
  const measuring = await proposals.updateStatusAsync(created.id, 'measuring');
  const proposal = sourceStatus === 'active'
    ? await proposals.updateStatusAsync(created.id, 'active')
    : measuring;
  return { apply, configs, proposals, config, prior, applied, changeJson, snapshot, proposal: proposal! };
}

async function durablePair(fixture: ScopeFixture) {
  return {
    target: new AgentConfigsRepository().getById(fixture.config.id)?.allowedSkillsJson,
    proposal: await new AgentOrgProposalsRepository().findByIdAsync(fixture.proposal.id),
  };
}

describe('issue-W1-corrective-5-c5: atomic scope target and proposal lifecycle', () => {
  it('rolls back the target when a DB trigger aborts the proposal transition before commit', async () => {
    const fixture = await makeScopeFixture('scope-state-v2');
    getDb().prepare(`CREATE TRIGGER c5_fail_reverted BEFORE UPDATE ON agent_org_proposals
      WHEN NEW.status = 'reverted' BEGIN SELECT RAISE(ABORT, 'c5 forced status failure'); END;`).run();
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');

    expect(await fixture.apply.revertProposal(
      fixture.proposal,
      { proposalsRepo: fixture.proposals, configsRepo: fixture.configs },
      { baselineScore: 10, postScore: 20, measureReason: 'should rollback' },
    )).not.toBe('reverted');
    const pair = await durablePair(fixture);
    expect(pair.target).toBe(fixture.applied);
    // Package C: the unresolved revert is recorded durably. The audit fields
    // and the exact bindings must survive that marking untouched.
    expect(pair.proposal).toMatchObject({
      status: 'reconciliation-required', baselineScore: 1, postScore: 2, measureReason: 'original',
      changeJson: fixture.changeJson, beforeSnapshotJson: JSON.stringify(fixture.snapshot),
    });
    expect(pair.proposal?.reconciliationReason).toBeTruthy();
    expect(projection).not.toHaveBeenCalled();
  });

  it.each([
    { miss: 'target' as const, version: 'scope-state-v2' as const },
    { miss: 'status' as const, version: 'scope-delta-v2' as const },
  ])('leaves both sides unchanged on $miss CAS miss', async ({ miss, version }) => {
    const fixture = await makeScopeFixture(version, miss === 'status' ? 'measuring' : 'active');
    if (miss === 'target') {
      fixture.configs.update(fixture.config.id, { allowedSkillsJson: '["concurrent"]' });
    } else {
      await fixture.proposals.updateStatusAsync(fixture.proposal.id, 'active');
    }
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');

    expect(await fixture.apply.revertProposal(fixture.proposal, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
    })).toBe('conflict');
    const pair = await durablePair(fixture);
    expect(pair.target).toBe(miss === 'target' ? '["concurrent"]' : fixture.applied);
    expect(pair.proposal?.status).toBe('active');
    expect(projection).not.toHaveBeenCalled();
  });

  it.each([
    { version: 'scope-state-v2' as const, projectionResult: 'written' as const },
    { version: 'scope-delta-v2' as const, projectionResult: 'skipped' as const },
  ])('commits $version pair and patch fields when projection is $projectionResult', async ({ version, projectionResult }) => {
    const fixture = await makeScopeFixture(version);
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue(projectionResult);

    expect(await fixture.apply.revertProposal(
      fixture.proposal,
      { proposalsRepo: fixture.proposals, configsRepo: fixture.configs },
      { baselineScore: 10, postScore: 20, measureReason: 'atomic revert' },
    )).toBe('reverted');
    const pair = await durablePair(fixture);
    expect(pair.target).toBe(fixture.prior);
    expect(pair.proposal).toMatchObject({
      status: 'reverted', baselineScore: 10, postScore: 20, measureReason: 'atomic revert',
      changeJson: fixture.changeJson, beforeSnapshotJson: JSON.stringify(fixture.snapshot),
    });
    expect(projection).toHaveBeenCalledTimes(1);
  });

  it.each(['blocked', 'failed'] as const)(
    'atomically inverses both rows and reprojects applied state when projection is %s',
    async (projectionResult) => {
      const fixture = await makeScopeFixture('scope-state-v2');
      const writer = await import('../services/opencode_agent_writer');
      const projection = vi.spyOn(writer, 'writeAgentProfileFile')
        .mockReturnValueOnce(projectionResult)
        .mockReturnValueOnce('written');

      expect(await fixture.apply.revertProposal(
        fixture.proposal,
        { proposalsRepo: fixture.proposals, configsRepo: fixture.configs },
        { baselineScore: 10, postScore: 20, measureReason: 'inverse me' },
      )).toBe('conflict');
      const pair = await durablePair(fixture);
      expect(pair.target).toBe(fixture.applied);
      expect(pair.proposal).toMatchObject({
        status: 'active', baselineScore: 1, postScore: 2, measureReason: 'original',
      });
      expect(projection).toHaveBeenCalledTimes(2);
    },
  );

  it('does not depend on proposal readback after the atomic commit', async () => {
    const fixture = await makeScopeFixture('scope-state-v2');
    const writer = await import('../services/opencode_agent_writer');
    vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('written');
    vi.spyOn(fixture.proposals, 'findByIdAsync').mockRejectedValue(new Error('persistent read outage'));

    expect(await fixture.apply.revertProposal(fixture.proposal, {
      proposalsRepo: fixture.proposals,
      configsRepo: fixture.configs,
    })).toBe('reverted');
    const pair = await durablePair(fixture);
    expect(pair.target).toBe(fixture.prior);
    expect(pair.proposal?.status).toBe('reverted');
  });

  it('reports reconciliation without target-only compensation when a wrapper throws after durable commit', async () => {
    const fixture = await makeScopeFixture('scope-state-v2');
    const repo = fixture.proposals as any;
    const original = repo.transitionScopeAtomicallyAsync?.bind(repo);
    repo.transitionScopeAtomicallyAsync = async (...args: unknown[]) => {
      const result = await original(...args);
      throw new Error('wrapper failed after durable commit');
    };
    const writer = await import('../services/opencode_agent_writer');
    const projection = vi.spyOn(writer, 'writeAgentProfileFile');

    expect(await fixture.apply.revertProposal(fixture.proposal, {
      proposalsRepo: repo,
      configsRepo: fixture.configs,
    })).toBe('reconciliation-required');
    const pair = await durablePair(fixture);
    expect(pair.target).toBe(fixture.prior);
    expect(pair.proposal?.status).toBe('reconciliation-required');
    expect(pair.proposal?.reconciliationReason).toBeTruthy();
    expect(projection).not.toHaveBeenCalled();
  });

  it.each(['target-cas', 'status-cas', 'throw-before', 'throw-after'] as const)(
    'preserves a consistent pair and reports reconciliation when inverse hits %s',
    async (mode) => {
      const fixture = await makeScopeFixture('scope-state-v2');
      const repo = fixture.proposals as any;
      const original = repo.transitionScopeAtomicallyAsync?.bind(repo);
      let calls = 0;
      repo.transitionScopeAtomicallyAsync = async (...args: unknown[]) => {
        calls += 1;
        if (calls === 1) return original(...args);
        if (mode === 'target-cas') {
          fixture.configs.update(fixture.config.id, { allowedSkillsJson: '["concurrent"]' });
          return original(...args);
        }
        if (mode === 'status-cas') {
          getDb().prepare(
            `UPDATE agent_org_proposals SET status = 'active' WHERE id = ? AND status = 'reverted'`,
          ).run(fixture.proposal.id);
          return original(...args);
        }
        if (mode === 'throw-before') throw new Error('inverse failed before commit');
        const result = await original(...args);
        throw new Error(`inverse failed after commit: ${Boolean(result)}`);
      };
      const writer = await import('../services/opencode_agent_writer');
      vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('blocked');

      expect(await fixture.apply.revertProposal(fixture.proposal, {
        proposalsRepo: repo,
        configsRepo: fixture.configs,
      })).toBe('reconciliation-required');
      const pair = await durablePair(fixture);
      // Byte safety is unchanged — only the durable STATUS moved, because an
      // unresolved revert must be visible instead of looking healthy.
      const expectedTarget = mode === 'throw-after'
        ? fixture.applied
        : mode === 'target-cas'
          ? '["concurrent"]'
          : fixture.prior;
      expect(pair).toMatchObject({
        target: expectedTarget,
        proposal: { status: 'reconciliation-required' },
      });
      expect(pair.proposal?.reconciliationReason).toBeTruthy();
    },
  );

  it.each(['blocked', 'failed'] as const)(
    'reports reconciliation when the compensating projection is %s',
    async (inverseProjectionResult) => {
      // Regression caught: after atomically restoring the applied DB pair, a
      // failed second projection still leaves the file explicitly reported as
      // stale and must not be downgraded to an ordinary compensated conflict.
      const fixture = await makeScopeFixture('scope-state-v2');
      const writer = await import('../services/opencode_agent_writer');
      const projection = vi.spyOn(writer, 'writeAgentProfileFile')
        .mockReturnValueOnce('blocked')
        .mockReturnValueOnce(inverseProjectionResult);

      expect(await fixture.apply.revertProposal(fixture.proposal, {
        proposalsRepo: fixture.proposals,
        configsRepo: fixture.configs,
      })).toBe('reconciliation-required');
      const pair = await durablePair(fixture);
      expect(pair).toMatchObject({
        target: fixture.applied,
        proposal: { status: 'reconciliation-required' },
      });
      expect(projection).toHaveBeenCalledTimes(2);
    },
  );
});

describe('issue-W1-corrective-5-c6: direct claim actor binding', () => {
  it.each([
    null,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '7',
  ])(
    'rejects invalid runtime actor %s without claiming or changing bindings',
    async (actor) => {
      // Regression caught: the repository seam accepted null despite the
      // controller normally supplying a user id or local operator 0.
      const proposals = new AgentOrgProposalsRepository();
      const proposal = await proposals.createAsync({
        kind: 'broaden-scope',
        risk: 'high',
        title: 'C5 actor guard',
        changeJson: '{"exact":true}',
        dedupKey: `w1-c5:actor:${crypto.randomUUID()}`,
      });

      await expect((proposals.claimAppliedWithSnapshotAsync as any)(
        proposal.id,
        actor,
        '{"snapshot":true}',
        '{"exact":true}',
      )).rejects.toThrow(/actor|user/i);
      expect(await proposals.findByIdAsync(proposal.id)).toMatchObject({
        status: 'proposed',
        decidedByUserId: null,
        beforeSnapshotJson: null,
        changeJson: '{"exact":true}',
      });
    },
  );

  it('preserves local operator actor 0 and exact snapshot/change bindings', async () => {
    const proposals = new AgentOrgProposalsRepository();
    const proposal = await proposals.createAsync({
      kind: 'broaden-scope',
      risk: 'high',
      title: 'C5 actor zero',
      changeJson: '{"exact":true}',
      dedupKey: `w1-c5:actor-zero:${crypto.randomUUID()}`,
    });
    // Package C: the scope claim lands on `approved`, and actor 0 (the local
    // operator sentinel) must survive it exactly — a falsy-actor guard that
    // rejects or nulls 0 is the bug this pins.
    const claimed = await proposals.claimScopeApprovedWithSnapshotAsync({
      id: proposal.id,
      decidedByUserId: 0,
      expectedRevision: proposal.revision,
      expectedKind: 'broaden-scope',
      expectedChangeJson: '{"exact":true}',
      beforeSnapshotJson: '{"snapshot":true}',
      validateSnapshot: () => true,
    });
    expect(claimed).toMatchObject({
      status: 'approved',
      decidedByUserId: 0,
      beforeSnapshotJson: '{"snapshot":true}',
      changeJson: '{"exact":true}',
    });
  });
});
