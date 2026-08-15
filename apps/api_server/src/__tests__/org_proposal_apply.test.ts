/**
 * CONTRACT TEST for issue #821 (org-optimizer-05) — must fail before
 * implementation, then pass once org_proposal_apply.ts / org_proposal_measure.ts
 * exist. See docs/ai/contracts/issue-821.json for the criterion mapping.
 *
 * Covers:
 *  - issue-821-c1: applyProposal writes before_snapshot_json, applies, sets
 *    status='measuring'.
 *  - issue-821-c2: applyProposal refuses any 'high'-risk proposal.
 *  - issue-821-c3a: measureProposal (prune-scope) keeps on strict hygiene
 *    improvement + functional guard pass.
 *  - issue-821-c3b: measureProposal (prune-scope) reverts when the functional
 *    guard fails (a recently-exercised scope was pruned).
 *  - issue-821-c3c: measureProposal (refine-skill) keeps iff post > baseline
 *    via the injected LLM scorer; ties revert (fail-closed).
 *  - issue-821-c4: revert replays before_snapshot_json, restores prior state,
 *    sets status='reverted', and the dedup seen-set still reports the
 *    proposal as seen (not re-proposable).
 *  - issue-821-c5: unexpected error during apply/measure never throws into
 *    the caller — resolves to a skipped/no-op outcome.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('W1: versioned scope snapshots', () => {
  it('builds a scope-delta-v2 snapshot before mutation with exact CAS material', async () => {
    const { createScopeDeltaV2Snapshot } = await import('../services/org_proposal_apply');
    const priorValue = JSON.stringify(['gitnexus', 'rhythm']);

    const snapshot = createScopeDeltaV2Snapshot(
      'config-1',
      'allowedMcpsJson',
      priorValue,
      ['gitnexus'],
    );

    expect(snapshot).toMatchObject({
      version: 'scope-delta-v2',
      target: { type: 'agent_config', id: 'config-1' },
      field: 'allowedMcpsJson',
      requestedRemove: ['gitnexus'],
      removedEntries: [{ name: 'gitnexus', priorValue: 'gitnexus', priorIndex: 0 }],
      expectedAppliedValue: JSON.stringify(['rhythm']),
    });
    expect(snapshot.expectedAppliedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(priorValue).toBe(JSON.stringify(['gitnexus', 'rhythm']));
  });
});

describe('issue-821-c2: applyProposal refuses any high-risk proposal', () => {
  it('does not apply and does not transition status for a high-risk proposal', async () => {
    // Bug this catches: applyProposal trusts the caller instead of
    // re-checking classifyProposalRisk itself, so a caller bug (or a future
    // regression in the queue-gating code) could apply a privilege-granting
    // change through the "auto" path.
    const { applyProposal } = await import('../services/org_proposal_apply');
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'create-agent',
      risk: 'high',
      title: 'Create a new specialist agent',
      dedupKey: 'create-agent:specialist-x',
    });

    const result = await applyProposal(proposal);
    expect(result.status).toBe('refused-high-risk');

    const unchanged = await proposalsRepo.findByIdAsync(proposal.id);
    expect(unchanged?.status).toBe('proposed');
    expect(unchanged?.beforeSnapshotJson).toBeNull();
  });

  it.each(['tighten-scope', 'prune-scope'])(
    'refuses %s even when the stored risk column says low',
    async (kind) => {
      const { applyProposal } = await import('../services/org_proposal_apply');
      const configsRepo = new AgentConfigsRepository();
      const config = configsRepo.insert({
        label: `Stored-low ${kind}`,
        icon: 'shield',
        allowedMcpsJson: JSON.stringify(['gitnexus', 'rhythm']),
      });
      const proposalsRepo = new AgentOrgProposalsRepository();
      const proposal = await proposalsRepo.createAsync({
        kind,
        risk: 'low',
        title: `Refuse stored-low ${kind}`,
        targetRef: `agent_config:${config.id}`,
        changeJson: JSON.stringify({
          agentConfigId: config.id,
          field: 'allowedMcpsJson',
          remove: ['gitnexus'],
        }),
        dedupKey: `w1:stored-low:${kind}`,
      });

      const before = configsRepo.getById(config.id)?.allowedMcpsJson;
      const result = await applyProposal(proposal);

      expect(result.status).toBe('refused-high-risk');
      expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(before);
      expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('proposed');
    },
  );

  it('refuses a scope-removal payload mislabeled as a low-risk text kind', async () => {
    const { applyProposal } = await import('../services/org_proposal_apply');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Mislabeled scope',
      icon: 'shield',
      allowedMcpsJson: JSON.stringify(['gitnexus', 'rhythm']),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-recipe',
      risk: 'low',
      title: 'Mislabeled removal',
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['gitnexus'],
      }),
      dedupKey: 'w1:mislabeled-scope-removal',
    });

    const before = configsRepo.getById(config.id)?.allowedMcpsJson;
    expect((await applyProposal(proposal)).status).toBe('refused-high-risk');
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(before);
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('proposed');
  });

  it('refuses the auto path when a low-risk kind hides removal under nested scopePatch', async () => {
    const { applyProposal } = await import('../services/org_proposal_apply');
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-recipe',
      risk: 'low',
      title: 'Nested scope removal',
      changeJson: JSON.stringify({
        change: {
          scopePatch: {
            agentConfigId: 'config-1',
            field: 'allowedMcpsJson',
            remove: ['gitnexus'],
          },
        },
      }),
      dedupKey: 'w1:nested-auto-refusal',
    });

    expect(await applyProposal(proposal)).toMatchObject({ status: 'refused-high-risk' });
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('proposed');
  });

  it.each([
    {
      label: 'field only with null prior',
      prior: null,
      payload: (agentConfigId: string) => ({ agentConfigId, field: 'allowedMcpsJson' }),
    },
    {
      label: 'empty removal with null prior',
      prior: null,
      payload: (agentConfigId: string) => ({
        agentConfigId,
        field: 'allowedMcpsJson',
        remove: [],
      }),
    },
    {
      label: 'field only with whitespace-formatted prior',
      prior: ' [ "gitnexus", "rhythm" ] ',
      payload: (agentConfigId: string) => ({ agentConfigId, field: 'allowedMcpsJson' }),
    },
    {
      label: 'nested field only with whitespace-formatted prior',
      prior: ' [ "gitnexus", "rhythm" ] ',
      payload: (agentConfigId: string) => ({
        wrapper: { agentConfigId, field: 'allowedMcpsJson' },
      }),
    },
  ])('refuses ambiguous scope payload: $label', async ({ prior, payload }) => {
    // Bug this catches: the obsolete unattended scope lane normalizes null or
    // whitespace-formatted bytes even when no valid removal was requested.
    const { applyProposal } = await import('../services/org_proposal_apply');
    const writer = await import('../services/opencode_agent_writer');
    const profileSpy = vi.spyOn(writer, 'writeAgentProfileFile');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Ambiguous scope target',
      icon: 'shield',
      allowedMcpsJson: prior,
    });
    const configUpdateSpy = vi.spyOn(configsRepo, 'update');
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-recipe',
      risk: 'low',
      title: 'Ambiguous scope payload',
      changeJson: JSON.stringify(payload(config.id)),
      dedupKey: `w1:ambiguous-scope:${config.id}`,
    });

    expect(await applyProposal(proposal, { proposalsRepo, configsRepo })).toMatchObject({
      status: 'refused-high-risk',
    });
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(prior);
    expect(configUpdateSpy).not.toHaveBeenCalled();
    expect(profileSpy).not.toHaveBeenCalled();
    const stored = await proposalsRepo.findByIdAsync(proposal.id);
    expect(stored?.status).toBe('proposed');
    expect(stored?.beforeSnapshotJson).toBeNull();
  });
});

describe('W1: conflict-safe scope revert', () => {
  it('refuses a legacy whole-field scope snapshot without changing config or status', async () => {
    const { revertProposal } = await import('../services/org_proposal_apply');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Legacy scope',
      icon: 'shield',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'high',
      title: 'Legacy scope snapshot',
      changeJson: JSON.stringify({
        agentConfigId: config.id,
        field: 'allowedMcpsJson',
        remove: ['gitnexus'],
      }),
      beforeSnapshotJson: JSON.stringify({
        allowedMcpsJson: JSON.stringify(['gitnexus', 'rhythm']),
      }),
      dedupKey: 'w1:legacy-service-revert',
    });
    await proposalsRepo.updateStatusAsync(proposal.id, 'applied');
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');
    const before = configsRepo.getById(config.id)?.allowedMcpsJson;

    expect(await revertProposal(active!)).toBe('unsafe-legacy-scope');
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(before);
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('active');
  });

  it.each([null, 'not-json'])('fails closed for legacy scope kind with missing/malformed change_json: %s', async (changeJson) => {
    const { revertProposal } = await import('../services/org_proposal_apply');
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Legacy malformed scope',
      icon: 'shield',
      allowedMcpsJson: JSON.stringify(['rhythm']),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'tighten-scope',
      risk: 'high',
      title: 'Legacy malformed scope snapshot',
      changeJson,
      beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: JSON.stringify(['x', 'rhythm']) }),
      dedupKey: `w1:legacy-malformed:${String(changeJson)}`,
    });
    await proposalsRepo.updateStatusAsync(proposal.id, 'applied');
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');
    const before = configsRepo.getById(config.id)?.allowedMcpsJson;

    expect(await revertProposal(active!)).toBe('unsafe-legacy-scope');
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(before);
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('active');
  });

  it('restores removed array entries only when the current value exactly matches apply', async () => {
    const { createScopeDeltaV2Snapshot, revertProposal } = await import(
      '../services/org_proposal_apply'
    );
    const configsRepo = new AgentConfigsRepository();
    const prior = JSON.stringify(['gitnexus', 'rhythm', 'pco-services']);
    const config = configsRepo.insert({
      label: 'Array scope',
      icon: 'shield',
      allowedMcpsJson: prior,
    });
    const snapshot = createScopeDeltaV2Snapshot(
      config.id,
      'allowedMcpsJson',
      prior,
      ['gitnexus', 'pco-services'],
    );
    configsRepo.update(config.id, { allowedMcpsJson: snapshot.expectedAppliedValue });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'high',
      title: 'V2 array revert',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus', 'pco-services'] }),
      beforeSnapshotJson: JSON.stringify(snapshot),
      dedupKey: 'w1:v2-array-revert',
    });
    await proposalsRepo.updateStatusAsync(proposal.id, 'applied');
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');

    expect(await revertProposal(active!)).toBe('reverted');
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(prior);
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('reverted');
  });

  it('returns conflict without writes when any intervening scope edit changed the field', async () => {
    const { createScopeDeltaV2Snapshot, revertProposal } = await import(
      '../services/org_proposal_apply'
    );
    const configsRepo = new AgentConfigsRepository();
    const prior = JSON.stringify(['gitnexus', 'rhythm']);
    const config = configsRepo.insert({
      label: 'Concurrent scope',
      icon: 'shield',
      allowedMcpsJson: prior,
    });
    const snapshot = createScopeDeltaV2Snapshot(
      config.id,
      'allowedMcpsJson',
      prior,
      ['gitnexus'],
    );
    const intervening = JSON.stringify(['rhythm', 'pco-services']);
    configsRepo.update(config.id, { allowedMcpsJson: intervening });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'high',
      title: 'V2 conflict',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus'] }),
      beforeSnapshotJson: JSON.stringify(snapshot),
      dedupKey: 'w1:v2-conflict',
    });
    await proposalsRepo.updateStatusAsync(proposal.id, 'applied');
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');

    expect(await revertProposal(active!)).toBe('conflict');
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(intervening);
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('active');
  });

  it('restores only removed tools-map entries and preserves narrowed sibling values', async () => {
    const { createScopeDeltaV2Snapshot, revertProposal } = await import(
      '../services/org_proposal_apply'
    );
    const configsRepo = new AgentConfigsRepository();
    const prior = JSON.stringify({
      gitnexus: ['query', 'impact'],
      rhythm: ['rhythm_ping'],
      'pco-services': null,
    });
    const config = configsRepo.insert({
      label: 'Tools map scope',
      icon: 'shield',
      allowedMcpsJson: prior,
    });
    const snapshot = createScopeDeltaV2Snapshot(
      config.id,
      'allowedMcpsJson',
      prior,
      ['gitnexus'],
    );
    configsRepo.update(config.id, { allowedMcpsJson: snapshot.expectedAppliedValue });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'tighten-scope',
      risk: 'high',
      title: 'V2 tools-map revert',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus'] }),
      beforeSnapshotJson: JSON.stringify(snapshot),
      dedupKey: 'w1:v2-map-revert',
    });
    await proposalsRepo.updateStatusAsync(proposal.id, 'applied');
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');

    expect(await revertProposal(active!)).toBe('reverted');
    expect(JSON.parse(configsRepo.getById(config.id)?.allowedMcpsJson ?? '{}')).toEqual({
      gitnexus: ['query', 'impact'],
      rhythm: ['rhythm_ping'],
      'pco-services': null,
    });
  });

  it.each([
    { label: 'missing', changeJson: null },
    { label: 'malformed', changeJson: 'not-json' },
    {
      label: 'wrong target',
      changeJson: JSON.stringify({ agentConfigId: 'other', field: 'allowedMcpsJson', remove: ['x'] }),
    },
    {
      label: 'wrong field',
      changeJson: JSON.stringify({ agentConfigId: 'TARGET', field: 'allowedSkillsJson', remove: ['x'] }),
    },
    {
      label: 'wrong removal',
      changeJson: JSON.stringify({ agentConfigId: 'TARGET', field: 'allowedMcpsJson', remove: ['z'] }),
    },
    {
      label: 'extra add',
      changeJson: JSON.stringify({ agentConfigId: 'TARGET', field: 'allowedMcpsJson', remove: ['x'], add: ['z'] }),
    },
  ])('requires exact V2 snapshot/change binding: $label', async ({ changeJson }) => {
    const { createScopeDeltaV2Snapshot, revertProposal } = await import('../services/org_proposal_apply');
    const configsRepo = new AgentConfigsRepository();
    const prior = JSON.stringify(['x', 'y']);
    const config = configsRepo.insert({ label: 'Binding target', icon: 'shield', allowedMcpsJson: prior });
    const snapshot = createScopeDeltaV2Snapshot(config.id, 'allowedMcpsJson', prior, ['x']);
    configsRepo.update(config.id, { allowedMcpsJson: snapshot.expectedAppliedValue });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const boundChange = changeJson?.replace('TARGET', config.id) ?? null;
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'high',
      title: 'Exact binding',
      changeJson: boundChange,
      beforeSnapshotJson: JSON.stringify(snapshot),
      dedupKey: `w1:binding:${String(boundChange)}`,
    });
    await proposalsRepo.updateStatusAsync(proposal.id, 'applied');
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');

    expect(await revertProposal(active!)).toBe('conflict');
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(snapshot.expectedAppliedValue);
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('active');
  });

  it.each(['__proto__', 'constructor', 'prototype'])(
    'refuses reserved requested name %s when creating array and tools-map snapshots',
    async (reserved) => {
      const { createScopeDeltaV2Snapshot } = await import('../services/org_proposal_apply');
      const arrayPrior = JSON.stringify([reserved, 'safe']);
      const mapPrior = JSON.stringify(Object.fromEntries([[reserved, ['read']], ['safe', ['read']]]));

      expect(() => createScopeDeltaV2Snapshot('array-target', 'allowedSkillsJson', arrayPrior, [` ${reserved} `]))
        .toThrow(/reserved/i);
      expect(() => createScopeDeltaV2Snapshot('map-target', 'allowedMcpsJson', mapPrior, [reserved]))
        .toThrow(/reserved/i);
    },
  );

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects a tampered V2 snapshot containing reserved name %s without writing',
    async (reserved) => {
      const { createHash } = await import('node:crypto');
      const { createScopeDeltaV2Snapshot, revertProposal } = await import('../services/org_proposal_apply');
      const configsRepo = new AgentConfigsRepository();
      const prior = JSON.stringify(['x', 'safe']);
      const config = configsRepo.insert({ label: `Tampered ${reserved}`, icon: 'shield', allowedSkillsJson: prior });
      const snapshot = createScopeDeltaV2Snapshot(config.id, 'allowedSkillsJson', prior, ['x']);
      snapshot.requestedRemove = [reserved];
      snapshot.removedEntries = [{ name: reserved, priorValue: reserved, priorIndex: 0 }];
      snapshot.integrityHash = createHash('sha256').update(JSON.stringify({
        version: snapshot.version,
        target: snapshot.target,
        field: snapshot.field,
        requestedRemove: snapshot.requestedRemove,
        removedEntries: snapshot.removedEntries,
        expectedAppliedValue: snapshot.expectedAppliedValue,
      })).digest('hex');
      configsRepo.update(config.id, { allowedSkillsJson: snapshot.expectedAppliedValue });
      const proposalsRepo = new AgentOrgProposalsRepository();
      const proposal = await proposalsRepo.createAsync({
        kind: 'prune-scope', risk: 'high', title: `Tampered ${reserved}`,
        changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedSkillsJson', remove: [reserved] }),
        beforeSnapshotJson: JSON.stringify(snapshot), dedupKey: `w1:tampered-reserved:${reserved}`,
      });
      await proposalsRepo.updateStatusAsync(proposal.id, 'applied');
      await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
      const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');

      expect(await revertProposal(active!)).toBe('unsafe-legacy-scope');
      expect(configsRepo.getById(config.id)?.allowedSkillsJson).toBe(snapshot.expectedAppliedValue);
      expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('active');
    },
  );
});

describe('W1: deferred human scope apply CAS', () => {
  it('prepares without mutation and a CAS miss conflicts without projection or overwrite', async () => {
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    const { applyProposal: applyHumanProposal } = await import('../services/org_proposal_apply_service');
    const writer = await import('../services/opencode_agent_writer');
    registerAllProposalAppliers();
    const profileSpy = vi.spyOn(writer, 'writeAgentProfileFile');
    const configsRepo = new AgentConfigsRepository();
    const prior = JSON.stringify(['gitnexus', 'rhythm']);
    const config = configsRepo.insert({ label: 'Deferred CAS', icon: 'shield', allowedMcpsJson: prior });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Deferred CAS',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus'] }),
      dedupKey: 'w1:deferred-cas-miss',
    });

    const prepared = await applyHumanProposal(proposal);
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(prior);
    expect(prepared.beforeSnapshotJson).toBeTruthy();

    const intervening = JSON.stringify(['gitnexus', 'rhythm', 'pco-services']);
    configsRepo.update(config.id, { allowedMcpsJson: intervening });
    await expect(async () => prepared.applyAfterClaim?.()).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    });
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(intervening);
    expect(profileSpy).not.toHaveBeenCalled();
  });

  it.each(['blocked', 'failed'] as const)(
    'compensates approval when profile projection returns %s and leaves the durable claim applied',
    async (writerResult) => {
      const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
      const { applyProposal: applyHumanProposal } = await import('../services/org_proposal_apply_service');
      const writer = await import('../services/opencode_agent_writer');
      registerAllProposalAppliers();
      vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue(writerResult);
      const configsRepo = new AgentConfigsRepository();
      const prior = ' [ "gitnexus", "rhythm" ] ';
      const config = configsRepo.insert({ label: `Approval ${writerResult}`, icon: 'shield', allowedMcpsJson: prior });
      const proposalsRepo = new AgentOrgProposalsRepository();
      const proposal = await proposalsRepo.createAsync({
        kind: 'prune-scope', risk: 'high', title: `Approval ${writerResult}`,
        changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus'] }),
        dedupKey: `w1:approval-writer:${writerResult}`,
      });
      const prepared = await applyHumanProposal(proposal);
      const applied = await proposalsRepo.claimAppliedWithSnapshotAsync(
        proposal.id,
        77,
        prepared.beforeSnapshotJson ?? null,
        proposal.changeJson,
      );
      expect(applied?.status).toBe('applied');

      await expect(async () => prepared.applyAfterClaim?.()).rejects.toMatchObject({
        statusCode: 409,
        code: 'CONFLICT',
      });
      expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(prior);
      expect(await proposalsRepo.findByIdAsync(proposal.id)).toMatchObject({
        status: 'applied',
        beforeSnapshotJson: prepared.beforeSnapshotJson,
        decidedByUserId: 77,
      });
    },
  );

  it('does not overwrite a concurrent approval value when projection compensation loses', async () => {
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    const { applyProposal: applyHumanProposal } = await import('../services/org_proposal_apply_service');
    const writer = await import('../services/opencode_agent_writer');
    registerAllProposalAppliers();
    vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('failed');
    const configsRepo = new AgentConfigsRepository();
    const prior = JSON.stringify(['gitnexus', 'rhythm']);
    const concurrent = JSON.stringify(['rhythm', 'pco-services']);
    const config = configsRepo.insert({ label: 'Approval compensation race', icon: 'shield', allowedMcpsJson: prior });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Approval compensation race',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus'] }),
      dedupKey: 'w1:approval-compensation-race',
    });
    const prepared = await applyHumanProposal(proposal);
    await proposalsRepo.claimAppliedWithSnapshotAsync(
      proposal.id,
      77,
      prepared.beforeSnapshotJson ?? null,
      proposal.changeJson,
    );
    const originalCas = AgentConfigsRepository.prototype.compareAndSetScopeField;
    let casCalls = 0;
    vi.spyOn(AgentConfigsRepository.prototype, 'compareAndSetScopeField')
      .mockImplementation(function (this: AgentConfigsRepository, ...args) {
        casCalls += 1;
        if (casCalls === 2) configsRepo.update(config.id, { allowedMcpsJson: concurrent });
        return originalCas.apply(this, args);
      });

    await expect(async () => prepared.applyAfterClaim?.()).rejects.toMatchObject({ statusCode: 409 });
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(concurrent);
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('applied');
  });
});

describe('W1: scope projection is a revert gate', () => {
  it.each(['blocked', 'failed'] as const)(
    'compensates revert when profile projection returns %s and keeps the proposal active',
    async (writerResult) => {
      const { createScopeDeltaV2Snapshot, revertProposal } = await import('../services/org_proposal_apply');
      const writer = await import('../services/opencode_agent_writer');
      vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue(writerResult);
      const configsRepo = new AgentConfigsRepository();
      const prior = ' [ "gitnexus", "rhythm" ] ';
      const config = configsRepo.insert({ label: `Revert ${writerResult}`, icon: 'shield', allowedMcpsJson: prior });
      const snapshot = createScopeDeltaV2Snapshot(config.id, 'allowedMcpsJson', prior, ['gitnexus']);
      configsRepo.update(config.id, { allowedMcpsJson: snapshot.expectedAppliedValue });
      const proposalsRepo = new AgentOrgProposalsRepository();
      const proposal = await proposalsRepo.createAsync({
        kind: 'prune-scope', risk: 'high', title: `Revert ${writerResult}`,
        changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus'] }),
        beforeSnapshotJson: JSON.stringify(snapshot),
        dedupKey: `w1:revert-writer:${writerResult}`,
      });
      await proposalsRepo.updateStatusAsync(proposal.id, 'applied');
      await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
      const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');

      expect(await revertProposal(active!)).toBe('conflict');
      expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(snapshot.expectedAppliedValue);
      expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('active');
    },
  );

  it('does not overwrite a concurrent revert value when projection compensation loses', async () => {
    const { createScopeDeltaV2Snapshot, revertProposal } = await import('../services/org_proposal_apply');
    const writer = await import('../services/opencode_agent_writer');
    vi.spyOn(writer, 'writeAgentProfileFile').mockReturnValue('failed');
    const configsRepo = new AgentConfigsRepository();
    const prior = JSON.stringify(['gitnexus', 'rhythm']);
    const concurrent = JSON.stringify(['rhythm', 'pco-services']);
    const config = configsRepo.insert({ label: 'Revert compensation race', icon: 'shield', allowedMcpsJson: prior });
    const snapshot = createScopeDeltaV2Snapshot(config.id, 'allowedMcpsJson', prior, ['gitnexus']);
    configsRepo.update(config.id, { allowedMcpsJson: snapshot.expectedAppliedValue });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Revert compensation race',
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['gitnexus'] }),
      beforeSnapshotJson: JSON.stringify(snapshot), dedupKey: 'w1:revert-compensation-race',
    });
    await proposalsRepo.updateStatusAsync(proposal.id, 'applied');
    await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const active = await proposalsRepo.updateStatusAsync(proposal.id, 'active');
    const originalCas = AgentConfigsRepository.prototype.compareAndSetScopeField;
    let casCalls = 0;
    vi.spyOn(AgentConfigsRepository.prototype, 'compareAndSetScopeField')
      .mockImplementation(function (this: AgentConfigsRepository, ...args) {
        casCalls += 1;
        if (casCalls === 2) configsRepo.update(config.id, { allowedMcpsJson: concurrent });
        return originalCas.apply(this, args);
      });

    expect(await revertProposal(active!)).toBe('conflict');
    expect(configsRepo.getById(config.id)?.allowedMcpsJson).toBe(concurrent);
    expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('active');
  });
});

describe('W1: local approval claim identity and change binding', () => {
  it('passes the non-null local sentinel and exact scope change into the winning claim', async () => {
    const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
    const { AgentOrgProposalsRepository } = await import('../repositories/agent_org_proposals_repository');
    const { OrgProposalsController } = await import('../controllers/org_proposals_controller');
    registerAllProposalAppliers();
    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Direct controller actor', icon: 'shield', allowedMcpsJson: JSON.stringify(['x', 'y']),
    });
    const exactChangeJson = ` { "agentConfigId": "${config.id}", "field": "allowedMcpsJson", "remove": ["x"] } `;
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope', risk: 'high', title: 'Direct controller actor',
      changeJson: exactChangeJson, dedupKey: 'w1:direct-controller-actor',
    });
    const claimSpy = vi.spyOn(AgentOrgProposalsRepository.prototype, 'claimAppliedWithSnapshotAsync');
    const res = { json: vi.fn() };
    const next = vi.fn();

    await new OrgProposalsController().approve(
      { params: { id: proposal.id } } as never,
      res as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(claimSpy).toHaveBeenCalledWith(
      proposal.id,
      0,
      expect.stringContaining('scope-delta-v2'),
      exactChangeJson,
    );
    expect(await proposalsRepo.findByIdAsync(proposal.id)).toMatchObject({
      decidedByUserId: 0,
      changeJson: exactChangeJson,
    });
  });
});

describe('W1: reserved scope identifiers fail closed at human validation', () => {
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects reserved removal %s from array and tools-map scopes without writes',
    async (reserved) => {
      const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
      const { validateProposalChange } = await import('../services/org_proposal_apply_service');
      registerAllProposalAppliers();
      for (const [shape, prior] of [
        ['array', JSON.stringify([reserved, 'safe'])],
        ['map', JSON.stringify(Object.fromEntries([[reserved, ['read']], ['safe', ['read']]]))],
      ] as const) {
        const configsRepo = new AgentConfigsRepository();
        const config = configsRepo.insert({
          label: `${shape} reserved ${reserved}`,
          icon: 'shield',
          allowedSkillsJson: prior,
        });
        const proposalsRepo = new AgentOrgProposalsRepository();
        const proposal = await proposalsRepo.createAsync({
          kind: 'prune-scope', risk: 'high', title: `${shape} reserved ${reserved}`,
          changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedSkillsJson', remove: [reserved] }),
          dedupKey: `w1:reserved-remove:${shape}:${reserved}`,
        });

        expect(await validateProposalChange(proposal)).toMatchObject({ valid: false });
        expect(configsRepo.getById(config.id)?.allowedSkillsJson).toBe(prior);
        expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('proposed');
      }
    },
  );

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects trimmed reserved add %s in generic refine-scope without writes',
    async (reserved) => {
      const { registerAllProposalAppliers } = await import('../services/org_proposal_appliers_wiring');
      const { validateProposalChange } = await import('../services/org_proposal_apply_service');
      registerAllProposalAppliers();
      const configsRepo = new AgentConfigsRepository();
      const prior = JSON.stringify(['safe']);
      const config = configsRepo.insert({ label: `Refine reserved ${reserved}`, icon: 'shield', allowedSkillsJson: prior });
      const proposalsRepo = new AgentOrgProposalsRepository();
      const proposal = await proposalsRepo.createAsync({
        kind: 'refine-scope', risk: 'high', title: `Refine reserved ${reserved}`,
        changeJson: JSON.stringify({
          scopePatch: { agentConfigId: config.id, field: 'allowedSkillsJson', add: [` ${reserved} `] },
        }),
        dedupKey: `w1:reserved-refine:${reserved}`,
      });

      expect(await validateProposalChange(proposal)).toMatchObject({ valid: false });
      expect(configsRepo.getById(config.id)?.allowedSkillsJson).toBe(prior);
      expect((await proposalsRepo.findByIdAsync(proposal.id))?.status).toBe('proposed');
    },
  );
});

describe('issue-821-c3c: measureProposal (refine-skill) keeps iff post > baseline via injected scorer; ties revert', () => {
  it('keeps when the injected scorer reports post score strictly greater than baseline', async () => {
    // Bug this catches: the keep rule uses >= instead of strict >, which
    // would keep a no-op / cosmetic "refinement" that did not actually
    // improve anything.
    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-skill',
      risk: 'low',
      title: 'Refine skill body for clarity',
      targetRef: 'skill:example-skill',
      changeJson: JSON.stringify({
        skillName: 'example-skill',
        priorBody: 'Old vague body.',
        revisedBody: 'New precise, actionable body.',
      }),
      dedupKey: 'refine-skill:example-skill:v1',
    });
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    const outcome = await measureProposal(measuring!, {
      scoreSkillBody: async (_purpose: unknown, body: string) => {
        if (body === 'Old vague body.') return { score: 40, reason: 'baseline' };
        if (body === 'New precise, actionable body.') return { score: 85, reason: 'post' };
        return { score: 0, reason: 'unexpected body' };
      },
    });

    expect(outcome).toBe('kept');
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('active');
  });

  it('reverts on a tie (post === baseline), fail-closed', async () => {
    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-skill',
      risk: 'low',
      title: 'Refine skill body (no real change)',
      targetRef: 'skill:example-skill-2',
      changeJson: JSON.stringify({
        skillName: 'example-skill-2',
        priorBody: 'Same body.',
        revisedBody: 'Same body (cosmetic only).',
      }),
      dedupKey: 'refine-skill:example-skill-2:v1',
    });
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    const outcome = await measureProposal(measuring!, {
      scoreSkillBody: async () => ({ score: 60, reason: 'tie' }),
    });

    expect(outcome).toBe('reverted');
    const finalRow = await proposalsRepo.findByIdAsync(proposal.id);
    expect(finalRow?.status).toBe('reverted');
  });
});

describe('issue-821-c5: unexpected errors never throw into the caller', () => {
  it('applyProposal resolves to a skipped outcome (does not throw) when the change payload is malformed', async () => {
    // Bug this catches: a malformed/unexpected changeJson payload throws out
    // of applyProposal, crashing the fire-and-forget optimizer loop instead
    // of degrading to a safe no-op (matching the skill-loop discipline).
    const { applyProposal } = await import('../services/org_proposal_apply');
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      title: 'Malformed change payload',
      changeJson: 'not valid json {{{',
      dedupKey: 'prune-scope:malformed',
    });

    await expect(applyProposal(proposal)).resolves.not.toThrow();
    const result = await applyProposal(proposal);
    expect(['skipped', 'applied-ok', 'refused-high-risk']).toContain(result.status);
  });

  it('measureProposal resolves to skipped (does not throw) when the injected metric hook throws', async () => {
    const { applyProposal } = await import('../services/org_proposal_apply');
    const { measureProposal } = await import('../services/org_proposal_measure');

    const configsRepo = new AgentConfigsRepository();
    const config = configsRepo.insert({
      label: 'Secretary',
      icon: 'mail',
      allowedMcpsJson: JSON.stringify(['nfl_mcp', 'rhythm']),
    });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'prune-scope',
      risk: 'low',
      title: 'Prune scope with throwing guard',
      targetRef: `agent_config:${config.id}`,
      changeJson: JSON.stringify({ agentConfigId: config.id, field: 'allowedMcpsJson', remove: ['nfl_mcp'] }),
      dedupKey: 'prune-scope:secretary:throwing-guard',
    });
    await applyProposal(proposal);
    const measuring = await proposalsRepo.findByIdAsync(proposal.id);

    const outcome = await measureProposal(measuring!, {
      exercisedTools: async () => {
        throw new Error('telemetry unavailable');
      },
    });
    expect(outcome).toBe('skipped');
  });
});
