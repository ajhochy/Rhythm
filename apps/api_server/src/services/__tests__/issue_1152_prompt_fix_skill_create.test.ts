/**
 * Issue #1152 — workflow-prompt-fix's missing-skill diagnosis (rootCause:
 * 'skill', no live skill resolves) must SCAFFOLD the intended skill instead
 * of dead-ending on the #1041 "could not resolve a live skill / re-point the
 * proposal" refusal. The discriminator is the EXPLICIT `rootCause==='skill'`
 * intent field the generator sets for this diagnosis — not a fuzzy near-miss
 * heuristic — so a genuine typo'd/misrouted ref (any other rootCause) must
 * keep refusing with the existing guidance and must NOT create a skill.
 *
 * These assert:
 *  - create-intent: no match + rootCause==='skill' → validates true, and
 *    approving scaffolds the managed SKILL.md, creates the sidecar DB row
 *    with the concreteFix as its body, and grants it on the target profile's
 *    allowedSkillsJson.
 *  - an existing-skill edit (the skill DOES resolve, even with rootCause:
 *    'skill' present) stays on the #1041 edit path — no duplicate skill row.
 *  - no match + rootCause !== 'skill' still refuses with the actionable
 *    "re-point the proposal" guidance and creates nothing.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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
import { managedSkillExists } from '../rhythm_managed_skills';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let managedDir: string;
let savedManagedDir: string | undefined;

beforeEach(() => {
  managedDir = mkdtempSync(join(tmpdir(), 'rhythm-1152-'));
  savedManagedDir = process.env.RHYTHM_MANAGED_SKILLS_DIR;
  process.env.RHYTHM_MANAGED_SKILLS_DIR = managedDir;
  setDb(makeDb());
  registerAllProposalAppliers();
});

afterEach(() => {
  resetProposalPluginsForTests();
  rmSync(managedDir, { recursive: true, force: true });
  if (savedManagedDir === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
  else process.env.RHYTHM_MANAGED_SKILLS_DIR = savedManagedDir;
});

describe('#1152 workflow-prompt-fix skill-create resolver', () => {
  it('create-intent (no match, rootCause=skill) validates, scaffolds the SKILL.md, and grants it', async () => {
    new AgentConfigsRepository().insert({
      id: 'creative-media',
      label: 'Creative Media',
      icon: 'camera',
      allowedSkillsJson: JSON.stringify([]),
    });
    const skillsRepo = new AgentSkillsRepository();
    expect(skillsRepo.findByTitle('creative-media')).toBeNull();

    const concreteFix = 'Add a render time budget guard: cap the render loop at 16ms and log overruns.';
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'workflow-prompt-fix',
      risk: 'high',
      status: 'proposed',
      title: 'Fix skill issue in creative-media',
      targetRef: 'skill:creative-media',
      changeJson: JSON.stringify({
        rootCause: 'skill',
        diagnosis: 'No skill exists for this workflow yet.',
        concreteFix,
      }),
    });

    const validated = await validateProposalChange(proposal);
    expect(validated.valid, validated.reason).toBe(true);

    const applyResult = await applyProposal(proposal);
    // D2.5 exclusion: missing-skill creation has skill/grant side effects that
    // its current snapshot cannot safely and completely roll back.
    expect(applyResult.postApplyTarget).toBeUndefined();

    const created = skillsRepo.findByTitle('creative-media');
    expect(created).not.toBeNull();
    expect(created!.body).toContain(concreteFix);

    const config = new AgentConfigsRepository().getById('creative-media')!;
    expect(JSON.parse(config.allowedSkillsJson ?? '[]')).toContain('creative-media');

    expect(managedSkillExists('creative-media')).toBe(true);
  });

  it('existing-skill edit path is unaffected by rootCause=skill — no duplicate row', async () => {
    new AgentConfigsRepository().insert({
      id: 'worship-planning',
      label: 'Worship Planning',
      icon: 'music',
      allowedSkillsJson: JSON.stringify(['monday-worship-planning']),
    });
    const skillsRepo = new AgentSkillsRepository();
    skillsRepo.create({ title: 'monday-worship-planning', body: 'existing body' });
    expect(skillsRepo.list()).toHaveLength(1);

    // rootCause: 'skill' present, but the skill DOES resolve via the #1041
    // profile-allowlist fallback — must stay on the edit path.
    const proposal = await new AgentOrgProposalsRepository().createAsync({
      kind: 'workflow-prompt-fix',
      risk: 'high',
      status: 'proposed',
      title: 'Fix skill',
      targetRef: 'skill:worship-planning',
      changeJson: JSON.stringify({
        rootCause: 'skill',
        diagnosis: 'The skill misfires on some inputs.',
        concreteFix: 'Add a guard for the missing-plan case.',
      }),
    });

    expect((await validateProposalChange(proposal)).valid).toBe(true);
    await applyProposal(proposal);

    expect(skillsRepo.list()).toHaveLength(1); // no new row
    const after = skillsRepo.findByTitle('monday-worship-planning')!;
    expect(after.body).toContain('Add a guard for the missing-plan case.');
  });

  it('no match + rootCause !== "skill" still refuses with re-point guidance and creates nothing', async () => {
    new AgentConfigsRepository().insert({
      id: 'worship-planning',
      label: 'Worship Planning',
      icon: 'music',
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
        rootCause: 'config', // NOT 'skill' — a real mis-routed/ambiguous edit diagnosis
        diagnosis: 'Ambiguous — no single skill named.',
        concreteFix: 'Do something.',
      }),
    });

    const result = await validateProposalChange(proposal);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('skill:worship-planning');
    expect(result.reason).toContain('Re-point the proposal');

    expect(managedSkillExists('worship-planning')).toBe(false);
    expect(skillsRepo.list()).toHaveLength(2); // no third skill created
  });
});
