/**
 * #929 Unit 4 — harvester_quality_signal tests.
 *
 * Verifies the trip conditions (3-bad-in-a-row OR 5-bad-of-last-10) against a
 * seeded agent_skills ledger (evaluated auto-extract rows), and that a
 * tripping sequence writes exactly ONE deduped `harvester-quality` proposal
 * (not one per bad harvest).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { recordHarvestOutcome } from '../services/harvester_quality_signal';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('recordHarvestOutcome', () => {
  let repo: AgentSkillsRepository;
  let proposalsRepo: AgentOrgProposalsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
    proposalsRepo = new AgentOrgProposalsRepository();
  });

  function seedEvaluated(status: 'active' | 'rewrite-needed' | 'disabled', n = 1) {
    for (let i = 0; i < n; i++) {
      repo.create({
        title: `Skill ${status} ${i}-${Math.random()}`,
        status,
        source: 'auto-extract',
      });
    }
  }

  it('does nothing below either trip threshold', async () => {
    seedEvaluated('disabled', 2); // 2-in-a-row, well under both thresholds
    await recordHarvestOutcome('bad', { repo, proposalsRepo });
    expect(await proposalsRepo.listProposedAsync()).toHaveLength(0);
  });

  it('trips on 3-bad-in-a-row', async () => {
    seedEvaluated('disabled', 3);
    await recordHarvestOutcome('bad', { repo, proposalsRepo });
    const proposals = await proposalsRepo.listProposedAsync();
    expect(proposals).toHaveLength(1);
    expect(proposals[0].kind).toBe('harvester-quality');
    expect(proposals[0].risk).toBe('high');
  });

  it('trips on 5-of-last-10 even without a 3-in-a-row streak', async () => {
    // Alternate good/bad so there's never a 3-streak, but 5 of the last 10 are bad.
    seedEvaluated('active', 1);
    seedEvaluated('disabled', 1);
    seedEvaluated('active', 1);
    seedEvaluated('rewrite-needed', 1);
    seedEvaluated('active', 1);
    seedEvaluated('disabled', 1);
    seedEvaluated('active', 1);
    seedEvaluated('rewrite-needed', 1);
    seedEvaluated('active', 1);
    seedEvaluated('disabled', 1); // 10 total, 5 bad, no 3-streak (newest-first alternation)
    await recordHarvestOutcome('bad', { repo, proposalsRepo });
    const proposals = await proposalsRepo.listProposedAsync();
    expect(proposals).toHaveLength(1);
  });

  it('does not spam — a second call the same day dedupes to the same proposal', async () => {
    seedEvaluated('disabled', 3);
    await recordHarvestOutcome('bad', { repo, proposalsRepo });
    await recordHarvestOutcome('bad', { repo, proposalsRepo });
    const proposals = await proposalsRepo.listProposedAsync();
    expect(proposals).toHaveLength(1);
  });

  it('ignores draft (not-yet-evaluated) rows in the ledger', async () => {
    seedEvaluated('active', 1);
    repo.create({ title: 'Still pending', status: 'draft', source: 'auto-extract' });
    await recordHarvestOutcome('good', { repo, proposalsRepo });
    expect(await proposalsRepo.listProposedAsync()).toHaveLength(0);
  });
});
