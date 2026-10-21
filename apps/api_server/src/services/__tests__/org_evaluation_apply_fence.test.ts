import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../../repositories/agent_skills_repository';
import { AgentScheduledTasksRepository } from '../../repositories/agent_scheduled_tasks_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { armOrgEvaluationApplyFence } from '../org_evaluation_apply_fence';
import { registerAllProposalAppliers } from '../org_proposal_appliers_wiring';
import { applyProposal, type ProposalApplier } from '../org_proposal_apply_service';
import { applyApprovedScopeProposal } from '../org_proposal_scope_lifecycle';

let db: Database.Database;
afterEach(() => { setDb(null); db?.close(); });

describe('evaluated apply fence', () => {
  it('refuses an unrelated profile edit after the approved claim but before the scope pair', async () => {
    db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    registerAllProposalAppliers();
    const configs = new AgentConfigsRepository();
    const proposals = new AgentOrgProposalsRepository(db);
    const profile = configs.insert({ label: 'Scoped target', icon: 'x',
      systemPrompt: 'tested prompt', allowedSkillsJson: '["initial"]' });
    const proposal = await proposals.createAsync({
      kind: 'refine-scope', risk: 'high', title: 'Scoped improvement',
      targetRef: `agent_config:${profile.id}`,
      changeJson: JSON.stringify({ scopePatch: { agentConfigId: profile.id,
        field: 'allowedSkillsJson', add: ['reviewed-skill'] } }),
      provenanceJson: JSON.stringify({ source: 'org-reviewer-evaluated' }),
      dedupKey: 'evaluated-scope-unrelated-edit',
    });
    armOrgEvaluationApplyFence(proposal, {
      schemaVersion: 1, effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6', source: 'hardcoded-default' },
      kind: 'refine-scope', targetRef: `agent_config:${profile.id}`,
      targetRevision: String(profile.revision), profiles: [{
        id: profile.id, label: profile.label, systemPrompt: profile.systemPrompt,
        revision: profile.revision ?? 0, allowedMcpsJson: profile.allowedMcpsJson,
        allowedSkillsJson: profile.allowedSkillsJson, corePermissionsJson: profile.corePermissionsJson,
        allowedDelegatesJson: profile.allowedDelegatesJson, isManager: profile.isManager,
        modelProvider: profile.modelProvider, modelId: profile.modelId,
      }], skills: [], schedules: [], recipes: [], managedSkillFiles: [],
    });
    const prepared = await applyProposal(proposal);
    expect(prepared.scopePair).toBeDefined();
    const originalClaim = proposals.claimScopeApprovedWithSnapshotAsync.bind(proposals);
    proposals.claimScopeApprovedWithSnapshotAsync = async (input) => {
      const claimed = await originalClaim(input);
      if (claimed) configs.update(profile.id, { systemPrompt: 'operator changed prompt',
        modelProvider: 'openai', modelId: 'gpt-6.1-sol' });
      return claimed;
    };
    const outcome = await applyApprovedScopeProposal({ proposal,
      decidedByUserId: 0, changeJson: prepared.changeJson!,
      beforeSnapshotJson: prepared.beforeSnapshotJson!, pair: prepared.scopePair!,
      deps: { proposalsRepo: proposals } });
    expect(outcome.kind).toBe('conflict');
    expect(configs.getById(profile.id)?.allowedSkillsJson).toBe('["initial"]');
    expect(configs.getById(profile.id)?.systemPrompt).toBe('operator changed prompt');
    expect(configs.getById(profile.id)?.modelId).toBe('gpt-6.1-sol');
    expect((await proposals.findByIdAsync(proposal.id))?.status).toBe('failed');
  });

  it('rejects an operator edit made after approval recapture and preserves the live config', () => {
    db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const configs = new AgentConfigsRepository();
    const original = configs.insert({ label: 'Target', icon: 'x', systemPrompt: 'original' });
    const proposal = {
      id: 'evaluated-race', kind: 'refine-config', targetRef: `agent_config:${original.id}`,
      changeJson: JSON.stringify({ configPatch: { agentConfigId: original.id,
        field: 'systemPrompt', value: 'tested candidate' } }),
      provenanceJson: JSON.stringify({ source: 'org-reviewer-evaluated' }),
    } as AgentOrgProposal;
    armOrgEvaluationApplyFence(proposal, {
      schemaVersion: 1, effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6', source: 'hardcoded-default' },
      kind: 'refine-config', targetRef: proposal.targetRef!,
      targetRevision: String(original.revision), profiles: [{
        id: original.id, label: original.label, systemPrompt: original.systemPrompt,
        revision: original.revision ?? 0, allowedMcpsJson: original.allowedMcpsJson,
        allowedSkillsJson: original.allowedSkillsJson, corePermissionsJson: original.corePermissionsJson,
        allowedDelegatesJson: original.allowedDelegatesJson, isManager: original.isManager,
        modelProvider: original.modelProvider, modelId: original.modelId,
      }], skills: [], schedules: [], recipes: [], managedSkillFiles: [],
    });
    const appliers = new Map<string, ProposalApplier>();
    registerAllProposalAppliers({ registerProposalApplier: (kind, applier) => { appliers.set(kind, applier); },
      registerProposalValidator: () => {} });
    configs.update(original.id, { systemPrompt: 'operator edit' });
    expect(() => appliers.get('refine-config')!(proposal)).toThrow(/Evaluated profile changed/);
    expect(configs.getById(original.id)?.systemPrompt).toBe('operator edit');
  });

  it('blocks publishing a skill changed after recapture before making an outbound request', async () => {
    db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const skills = new AgentSkillsRepository();
    const skill = skills.create({ title: 'Reviewed skill', body: 'reviewed bytes' });
    const proposal = {
      id: 'evaluated-publish-race', kind: 'publish-skill-to-org', targetRef: `skill:${skill.id}`,
      changeJson: JSON.stringify({ skillName: skill.title, action: 'unpublish' }),
      provenanceJson: JSON.stringify({ source: 'org-reviewer-evaluated' }),
    } as AgentOrgProposal;
    armOrgEvaluationApplyFence(proposal, {
      schemaVersion: 1, effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6', source: 'hardcoded-default' },
      kind: 'publish-skill-to-org', targetRef: proposal.targetRef!,
      targetRevision: String(skill.version), profiles: [], skills: [{
        id: skill.id, title: skill.title, body: skill.body, description: skill.description,
        whenToUse: skill.whenToUse, version: skill.version,
      }], schedules: [], recipes: [], managedSkillFiles: [],
    });
    const appliers = new Map<string, ProposalApplier>();
    registerAllProposalAppliers({ registerProposalApplier: (kind, applier) => { appliers.set(kind, applier); },
      registerProposalValidator: () => {} });
    const misbound = { ...proposal, id: 'evaluated-publish-wrong-target',
      changeJson: JSON.stringify({ skillName: 'Different skill', action: 'unpublish' }) } as AgentOrgProposal;
    armOrgEvaluationApplyFence(misbound, {
      schemaVersion: 1, effectiveModel: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6', source: 'hardcoded-default' },
      kind: 'publish-skill-to-org', targetRef: proposal.targetRef!,
      targetRevision: String(skill.version), profiles: [], skills: [{
        id: skill.id, title: skill.title, body: skill.body, description: skill.description,
        whenToUse: skill.whenToUse, version: skill.version,
      }], schedules: [], recipes: [], managedSkillFiles: [],
    });
    await expect(appliers.get('publish-skill-to-org')!(misbound)).rejects.toThrow(/publication target differs/);
    db.prepare('UPDATE agent_skills SET body = ? WHERE id = ?').run('operator edit', skill.id);
    await expect(appliers.get('publish-skill-to-org')!(proposal)).rejects.toThrow(/Evaluated skill changed/);
  });

  it('uses the frozen scheduled-task revision and exact field preimage for evaluated edits', async () => {
    db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const tasks = new AgentScheduledTasksRepository();
    const original = await tasks.createAsync({ name: 'Reviewed schedule', scheduleType: 'daily',
      prompt: 'original prompt' });
    const proposal = {
      id: 'evaluated-task-race', kind: 'refine-task', targetRef: `scheduled_task:${original.id}`,
      changeJson: JSON.stringify({ taskPatch: { scheduledTaskId: original.id,
        field: 'prompt', value: 'tested prompt' } }),
      provenanceJson: JSON.stringify({ source: 'org-reviewer-evaluated' }),
    } as AgentOrgProposal;
    const frozen = {
      schemaVersion: 1 as const, effectiveModel: { providerID: 'anthropic' as const,
        modelID: 'claude-sonnet-4-6' as const, source: 'hardcoded-default' as const },
      kind: 'refine-task' as const, targetRef: proposal.targetRef!,
      targetRevision: original.updatedAt, profiles: [], skills: [], recipes: [], managedSkillFiles: [],
      schedules: [{ id: original.id, name: original.name, description: original.description,
        prompt: original.prompt, agentKind: original.agentKind, agentConfigId: original.agentConfigId,
        modelProvider: original.modelProvider, modelId: original.modelId, enabled: original.enabled,
        scheduleType: original.scheduleType, scheduledTime: original.scheduledTime,
        scheduledDay: original.scheduledDay, timezone: original.timezone,
        cronExpression: original.cronExpression, runAt: original.runAt,
        allowedMcpsJson: original.allowedMcpsJson, allowedSkillsJson: original.allowedSkillsJson }],
    };
    armOrgEvaluationApplyFence(proposal, frozen);
    const appliers = new Map<string, ProposalApplier>();
    registerAllProposalAppliers({ registerProposalApplier: (kind, applier) => { appliers.set(kind, applier); },
      registerProposalValidator: () => {} });
    db.prepare('UPDATE agent_scheduled_tasks SET name=? WHERE id=?').run('operator renamed', original.id);
    await expect(appliers.get('refine-task')!(proposal)).rejects.toThrow(/Evaluated scheduled task changed/);
    db.prepare('UPDATE agent_scheduled_tasks SET name=? WHERE id=?').run(original.name, original.id);
    db.prepare('UPDATE agent_scheduled_tasks SET prompt=?, updated_at=? WHERE id=?')
      .run('operator edit', '2099-01-01T00:00:00.000Z', original.id);
    await expect(appliers.get('refine-task')!(proposal)).rejects.toThrow(/Evaluated scheduled task changed/);
    expect((await tasks.findByIdAsync(original.id))?.prompt).toBe('operator edit');

    db.prepare('UPDATE agent_scheduled_tasks SET prompt=?, updated_at=? WHERE id=?')
      .run(original.prompt, original.updatedAt, original.id);
    await appliers.get('refine-task')!(proposal);
    expect((await tasks.findByIdAsync(original.id))?.prompt).toBe('tested prompt');
  });
});
