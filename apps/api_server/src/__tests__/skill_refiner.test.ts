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
  refineExistingSkill,
  isSameSkill,
  type JudgeResult,
  type RefineCandidate,
} from '../services/skill_refiner';
import type { ApplyCandidate, ApplyOutcome } from '../services/skill_apply';

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

  // #794 — the apply step is now over the LIVE engine skill set, not the DB row.
  // Inject a double so the refiner's decision logic is tested without a real
  // SKILL.md write or engine call. The default outcome reports a managed apply.
  const applied = (outcome: ApplyOutcome = 'applied-managed') =>
    vi.fn(async (_candidate: ApplyCandidate): Promise<ApplyOutcome> => outcome);

  it('judge "better" + confidence >= existing → delegates apply, returns revised', async () => {
    repo.create({
      title: 'Send the weekly staff email',
      description: 'old',
      confidence: 0.7,
      status: 'published',
    });

    const applyToEngine = applied();
    const result = await refineExistingSkill(candidate(), {
      repo,
      judge: async () => better(),
      applyToEngine,
    });
    expect(result).toBe('revised');
    // The apply step is handed the matched engine skill `name` (the title) +
    // candidate confidence/source — NOT a DB-row id.
    expect(applyToEngine).toHaveBeenCalledTimes(1);
    expect(applyToEngine.mock.calls[0][0]).toMatchObject({
      name: 'Send the weekly staff email',
      confidence: 0.8,
      source: 'auto-refined',
    });
    expect(applyToEngine.mock.calls[0][0].body).toContain('Send the weekly staff email');
  });

  it('external fork-to-shadow apply outcome also maps to revised', async () => {
    repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const result = await refineExistingSkill(candidate(), {
      repo,
      judge: async () => better(),
      applyToEngine: applied('applied-external-fork'),
    });
    expect(result).toBe('revised');
  });

  it('teacher-refined source override is forwarded to the apply step', async () => {
    repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const applyToEngine = applied();
    await refineExistingSkill(candidate(), {
      repo,
      judge: async () => better(),
      source: 'teacher-refined',
      applyToEngine,
    });
    expect(applyToEngine.mock.calls[0][0].source).toBe('teacher-refined');
  });

  it('apply outcome "no-target" → kept (live set lacks the name)', async () => {
    repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const result = await refineExistingSkill(candidate(), {
      repo,
      judge: async () => better(),
      applyToEngine: applied('no-target'),
    });
    expect(result).toBe('kept');
  });

  it('judge "worse" → existing unchanged, apply never called', async () => {
    repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const applyToEngine = applied();
    const result = await refineExistingSkill(candidate(), {
      repo,
      judge: async () => worse(),
      applyToEngine,
    });
    expect(result).toBe('kept');
    expect(applyToEngine).not.toHaveBeenCalled();
  });

  it('judge "equal" → existing unchanged, apply never called', async () => {
    repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const applyToEngine = applied();
    const result = await refineExistingSkill(candidate(), {
      repo,
      judge: async () => equal(),
      applyToEngine,
    });
    expect(result).toBe('kept');
    expect(applyToEngine).not.toHaveBeenCalled();
  });

  it('judge throws → existing unchanged, no throw, apply never called', async () => {
    repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const applyToEngine = applied();
    const result = await refineExistingSkill(candidate(), {
      repo,
      judge: async () => {
        throw new Error('boom');
      },
      applyToEngine,
    });
    expect(result).toBe('kept');
    expect(applyToEngine).not.toHaveBeenCalled();
  });

  it('candidate confidence < existing → kept WITHOUT consulting judge or apply', async () => {
    repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.9 });
    const judge = vi.fn(async () => better());
    const applyToEngine = applied();
    const result = await refineExistingSkill(candidate({ confidence: 0.5 }), {
      repo,
      judge,
      applyToEngine,
    });
    expect(result).toBe('kept');
    expect(judge).not.toHaveBeenCalled();
    expect(applyToEngine).not.toHaveBeenCalled();
  });

  it('no matching skill → no-match (caller drafts new), apply never called', async () => {
    repo.create({ title: 'Completely different thing about facilities', confidence: 0.7 });
    const applyToEngine = applied();
    const result = await refineExistingSkill(
      candidate({ title: 'Send the weekly staff email' }),
      { repo, judge: async () => better(), getRelevant: () => [], applyToEngine },
    );
    expect(result).toBe('no-match');
    expect(applyToEngine).not.toHaveBeenCalled();
  });

  it('matches by title even when getRelevant returns nothing → delegates apply', async () => {
    repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    const applyToEngine = applied();
    const result = await refineExistingSkill(candidate(), {
      repo,
      judge: async () => better(),
      getRelevant: () => [], // title match should still win
      applyToEngine,
    });
    expect(result).toBe('revised');
    expect(applyToEngine).toHaveBeenCalledTimes(1);
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
