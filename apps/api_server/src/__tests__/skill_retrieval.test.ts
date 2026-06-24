/**
 * Unit tests for the skill retrieval scorer (P3-1).
 *
 * Mirrors Odysseus `get_relevant_skills` semantics:
 *   - Jaccard over title/description/whenToUse/tags/steps
 *   - whole-token tag boost
 *   - description-substring boost
 *   - confidence + usage multipliers
 *   - threshold 0.3, top-N cap
 *   - published always eligible; draft eligible only at confidence >= 0.6 (fail-closed)
 *
 * Uses an in-memory migrated SQLite DB + the real AgentSkillsRepository so the
 * scorer is exercised over the same row shape it sees in production.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  getRelevantSkills,
  scoreSkill,
  isEligible,
} from '../services/skill_retrieval';
import type { AgentSkill } from '../models/agent_skill';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('skill_retrieval.getRelevantSkills', () => {
  let repo: AgentSkillsRepository;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
  });

  it('returns a title/description match above threshold, ranked first', () => {
    repo.create({
      title: 'Send the weekly staff email',
      description: 'Compose and send the weekly staff update email',
      status: 'published',
      confidence: 0.8,
    });
    repo.create({
      title: 'Reserve a facility room',
      description: 'Book a room for an event',
      status: 'published',
      confidence: 0.8,
    });

    const results = getRelevantSkills('send the weekly staff email', 5, repo);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toBe('Send the weekly staff email');
  });

  it('excludes skills with no token overlap (score < 0.3)', () => {
    repo.create({
      title: 'Reserve a facility room',
      description: 'Book a room for an event',
      status: 'published',
      confidence: 0.8,
    });

    const results = getRelevantSkills('quantum chromodynamics lecture notes', 5, repo);
    expect(results).toEqual([]);
  });

  it('excludes a low-confidence draft even with high text overlap (fail-closed gate)', () => {
    repo.create({
      title: 'Send the weekly staff email',
      description: 'Compose and send the weekly staff update email',
      status: 'draft',
      confidence: 0.4, // below 0.6 gate
    });

    const results = getRelevantSkills('send the weekly staff email', 5, repo);
    expect(results).toEqual([]);
  });

  it('includes a draft at confidence >= 0.6', () => {
    repo.create({
      title: 'Send the weekly staff email',
      description: 'Compose and send the weekly staff update email',
      status: 'draft',
      confidence: 0.7,
    });

    const results = getRelevantSkills('send the weekly staff email', 5, repo);
    expect(results.map((s) => s.title)).toContain('Send the weekly staff email');
  });

  it('keeps a published skill eligible even with low confidence (gate is draft-only)', () => {
    repo.create({
      title: 'Send the weekly staff email',
      description: 'Compose and send the weekly staff update email',
      status: 'published',
      confidence: 0.1, // below the draft gate, but published is always eligible
    });

    const results = getRelevantSkills('send the weekly staff email', 5, repo);
    expect(results.map((s) => s.title)).toContain('Send the weekly staff email');
  });

  it('boosts a skill whose tag is a whole token in the query', () => {
    repo.create({
      title: 'Fetch records',
      description: 'Pull records from an external system',
      tags: ['api'],
      status: 'published',
      confidence: 0.8,
    });

    const results = getRelevantSkills('how do I call the api', 5, repo);
    expect(results.map((s) => s.title)).toContain('Fetch records');
  });

  it('ranks the more-used skill first when two skills are otherwise equal', () => {
    repo.create({
      title: 'Send the weekly staff email',
      description: 'Compose and send the weekly staff update email',
      status: 'published',
      confidence: 0.8,
      uses: 0,
    });
    const used = repo.create({
      title: 'Send the weekly staff email',
      description: 'Compose and send the weekly staff update email',
      status: 'published',
      confidence: 0.8,
      uses: 0,
    });
    // bump uses on one of them
    for (let i = 0; i < 12; i++) repo.incrementUses(used.id);

    const results = getRelevantSkills('send the weekly staff email', 5, repo);
    expect(results.length).toBe(2);
    expect(results[0].id).toBe(used.id);
    expect(results[0].uses).toBe(12);
  });

  it('caps results at topN (default 5; explicit 3)', () => {
    for (let i = 0; i < 8; i++) {
      repo.create({
        title: `Send the weekly staff email ${i}`,
        description: 'Compose and send the weekly staff update email',
        status: 'published',
        confidence: 0.8,
      });
    }

    const def = getRelevantSkills('send the weekly staff email', undefined, repo);
    expect(def.length).toBeLessThanOrEqual(5);
    expect(def.length).toBe(5);

    const three = getRelevantSkills('send the weekly staff email', 3, repo);
    expect(three.length).toBe(3);
  });

  it('returns [] on an empty store', () => {
    expect(getRelevantSkills('anything at all', 5, repo)).toEqual([]);
  });

  it('returns [] for an empty / whitespace-only query', () => {
    repo.create({
      title: 'Send the weekly staff email',
      description: 'Compose and send the weekly staff update email',
      status: 'published',
      confidence: 0.8,
    });
    expect(getRelevantSkills('', 5, repo)).toEqual([]);
    expect(getRelevantSkills('    ', 5, repo)).toEqual([]);
  });
});

describe('skill_retrieval.isEligible', () => {
  function skill(partial: Partial<AgentSkill>): AgentSkill {
    return {
      id: 'x',
      title: 't',
      whenToUse: null,
      description: null,
      steps: null,
      tags: null,
      stepsJson: null,
      tagsJson: null,
      confidence: 0,
      status: 'published',
      source: null,
      uses: 0,
      createdAt: '',
      updatedAt: '',
      ...partial,
    };
  }

  it('published is always eligible regardless of confidence', () => {
    expect(isEligible(skill({ status: 'published', confidence: 0 }))).toBe(true);
  });

  it('draft is eligible at confidence >= 0.6, excluded below', () => {
    expect(isEligible(skill({ status: 'draft', confidence: 0.6 }))).toBe(true);
    expect(isEligible(skill({ status: 'draft', confidence: 0.59 }))).toBe(false);
  });

  it('draft with NaN/missing confidence fails closed', () => {
    expect(isEligible(skill({ status: 'draft', confidence: NaN }))).toBe(false);
    // simulate a missing confidence column value
    expect(
      isEligible(skill({ status: 'draft', confidence: undefined as unknown as number })),
    ).toBe(false);
  });

  it('any other status is excluded', () => {
    expect(isEligible(skill({ status: 'archived', confidence: 1 }))).toBe(false);
  });
});

describe('skill_retrieval.scoreSkill', () => {
  function skill(partial: Partial<AgentSkill>): AgentSkill {
    return {
      id: 'x',
      title: 't',
      whenToUse: null,
      description: null,
      steps: null,
      tags: null,
      stepsJson: null,
      tagsJson: null,
      confidence: 0.5,
      status: 'published',
      source: null,
      uses: 0,
      createdAt: '',
      updatedAt: '',
      ...partial,
    };
  }

  it('description substring drives score to at least the 0.6 floor (after multipliers)', () => {
    const s = scoreSkill(
      'send the weekly staff email',
      skill({
        description: 'instructions: send the weekly staff email to all staff',
        confidence: 0.5,
      }),
    );
    // 0.6 * (1 + 0.5*0.1) = 0.63
    expect(s).toBeGreaterThanOrEqual(0.6);
  });

  it('usage multiplier raises score by ~5%', () => {
    const base = skill({ description: 'x', tags: ['api'], confidence: 0.5, uses: 0 });
    const used = skill({ description: 'x', tags: ['api'], confidence: 0.5, uses: 3 });
    const sBase = scoreSkill('use the api', base);
    const sUsed = scoreSkill('use the api', used);
    expect(sUsed).toBeGreaterThan(sBase);
    expect(sUsed).toBeCloseTo(sBase * 1.05, 6);
  });
});
