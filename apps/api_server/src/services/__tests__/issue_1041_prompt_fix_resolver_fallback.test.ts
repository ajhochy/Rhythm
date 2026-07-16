/**
 * Issue #1041 — workflow-prompt-fix applier can't resolve diagnosis refs that
 * use the PROFILE name instead of the skill title.
 *
 * Live evidence: proposal targetRef = `skill:worship-planning` (the PROFILE id),
 * but the actual skill is `monday-worship-planning`. The diagnosis/concreteFix
 * text names the real skill; only the structured ref is wrong.
 *
 * These assert:
 *  - fallback (a): profile-name targetRef resolves via a skill title mentioned
 *    in the diagnosis text, and applies into an EMPTY (body_len=0) skill.
 *  - fallback (b): profile-name targetRef resolves via the affected profile's
 *    allowed-skills list when exactly one live skill matches.
 *  - unresolvable-by-any-fallback → actionable refusal naming the ref +
 *    closest candidate titles.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentSkillsRepository } from '../../repositories/agent_skills_repository';
import {
  applyProposal,
  validateProposalChange,
  resetProposalPluginsForTests,
} from '../org_proposal_apply_service';
import { registerAllProposalAppliers } from '../org_proposal_appliers_wiring';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

beforeEach(() => {
  setDb(makeDb());
  registerAllProposalAppliers();
});

afterEach(() => {
  resetProposalPluginsForTests();
});

describe('#1041 workflow-prompt-fix resolver fallback', () => {
  it('fallback (a): profile-name ref resolves via diagnosis text and writes into an EMPTY body', async () => {
    // Profile named worship-planning; the real skill is monday-worship-planning.
    new AgentConfigsRepository().insert({
      id: 'worship-planning',
      label: 'Worship Planning',
      icon: 'music',
      allowedSkillsJson: JSON.stringify(['monday-worship-planning']),
    });
    const skillsRepo = new AgentSkillsRepository();
    const skill = skillsRepo.create({
      title: 'monday-worship-planning',
      body: '', // body_len = 0 — the exact state the proposal wants to fix
    });

    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'workflow-prompt-fix',
      risk: 'high',
      status: 'proposed',
      title: 'Fix empty monday-worship-planning skill',
      targetRef: 'skill:worship-planning', // PROFILE id, not skill id
      changeJson: JSON.stringify({
        affectedSkill: 'worship-planning',
        diagnosis: 'The monday-worship-planning skill has an empty body.',
        concreteFix: 'Step 1: pull the next Sunday plan from PCO.',
      }),
    });

    expect((await validateProposalChange(proposal)).valid).toBe(true);

    await applyProposal(proposal);

    const after = skillsRepo.getById(skill.id)!;
    expect(after.body).toContain('Step 1: pull the next Sunday plan from PCO.');
    expect(after.body!.length).toBeGreaterThan(0);
  });

  it('fallback (b): profile-name ref resolves via the profile allowed-skills list (single match)', async () => {
    new AgentConfigsRepository().insert({
      id: 'worship-planning',
      label: 'Worship Planning',
      icon: 'music',
      allowedSkillsJson: JSON.stringify(['monday-worship-planning']),
    });
    const skillsRepo = new AgentSkillsRepository();
    const skill = skillsRepo.create({ title: 'monday-worship-planning', body: 'existing body' });

    // Diagnosis text does NOT mention the skill title → forces fallback (b).
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'workflow-prompt-fix',
      risk: 'high',
      status: 'proposed',
      title: 'Fix skill',
      targetRef: 'skill:worship-planning',
      changeJson: JSON.stringify({
        affectedSkill: 'worship-planning',
        diagnosis: 'The skill misfires on some inputs.',
        concreteFix: 'Add a guard for the missing-plan case.',
      }),
    });

    expect((await validateProposalChange(proposal)).valid).toBe(true);

    await applyProposal(proposal);
    const after = skillsRepo.getById(skill.id)!;
    expect(after.body).toContain('Add a guard for the missing-plan case.');
  });

  it('unresolvable by any fallback → actionable refusal naming the ref + closest candidates', async () => {
    new AgentConfigsRepository().insert({
      id: 'worship-planning',
      label: 'Worship Planning',
      icon: 'music',
      // TWO allowed skills → ambiguous, fallback (b) refuses; both are the
      // "closest candidates" the refusal must name.
      allowedSkillsJson: JSON.stringify(['monday-worship-planning', 'sunday-service-prep']),
    });
    const skillsRepo = new AgentSkillsRepository();
    skillsRepo.create({ title: 'monday-worship-planning', body: 'a' });
    skillsRepo.create({ title: 'sunday-service-prep', body: 'b' });

    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'workflow-prompt-fix',
      risk: 'high',
      status: 'proposed',
      title: 'Fix skill',
      targetRef: 'skill:worship-planning',
      changeJson: JSON.stringify({
        affectedSkill: 'worship-planning',
        diagnosis: 'Ambiguous — no single skill named.',
        concreteFix: 'Do something.',
      }),
    });

    const result = await validateProposalChange(proposal);
    expect(result.valid).toBe(false);
    // Actionable: names the ref it looked for AND the closest candidate titles.
    expect(result.reason).toContain('skill:worship-planning');
    expect(result.reason).toContain('monday-worship-planning');
    expect(result.reason).toContain('sunday-service-prep');
  });
});
