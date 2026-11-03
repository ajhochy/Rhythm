import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { useTempManagedSkillsRoot } from '../../__tests__/_managed_skills_temp_root';
import { AgentSkillsRepository } from '../../repositories/agent_skills_repository';
import { AgentCookbookRepository } from '../../repositories/agent_cookbook_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { registerAllProposalAppliers } from '../org_proposal_appliers_wiring';
import { applyApprovedProposalAsync, validateProposalChange } from '../org_proposal_apply_service';
import { revertOrgEvaluationBodyAsync } from '../org_evaluation_body_appliers';
import { readManagedSkillBytes, writeManagedSkill } from '../rhythm_managed_skills';

useTempManagedSkillsRoot('rhythm-evaluation-body');
let db: Database.Database;
let previous: Database.Database | null;
beforeEach(() => { db = new Database(':memory:'); runMigrations(db); previous = setDb(db); registerAllProposalAppliers(); });
afterEach(() => { setDb(previous); db.close(); });

describe('exact evaluated body apply and rollback', () => {
  it('actually writes tested recipe steps and preserves a later human edit during rollback', async () => {
    const recipes = new AgentCookbookRepository();
    const original = '[{"action":"prompt","text":"Original step"}]';
    const revised = '[{"action":"prompt","text":"Collect input; report Actions"}]';
    const recipe = await recipes.createAsync({ title: '[smoke] Recipe', stepsJson: original });
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({ kind: 'refine-recipe', targetRef: `recipe:${recipe.id}`,
      title: '[smoke] Revision', risk: 'high', changeJson: JSON.stringify({ recipeId: recipe.id, priorStepsJson: original, revisedStepsJson: revised }) });
    expect(await validateProposalChange(proposal)).toEqual({ valid: true });
    const applied = await applyApprovedProposalAsync({ proposal, decidedByUserId: 0, proposalsRepo,
      finalizePostApply: async () => null, measure: async () => 'skipped' });
    expect(applied.kind).toBe('applied');
    expect((await recipes.findByIdAsync(recipe.id))?.stepsJson).toBe(revised);
    const durable = (await proposalsRepo.findByIdAsync(proposal.id))!;
    await recipes.updateAsync(recipe.id, { stepsJson: '["Later human step"]' });
    expect(await revertOrgEvaluationBodyAsync(durable)).toBe('conflict');
    expect((await recipes.findByIdAsync(recipe.id))?.stepsJson).toBe('["Later human step"]');
    await recipes.updateAsync(recipe.id, { stepsJson: revised });
    expect(await revertOrgEvaluationBodyAsync(durable)).toBe('reverted');
    expect((await recipes.findByIdAsync(recipe.id))?.stepsJson).toBe(original);
  });

  it('writes merged managed bytes, removes retired capability, and restores both exact originals', async () => {
    const skills = new AgentSkillsRepository();
    const a = skills.create({ title: 'smoke-evaluation-a', body: 'Keep the facts.', status: 'active' });
    const b = skills.create({ title: 'smoke-evaluation-b', body: 'List Actions.', status: 'active' });
    writeManagedSkill({ name: a.title, description: 'Original A', body: a.body! });
    writeManagedSkill({ name: b.title, description: 'Original B', body: b.body! });
    const bytesA = readManagedSkillBytes(a.title)!;
    const bytesB = readManagedSkillBytes(b.title)!;
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({ kind: 'consolidate-skill', targetRef: `skill:${a.id}`,
      title: '[smoke] Consolidation', risk: 'high', changeJson: JSON.stringify({ survivorSkillId: a.id,
        retiredSkillId: b.id, priorSurvivorBody: a.body, priorRetiredBody: b.body,
        revisedBody: 'Keep the facts.\n\n## Actions\nList Actions.' }) });
    expect(await validateProposalChange(proposal)).toEqual({ valid: true });
    const result = await applyApprovedProposalAsync({ proposal, decidedByUserId: 0, proposalsRepo,
      finalizePostApply: async () => null, measure: async () => 'skipped' });
    expect(result.kind).toBe('applied');
    expect(skills.getById(b.id)?.status).toBe('retired');
    expect(readManagedSkillBytes(a.title)?.toString()).toContain('## Actions');
    expect(readManagedSkillBytes(b.title)).toBeNull();
    const durable = (await proposalsRepo.findByIdAsync(proposal.id))!;
    expect(await revertOrgEvaluationBodyAsync(durable)).toBe('reverted');
    expect(readManagedSkillBytes(a.title)).toEqual(bytesA);
    expect(readManagedSkillBytes(b.title)).toEqual(bytesB);
    expect(skills.getById(a.id)?.body).toBe(a.body);
    expect(skills.getById(b.id)?.status).toBe('active');
  });

  it('refuses a source edited after candidate authoring without mutating either skill', async () => {
    const skills = new AgentSkillsRepository();
    const a = skills.create({ title: 'smoke-stale-a', body: 'Original A', status: 'active' });
    const b = skills.create({ title: 'smoke-stale-b', body: 'Original B', status: 'active' });
    const proposal = await new AgentOrgProposalsRepository().createAsync({ kind: 'consolidate-skill',
      targetRef: `skill:${a.id}`, title: '[smoke] Stale', risk: 'high', changeJson: JSON.stringify({
        survivorSkillId: a.id, retiredSkillId: b.id, priorSurvivorBody: a.body,
        priorRetiredBody: b.body, revisedBody: 'Tested merged body',
      }) });
    skills.update(b.id, { body: 'Later human edit' });
    expect((await validateProposalChange(proposal)).valid).toBe(false);
    expect(skills.getById(a.id)?.body).toBe(a.body);
    expect(skills.getById(b.id)?.body).toBe('Later human edit');
  });
});
