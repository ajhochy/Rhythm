/**
 * #929 Unit 3 — harvested_skill_evaluator tests.
 *
 * All three transitions (keep / rewrite-needed / disabled) are exercised with
 * an injected scorer (no real LLM) + injected repo (in-memory DB) + injected
 * dematerialize (no real filesystem/engine). The uses-threshold gate and the
 * "only 'draft' auto-extract rows are evaluated" guard are covered too.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  evaluateHarvestedSkillIfDue,
  EVAL_AFTER_USES,
} from '../services/harvested_skill_evaluator';
import type { ScoreCall } from '../services/skill_refiner';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function scorerReturning(score: number): ScoreCall {
  return async () => ({ score, reason: 'test scorer' });
}

describe('evaluateHarvestedSkillIfDue', () => {
  let repo: AgentSkillsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
  });

  function seedHarvestedDraft(uses = EVAL_AFTER_USES) {
    const created = repo.create({
      title: 'Harvested Skill',
      description: 'a harvested procedure',
      confidence: 0.7,
      status: 'draft',
      source: 'auto-extract',
    });
    for (let i = 0; i < uses; i++) repo.incrementUses(created.id);
    return repo.getById(created.id)!;
  }

  it('skips when uses is below the threshold', async () => {
    const skill = seedHarvestedDraft(EVAL_AFTER_USES - 1);
    const outcome = await evaluateHarvestedSkillIfDue(skill.id, {
      repo,
      scorer: scorerReturning(90),
    });
    expect(outcome).toBe('skipped');
    expect(repo.getById(skill.id)?.status).toBe('draft');
  });

  it('skips a non-auto-extract skill even at/above the threshold', async () => {
    const created = repo.create({
      title: 'Manual Skill',
      status: 'draft',
      source: 'manual',
    });
    for (let i = 0; i < EVAL_AFTER_USES; i++) repo.incrementUses(created.id);
    const outcome = await evaluateHarvestedSkillIfDue(created.id, {
      repo,
      scorer: scorerReturning(90),
    });
    expect(outcome).toBe('skipped');
  });

  it('skips a skill already evaluated (status no longer draft)', async () => {
    const skill = seedHarvestedDraft();
    repo.update(skill.id, { status: 'active' });
    const scorer = vi.fn(scorerReturning(90));
    const outcome = await evaluateHarvestedSkillIfDue(skill.id, { repo, scorer });
    expect(outcome).toBe('skipped');
    expect(scorer).not.toHaveBeenCalled();
  });

  it('KEEPS a skill scoring >= the confidence gate (60)', async () => {
    const skill = seedHarvestedDraft();
    const outcome = await evaluateHarvestedSkillIfDue(skill.id, {
      repo,
      scorer: scorerReturning(75),
    });
    expect(outcome).toBe('kept');
    const updated = repo.getById(skill.id)!;
    expect(updated.status).toBe('active');
    expect(updated.postScore).toBe(75);
    expect(updated.measureReason).toContain('keep');
  });

  it('marks REWRITE-NEEDED for a sound-idea/weak-execution score (40-59)', async () => {
    const skill = seedHarvestedDraft();
    const outcome = await evaluateHarvestedSkillIfDue(skill.id, {
      repo,
      scorer: scorerReturning(50),
    });
    expect(outcome).toBe('rewrite-needed');
    const updated = repo.getById(skill.id)!;
    expect(updated.status).toBe('rewrite-needed');
    expect(updated.postScore).toBe(50);
  });

  it('DISABLES a genuinely bad skill (score < 40) and dematerializes it', async () => {
    const skill = seedHarvestedDraft();
    const dematerialize = vi.fn().mockResolvedValue(undefined);
    const outcome = await evaluateHarvestedSkillIfDue(skill.id, {
      repo,
      scorer: scorerReturning(10),
      dematerialize,
    });
    expect(outcome).toBe('disabled');
    expect(dematerialize).toHaveBeenCalledTimes(1);
    const updated = repo.getById(skill.id)!;
    expect(updated.status).toBe('disabled');
    expect(updated.postScore).toBe(10);
  });

  it('a thrown scorer fails closed to disabled (never throws)', async () => {
    const skill = seedHarvestedDraft();
    const throwingScorer: ScoreCall = async () => {
      throw new Error('boom');
    };
    const dematerialize = vi.fn().mockResolvedValue(undefined);
    const outcome = await evaluateHarvestedSkillIfDue(skill.id, {
      repo,
      scorer: throwingScorer,
      dematerialize,
    });
    expect(outcome).toBe('disabled');
    expect(repo.getById(skill.id)?.status).toBe('disabled');
  });

  it('records the harvest outcome via the injectable recorder', async () => {
    const skill = seedHarvestedDraft();
    const recordOutcome = vi.fn().mockResolvedValue(undefined);
    await evaluateHarvestedSkillIfDue(skill.id, {
      repo,
      scorer: scorerReturning(75),
      recordOutcome,
    });
    expect(recordOutcome).toHaveBeenCalledWith('good');
  });
});
