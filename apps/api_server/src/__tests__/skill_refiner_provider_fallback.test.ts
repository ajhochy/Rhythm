import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// USO B3 (#1030): the default judge/scorer/rewrite now route through
// AgentRunner.run() instead of a bare createSession/prompt pair.
//
// #1110 (cost-002): they no longer resolve a "reliable authed fallback model"
// themselves (the old #930-chain-derived modelOverride, up to N provider
// attempts per score call). They pass `taskKind` and let AgentRunner's own
// tiered routing (agent_model_resolver.resolveTieredModel) pick the cheapest
// AUTHED route — bounded to exactly ONE run() call, no cross-provider fan-out.
const { run } = vi.hoisted(() => ({ run: vi.fn() }));

vi.mock('../services/agent_runner', () => ({ run }));

import Database from 'better-sqlite3';
import {
  _setRefineRunning,
  getCuratorRefineStatus,
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

describe('skill_refiner default scorer (via AgentRunner, #1110 cheap tier)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('#1110 — routes through run() exactly ONCE, cheap taskKind, zero MCP/skill scope, NO modelOverride', async () => {
    run.mockResolvedValue({
      sessionId: 's1',
      result: '87 complete and actionable',
      status: 'done',
    });

    const result = await scoreSkillBody(
      { name: 'conventional commit', description: 'Write consistent commits' },
      '# Conventional commits\nUse type(scope): summary.',
    );

    expect(result.score).toBe(87);
    // #1110 — bounded to a SINGLE call (no more per-provider fan-out loop).
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0]).toMatchObject({
      sessionName: 'skill-measure-score',
      category: 'self_improvement',
      allowedMcpsJson: '{}',
      allowedSkillsJson: '[]',
      taskKind: 'triage',
    });
    expect(run.mock.calls[0][0].modelOverride).toBeUndefined();
    // The scorer parser consumed run().result (not resp.parts).
    expect(run.mock.calls[0][0].prompt).toContain('conventional commit');
  });

  it('a run() error → fail-closed score 0 (no retry across a second call)', async () => {
    run.mockResolvedValue({ sessionId: 's', result: '', status: 'error', error: 'down' });
    const result = await scoreSkillBody({ name: 'x' }, 'body');
    expect(result.score).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('an unparseable (non-numeric) response → fail-closed score 0 (no retry across a second call)', async () => {
    run.mockResolvedValue({ sessionId: 's', result: 'not a number', status: 'done' });
    const result = await scoreSkillBody({ name: 'x' }, 'body');
    expect(result.score).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('skill_refiner default rewrite (via AgentRunner, #1110 cheap tier)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('routes the rewrite through run() once, cheap taskKind, zero MCP/skill scope, NO modelOverride', async () => {
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
      allowedSkillsJson: '[]',
      taskKind: 'extraction',
    });
    expect(run.mock.calls[0][0].modelOverride).toBeUndefined();
  });

  it('a run() error degrades to the CURRENT body unchanged (fail-closed)', async () => {
    run.mockResolvedValue({ sessionId: 's', result: '', status: 'error', error: 'down' });
    const out = await rewriteSkillBody({ name: 'send-email' }, '# old body', 'too vague');
    expect(out).toBe('# old body');
  });
});

describe('skill_refiner default categorical judge (via AgentRunner, #1110 cheap tier)', () => {
  const REAL_VITEST = process.env.VITEST;
  const REAL_NODE = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetAllMocks();
    _setRefineRunning(false);
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
    _setRefineRunning(false);
    if (REAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = REAL_VITEST;
    if (REAL_NODE === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = REAL_NODE;
  });

  it('runs the default judge through run() once, cheap taskKind, zero MCP/skill scope, and consumes .result', async () => {
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
      allowedSkillsJson: '[]',
      taskKind: 'triage',
    });
    expect(run.mock.calls[0][0].modelOverride).toBeUndefined();
    // The judge parsed run().result ("better …") → 'better' → apply fired.
    expect(applyToEngine).toHaveBeenCalledTimes(1);
    expect(getCuratorRefineStatus().running).toBe(false);
  });

  it('clears refine running state when AgentRunner rejects', async () => {
    const repo = new AgentSkillsRepository();
    repo.create({
      title: 'Send the weekly staff email',
      description: 'old',
      confidence: 0.7,
    });
    run.mockRejectedValue(new Error('contract runner failure'));

    const result = await refineExistingSkill(
      {
        title: 'Send the weekly staff email',
        description: 'A clearer, more complete description',
        confidence: 0.8,
      },
      { repo },
    );

    expect(result).toBe('kept');
    expect(getCuratorRefineStatus().running).toBe(false);
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
