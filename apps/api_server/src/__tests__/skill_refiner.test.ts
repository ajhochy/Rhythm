/**
 * P5-2 — skill_refiner tests (injected judge + injected repo, no real model).
 *
 * Covers the quality-bar decision + apply:
 *   - judge 'better' + confidence >= existing → reviseInPlace called, version bumped.
 *   - judge 'worse'/'equal' → existing unchanged (fail-closed).
 *   - judge throws → existing unchanged, no throw.
 *   - candidate confidence < existing → kept (judge not consulted).
 *   - no matching skill → 'no-match' (caller drafts new).
 *   - under VITEST with NO injected judge → 'skipped', zero writes.
 *   - parseJudgeResponse fail-closed parsing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  parseJudgeResponse,
  parseScoreResponse,
  scoreSkillBody,
  refineExistingSkill,
  isSameSkill,
  type JudgeResult,
  type RefineCandidate,
  type ScoreCall,
} from '../services/skill_refiner';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const better = (): JudgeResult => ({ verdict: 'better', reason: 'clearer steps' });
const worse = (): JudgeResult => ({ verdict: 'worse', reason: 'loses detail' });
const equal = (): JudgeResult => ({ verdict: 'equal', reason: 'no change' });

describe('skill_refiner.parseJudgeResponse (fail-closed)', () => {
  it('maps a leading "better" to better', () => {
    expect(parseJudgeResponse('better — more complete').verdict).toBe('better');
    expect(parseJudgeResponse('Better.').verdict).toBe('better');
  });
  it('maps a leading "worse" to worse', () => {
    expect(parseJudgeResponse('worse, drops a step').verdict).toBe('worse');
  });
  it('maps anything else (incl. "not better") to equal', () => {
    expect(parseJudgeResponse('not better than the original').verdict).toBe('equal');
    expect(parseJudgeResponse('equal').verdict).toBe('equal');
    expect(parseJudgeResponse('').verdict).toBe('equal');
    expect(parseJudgeResponse('the candidate is roughly the same').verdict).toBe('equal');
  });
});

describe('skill_refiner.parseScoreResponse (#795 purpose-anchored, fail-closed)', () => {
  it('parses a leading integer and clamps to 0..100', () => {
    expect(parseScoreResponse('72 solid coverage').score).toBe(72);
    expect(parseScoreResponse('120').score).toBe(100);
    expect(parseScoreResponse('-3').score).toBe(0);
  });
  it('unparseable → 0', () => {
    expect(parseScoreResponse('great skill!').score).toBe(0);
    expect(parseScoreResponse('').score).toBe(0);
  });
});

describe('skill_refiner.scoreSkillBody (#795 — compares body, never throws)', () => {
  it('passes the body to the scorer and returns its score', async () => {
    const scorer: ScoreCall = vi.fn(async (_purpose, body) => ({
      score: body === 'good body' ? 88 : 10,
      reason: 'ok',
    }));
    const purpose = { name: 'send-email', description: 'd', whenToUse: 'w' };
    expect((await scoreSkillBody(purpose, 'good body', scorer)).score).toBe(88);
    expect((await scoreSkillBody(purpose, 'bad body', scorer)).score).toBe(10);
    expect(scorer).toHaveBeenCalledTimes(2);
  });
  it('a thrown scorer is mapped to a fail-closed score of 0', async () => {
    const scorer: ScoreCall = async () => {
      throw new Error('boom');
    };
    const result = await scoreSkillBody({ name: 'x' }, 'body', scorer);
    expect(result.score).toBe(0);
  });
});

describe('skill_refiner.isSameSkill', () => {
  const exist = (title: string) =>
    ({ id: 'x', title, status: 'published', confidence: 0.5 } as never);
  it('matches identical titles', () => {
    expect(isSameSkill({ title: 'Send weekly email', confidence: 0.5 }, exist('Send weekly email'))).toBe(true);
  });
  it('matches substring titles', () => {
    expect(isSameSkill({ title: 'Send the weekly email now', confidence: 0.5 }, exist('weekly email'))).toBe(true);
  });
  it('rejects unrelated titles', () => {
    expect(isSameSkill({ title: 'Book a facility room', confidence: 0.5 }, exist('Send weekly email'))).toBe(false);
  });
});

describe('skill_refiner.refineExistingSkill', () => {
  let repo: AgentSkillsRepository;
  const REAL_VITEST = process.env.VITEST;
  const REAL_NODE = process.env.NODE_ENV;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
    // Lift the test guard so the real branch logic runs; the INJECTED judge
    // guarantees no model is hit. Restored in afterEach.
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (REAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = REAL_VITEST;
    if (REAL_NODE === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = REAL_NODE;
  });

  const candidate = (over: Partial<RefineCandidate> = {}): RefineCandidate => ({
    title: 'Send the weekly staff email',
    description: 'A clearer, more complete description',
    confidence: 0.8,
    ...over,
  });

  it('judge "better" + confidence >= existing → reviseInPlace, version bumped', async () => {
    const existing = repo.create({
      title: 'Send the weekly staff email',
      description: 'old',
      confidence: 0.7,
      status: 'published',
    });

    const result = await refineExistingSkill(candidate(), { repo, judge: async () => better() });
    expect(result).toBe('revised');

    const after = repo.getById(existing.id)!;
    expect(after.version).toBe(2);
    expect(after.description).toBe('A clearer, more complete description');
    expect(after.confidence).toBe(0.8);
    expect(after.source).toBe('auto-refined');
    expect(repo.listVersions(existing.id)).toHaveLength(1);
  });

  it('teacher-refined source override is honored', async () => {
    const existing = repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    await refineExistingSkill(candidate(), { repo, judge: async () => better(), source: 'teacher-refined' });
    expect(repo.getById(existing.id)!.source).toBe('teacher-refined');
  });

  it('judge "worse" → existing unchanged', async () => {
    const existing = repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const result = await refineExistingSkill(candidate(), { repo, judge: async () => worse() });
    expect(result).toBe('kept');
    const after = repo.getById(existing.id)!;
    expect(after.version).toBe(1);
    expect(after.description).toBe('old');
    expect(repo.listVersions(existing.id)).toHaveLength(0);
  });

  it('judge "equal" → existing unchanged', async () => {
    const existing = repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const result = await refineExistingSkill(candidate(), { repo, judge: async () => equal() });
    expect(result).toBe('kept');
    expect(repo.getById(existing.id)!.version).toBe(1);
  });

  it('judge throws → existing unchanged, no throw', async () => {
    const existing = repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const result = await refineExistingSkill(candidate(), {
      repo,
      judge: async () => {
        throw new Error('boom');
      },
    });
    expect(result).toBe('kept');
    expect(repo.getById(existing.id)!.version).toBe(1);
  });

  it('candidate confidence < existing → kept WITHOUT consulting judge', async () => {
    const existing = repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.9 });
    const judge = vi.fn(async () => better());
    const result = await refineExistingSkill(candidate({ confidence: 0.5 }), { repo, judge });
    expect(result).toBe('kept');
    expect(judge).not.toHaveBeenCalled();
    expect(repo.getById(existing.id)!.version).toBe(1);
  });

  it('no matching skill → no-match (caller drafts new)', async () => {
    repo.create({ title: 'Completely different thing about facilities', confidence: 0.7 });
    const result = await refineExistingSkill(
      candidate({ title: 'Send the weekly staff email' }),
      { repo, judge: async () => better(), getRelevant: () => [] },
    );
    expect(result).toBe('no-match');
  });

  it('matches by title even when getRelevant returns nothing', async () => {
    const existing = repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const result = await refineExistingSkill(candidate(), {
      repo,
      judge: async () => better(),
      getRelevant: () => [], // title match should still win
    });
    expect(result).toBe('revised');
    expect(repo.getById(existing.id)!.version).toBe(2);
  });
});

describe('skill_refiner.refineExistingSkill — test/postgres guards', () => {
  it('under VITEST with NO injected judge → skipped, zero writes', async () => {
    // VITEST is set by the runner; do NOT inject a judge → hard skip.
    setDb(makeDb());
    const repo = new AgentSkillsRepository();
    const existing = repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const result = await refineExistingSkill(
      { title: 'Send the weekly staff email', description: 'new', confidence: 0.9 },
      { repo },
    );
    expect(result).toBe('skipped');
    const after = repo.getById(existing.id)!;
    expect(after.version).toBe(1);
    expect(after.description).toBe('old');
    expect(repo.listVersions(existing.id)).toHaveLength(0);
  });
});
