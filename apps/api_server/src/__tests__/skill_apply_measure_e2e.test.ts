/**
 * #794 + #795 INTEGRATION — apply → measure → (keep | auto-revert), end-to-end.
 *
 * #794's applyToEngineSkill leaves the sidecar row at status='measuring'. #795's
 * measureAppliedSkill scores baseline vs. post and keeps or reverts. This suite
 * exercises the REAL applyAndMeasure chain that wires the two together so a row
 * never stays stuck 'measuring':
 *
 *   - improving revision (post > baseline) → row ends status='active'.
 *   - non-improving revision (post <= baseline) → row ends status='reverted',
 *     managed body rolled back byte-identical to the prior body.
 *   - startup crash recovery (recoverStuckMeasurements) reverts a row left
 *     'measuring' from a prior crash.
 *
 * Only the LLM scorer and the managed-dir file IO are faked (the operational
 * envelope). The apply logic, the sidecar measuring transition, the score
 * comparison, the rollback, and the status transitions are all REAL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { applyAndMeasure, type ApplyCandidate, type ApplyDeps } from '../services/skill_apply';
import {
  measureAppliedSkill,
  recoverStuckMeasurements,
} from '../services/skill_measurement';
import type { ScoreCall } from '../services/skill_refiner';
import type { AgentSkill } from '../models/agent_skill';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const MANAGED_ROOT = '/tmp/rhythm-managed-skills-e2e';
const MANAGED_LOC = `${MANAGED_ROOT}/Send_the_weekly_staff_email/SKILL.md`;

/** Deterministic scorer keyed by exact body string. */
const scorerFor = (byBody: Record<string, number>): ScoreCall => async (_p, body) => ({
  score: byBody[body] ?? 0,
  reason: `scored '${(body ?? '').slice(0, 16)}'`,
});

