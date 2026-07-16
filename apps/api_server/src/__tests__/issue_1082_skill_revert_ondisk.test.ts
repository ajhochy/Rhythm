/**
 * CONTRACT TEST for issue #1082 — org-optimizer skill revert must NOT restore a
 * stale DB body over a user's on-disk edit.
 *
 * The managed SKILL.md FILE is the source of truth for a skill body. A direct
 * edit via PUT /opencode/skills/:name (writeManagedSkill) updates the file but
 * NOT agent_skills.body. `applySkillBodyRevision` used to snapshot priorBody
 * from the (now stale) DB row, so an apply -> measure -> revert restored the
 * stale DB body OVER the user's on-disk edit (data loss).
 *
 * This test drives the real refine-skill applier + revertProposal against a
 * skill whose on-disk file has diverged from its DB row, and asserts the
 * revert restores the ON-DISK bytes, not the stale DB body.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  applyProposal,
  registerProposalApplier,
  registerProposalValidator,
  resetProposalPluginsForTests,
} from '../services/org_proposal_apply_service';
import { revertProposal } from '../services/org_proposal_apply';
import {
  writeManagedSkill,
  readManagedSkillBody,
} from '../services/rhythm_managed_skills';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

let managedDir: string;
let savedManagedDir: string | undefined;

beforeEach(async () => {
  managedDir = mkdtempSync(join(tmpdir(), 'rhythm-1082-'));
  savedManagedDir = process.env.RHYTHM_MANAGED_SKILLS_DIR;
  process.env.RHYTHM_MANAGED_SKILLS_DIR = managedDir;
  setDb(makeDb());
  resetProposalPluginsForTests();
  const { registerAllProposalAppliers } = await import(
    '../services/org_proposal_appliers_wiring'
  );
  registerAllProposalAppliers({ registerProposalApplier, registerProposalValidator });
});

afterEach(() => {
  rmSync(managedDir, { recursive: true, force: true });
  if (savedManagedDir === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
  else process.env.RHYTHM_MANAGED_SKILLS_DIR = savedManagedDir;
});

describe('#1082: revert restores the ON-DISK body, not the stale DB body', () => {
  it('snapshots the on-disk body at apply time and restores it on revert', async () => {
    const skillTitle = 'example-skill';
    const dbBody = 'ORIGINAL body persisted in agent_skills.body';
    const onDiskBody = 'USER EDITED body on disk (never written back to the DB row)';

    // A managed skill whose DB row body is now STALE relative to the file:
    // the DB has the original body, but the user edited the file directly.
    const skillsRepo = new AgentSkillsRepository();
    const skill = skillsRepo.create({
      title: skillTitle,
      body: dbBody,
      status: 'active',
    });
    // Direct on-disk edit — mirrors PUT /opencode/skills/:name (writeManagedSkill),
    // which does NOT touch agent_skills.body.
    writeManagedSkill({ name: skillTitle, body: onDiskBody });
    const onDiskBytes = readFileSync(join(managedDir, skillTitle, 'SKILL.md'));
    expect(readManagedSkillBody(skillTitle)).toBe(onDiskBody);

    // Refine-skill proposal targeting this skill by id.
    const proposalsRepo = new AgentOrgProposalsRepository();
    const proposal = await proposalsRepo.createAsync({
      kind: 'refine-skill',
      risk: 'low',
      title: 'Revise the example skill body',
      targetRef: `skill:${skill.id}`,
      changeJson: JSON.stringify({
        skillName: skillTitle,
        priorBody: dbBody,
        revisedBody: 'a candidate revision that will lose the measure and revert',
      }),
      dedupKey: `refine-skill:${skill.id}`,
    });

    // Apply: the beforeSnapshotJson MUST carry the on-disk body, not the DB body.
    const result = await applyProposal(proposal);
    expect(result.measurable).toBe(true);
    const snapshot = JSON.parse(result.beforeSnapshotJson!);
    expect(snapshot.priorBody).toBe(onDiskBody);
    expect(snapshot.priorBody).not.toBe(dbBody);
    expect(snapshot.priorDbBody).toBe(dbBody);
    expect(snapshot.managedFileWasPresent).toBe(true);
    expect(Buffer.from(snapshot.managedFileBytesBase64, 'base64')).toEqual(onDiskBytes);

    // Drive the real approve-flow persistence, then revert from the snapshot.
    await proposalsRepo.updateStatusAsync(proposal.id, 'applied', {
      beforeSnapshotJson: result.beforeSnapshotJson,
      changeJson: result.changeJson,
    });
    const measuring = await proposalsRepo.updateStatusAsync(proposal.id, 'measuring');
    const outcome = await revertProposal(measuring!);
    expect(outcome).toBe('reverted');

    // The user's on-disk edit is preserved — NOT clobbered by the stale DB body.
    expect(readManagedSkillBody(skillTitle)).toBe(onDiskBody);
    // The semantic DB state is restored independently from the file source.
    expect(skillsRepo.getById(skill.id)?.body).toBe(dbBody);
  });
});
