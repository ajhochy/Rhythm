import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// USO B3 (#1030): the default judge/scorer/rewrite now route through
// AgentRunner.run() instead of a bare createSession/prompt pair. Model
// resolution still calls opencode_engine.listAuthedProviders, so both modules
// are mocked: opencode_engine supplies the authed-provider list that drives the
// #930 fallback chain, and agent_runner.run stands in for the observable
// self_improvement session.
const { listAuthedProviders } = vi.hoisted(() => ({
  listAuthedProviders: vi.fn(),
}));
const { run } = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { listAuthedProviders },
}));
vi.mock('../services/agent_runner', () => ({ run }));

import Database from 'better-sqlite3';
import {
  scoreSkillBody,
  rewriteSkillBody,
  parseJudgeResponse,
  refineExistingSkill,
  parseScoreResponse as _parseScoreResponse,
} from '../services/skill_refiner';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { ApplyCandidate, ApplyOutcome } from '../services/skill_apply';

describe('skill_refiner default scorer provider fallback (via AgentRunner)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    listAuthedProviders.mockResolvedValue(['anthropic', 'google']);
    // First provider (anthropic) returns a non-numeric error result → the loop
    // must fall through to the next reliable provider (google), which scores.
    run
      .mockResolvedValueOnce({ sessionId: 's1', result: '', status: 'error', error: 'boom' })
      .mockResolvedValueOnce({
        sessionId: 's2',
        result: '87 complete and actionable',
        status: 'done',
      });
  });

  it('routes each retry provider through run() as a self_improvement session with the exact modelOverride', async () => {
    const result = await scoreSkillBody(
      { name: 'conventional commit', description: 'Write consistent commits' },
      '# Conventional commits\nUse type(scope): summary.',
    );

    expect(result.score).toBe(87);
    // #930 fallback preserved: run() called once per provider, in order.
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][0]).toMatchObject({
      sessionName: 'skill-measure-score',
      category: 'self_improvement',
      modelOverride: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' },
      allowedMcpsJson: '{}',
    });
    expect(run.mock.calls[1][0]).toMatchObject({
      sessionName: 'skill-measure-score',
      category: 'self_improvement',
      modelOverride: { providerID: 'google', modelID: 'gemini-2.5-pro' },
      allowedMcpsJson: '{}',
    });
    // The scorer parser consumed run().result (not resp.parts).
    expect(run.mock.calls[1][0].prompt).toContain('conventional commit');
  });

  it('all providers erroring → fail-closed score 0 (aggregate of failures)', async () => {
    vi.resetAllMocks();
    listAuthedProviders.mockResolvedValue(['anthropic']);
    run.mockResolvedValue({ sessionId: 's', result: '', status: 'error', error: 'down' });
    const result = await scoreSkillBody({ name: 'x' }, 'body');
    expect(result.score).toBe(0);
    expect(result.reason).toContain('all reliable scorer routes failed');
  });
});

describe('skill_refiner default rewrite (via AgentRunner)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    listAuthedProviders.mockResolvedValue(['anthropic']);
  });

  it('routes the rewrite through run() as a self_improvement session and returns run().result', async () => {
    run.mockResolvedValue({
      sessionId: 's',
      result: '# Improved body\nStep 1.',
      status: 'done',
    });
    const out = await rewriteSkillBody(
      { name: 'send-email' },
      '# old body',
      'too vague',
    );
    expect(out).toBe('# Improved body\nStep 1.');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({
      sessionName: 'skill-refine-rewrite',
      category: 'self_improvement',
      allowedMcpsJson: '{}',
    });
  });

  it('a run() error degrades to the CURRENT body unchanged (fail-closed)', async () => {
    run.mockResolvedValue({ sessionId: 's', result: '', status: 'error', error: 'down' });
    const out = await rewriteSkillBody({ name: 'send-email' }, '# old body', 'too vague');
    expect(out).toBe('# old body');
  });
});

describe('skill_refiner default categorical judge (via AgentRunner)', () => {
  const REAL_VITEST = process.env.VITEST;
  const REAL_NODE = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetAllMocks();
    listAuthedProviders.mockResolvedValue(['anthropic']);
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    // Lift the test guard so refineExistingSkill runs its REAL default judge
    // (defaultJudge → run()); the mocked run() guarantees no model is hit.
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (REAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = REAL_VITEST;
    if (REAL_NODE === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = REAL_NODE;
  });

  it('runs the default judge through run() as a self_improvement session and consumes .result', async () => {
    const repo = new AgentSkillsRepository();
    repo.create({ title: 'Send the weekly staff email', description: 'old', confidence: 0.7 });
    run.mockResolvedValue({
      sessionId: 's',
      result: 'better — clearer and more complete',
      status: 'done',
    });
    const applyToEngine = vi.fn(
      async (_c: ApplyCandidate): Promise<ApplyOutcome> => 'applied-managed',
    );

    const result = await refineExistingSkill(
      {
        title: 'Send the weekly staff email',
        description: 'A clearer, more complete description',
        confidence: 0.8,
      },
      { repo, applyToEngine },
    );

    expect(result).toBe('revised');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({
      sessionName: 'skill-refine-judge',
      category: 'self_improvement',
      allowedMcpsJson: '{}',
    });
    // The judge parsed run().result ("better …") → 'better' → apply fired.
    expect(applyToEngine).toHaveBeenCalledTimes(1);
  });
});

// Parser contracts still hold on run().result strings (the leading-number
// scorer + fail-closed judge are unchanged by the AgentRunner routing).
describe('skill_refiner parsers consume run().result unchanged', () => {
  it('scorer parses a leading integer from a run result string', () => {
    expect(_parseScoreResponse('87 complete and actionable').score).toBe(87);
  });
  it('judge stays fail-closed on a non-"better" run result string', () => {
    expect(parseJudgeResponse('equal — no change').verdict).toBe('equal');
    expect(parseJudgeResponse('better — clearer').verdict).toBe('better');
  });
});