describe('apply → measure end-to-end (applyAndMeasure)', () => {
  let repo: AgentSkillsRepository;
  const REAL_VITEST = process.env.VITEST;
  const REAL_NODE = process.env.NODE_ENV;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
    process.env.RHYTHM_MANAGED_SKILLS_DIR = MANAGED_ROOT;
    // Lift the test guard so the REAL apply branch runs; injected write/reload/
    // reader + scorer doubles guarantee zero real FS / engine / LLM calls.
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (REAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = REAL_VITEST;
    if (REAL_NODE === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = REAL_NODE;
    delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    vi.restoreAllMocks();
  });

  const PRIOR_BODY = '# Send the weekly staff email\n\nOld vague body.\n';
  const REVISED_BODY = '# Send the weekly staff email\n\nRevised, clearer, complete body.\n';

  const candidate = (over: Partial<ApplyCandidate> = {}): ApplyCandidate => ({
    name: 'Send the weekly staff email',
    body: REVISED_BODY,
    description: 'A clearer description',
    confidence: 0.8,
    source: 'auto-refined',
    ...over,
  });

  /**
   * Apply deps that fake only IO; `measure` runs the REAL measureAppliedSkill so
   * the chain is exercised genuinely. The scorer and managed-dir write are the
   * only fakes (LLM + FS), matching the operational envelope.
   */
  function depsWithRealMeasure(
    scorer: ScoreCall,
    over: Partial<ApplyDeps & { measure: (s: AgentSkill) => Promise<unknown> }> = {},
  ): ApplyDeps & { measure: (s: AgentSkill) => Promise<unknown> } & {
    write: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  } {
    const writtenBodies: string[] = [];
    const write = vi.fn((s: { name: string; body: string }) => {
      writtenBodies.push(s.body);
      return `${MANAGED_ROOT}/${s.name.replace(/\s+/g, '_')}/SKILL.md`;
    });
    const remove = vi.fn(() => true);
    const reload = vi.fn(async () => []);
    const writeSkill = vi.fn(
      (name: string) => `${MANAGED_ROOT}/${name.replace(/\s+/g, '_')}/SKILL.md`,
    );
    const measure = (s: AgentSkill) =>
      measureAppliedSkill(s, { repo, scorer, reload, write, remove });
    return {
      repo,
      writeSkill,
      reloadSkills: reload,
      readOriginal: () => PRIOR_BODY,
      listSkills: async () => [{ name: candidate().name, location: MANAGED_LOC }],
      measure,
      write,
      remove,
      ...over,
    } as never;
  }

  it('improving revision (post > baseline) → row ends status=active (apply→measure ran)', async () => {
    const d = depsWithRealMeasure(
      scorerFor({ [PRIOR_BODY]: 40, [REVISED_BODY]: 78 }),
    );
    const outcome = await applyAndMeasure(candidate(), d);

    expect(outcome).toBe('applied-managed');
    const row = repo.findByName(candidate().name)!;
    // The PROOF: not stuck 'measuring' — the measure step kept it.
    expect(row.status).toBe('active');
    expect(row.baselineScore).toBe(40);
    expect(row.postScore).toBe(78);
    expect(row.body).toBe(REVISED_BODY); // revision stays live
  });

  it('non-improving revision (post <= baseline) → row ends status=reverted, body rolled back', async () => {
    const d = depsWithRealMeasure(
      scorerFor({ [PRIOR_BODY]: 70, [REVISED_BODY]: 55 }),
    );
    const outcome = await applyAndMeasure(candidate(), d);

    expect(outcome).toBe('applied-managed');
    const row = repo.findByName(candidate().name)!;
    expect(row.status).toBe('reverted');
    expect(row.baselineScore).toBe(70);
    expect(row.postScore).toBe(55);
    // managed rollback restored the prior body byte-identical.
    expect(row.body).toBe(PRIOR_BODY);
    // the live managed file was rewritten to the prior body.
    expect(d.write).toHaveBeenCalled();
    expect(d.write.mock.calls.at(-1)![0].body).toBe(PRIOR_BODY);
  });

  it('a non-applying outcome (no-target) is returned without measuring', async () => {
    const measure = vi.fn();
    const d = depsWithRealMeasure(scorerFor({}), {
      listSkills: async () => [{ name: 'unrelated', location: MANAGED_LOC }],
      measure: measure as never,
    });
    const outcome = await applyAndMeasure(candidate(), d);
    expect(outcome).toBe('no-target');
    expect(measure).not.toHaveBeenCalled();
    expect(repo.findByName(candidate().name)).toBeNull();
  });
});

describe('startup crash recovery reverts a stuck measuring row (recoverStuckMeasurements)', () => {
  const REAL_VITEST = process.env.VITEST;
  const REAL_NODE = process.env.NODE_ENV;

  afterEach(() => {
    if (REAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = REAL_VITEST;
    if (REAL_NODE === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = REAL_NODE;
  });

  it('a row left measuring from a prior crash is reverted at startup', async () => {
    setDb(makeDb());
    const repo = new AgentSkillsRepository();
    // Simulate a crash mid-loop: an applied managed revision left at 'measuring'.
    const created = repo.create({
      title: 'stuck-skill',
      body: 'BASE body',
      confidence: 0.7,
      status: 'active',
    });
    repo.reviseInPlace(created.id, { body: 'REVISED body' }, 'auto-applied');
    repo.update(created.id, {
      status: 'measuring',
      appliedForName: 'stuck-skill',
      baseVersion: 1,
      isExternal: 0,
    });
    expect(repo.getById(created.id)!.status).toBe('measuring');

    // Lift the VITEST guard so the real branch runs; injected IO → no side effects.
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';

    const reverted = await recoverStuckMeasurements({
      repo,
      reload: vi.fn().mockResolvedValue([]),
      write: vi.fn(),
      remove: vi.fn(),
    });

    expect(reverted).toBe(1);
    const after = repo.getById(created.id)!;
    expect(after.status).toBe('reverted');
    expect(after.body).toBe('BASE body'); // rolled back to base_version
  });
});
