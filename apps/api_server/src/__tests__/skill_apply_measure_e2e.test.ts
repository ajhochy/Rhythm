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
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  applyAndMeasure,
  applyToEngineSkill,
  type ApplyCandidate,
  type ApplyDeps,
} from '../services/skill_apply';
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

describe('#798 filesystem safety guards', () => {
  const REAL_VITEST = process.env.VITEST;
  const REAL_NODE = process.env.NODE_ENV;
  let root: string;
  let managedRoot: string;
  let repo: AgentSkillsRepository;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rhythm-skill-798-'));
    managedRoot = join(root, 'managed');
    mkdirSync(managedRoot, { recursive: true });
    process.env.RHYTHM_MANAGED_SKILLS_DIR = managedRoot;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
    setDb(makeDb());
    repo = new AgentSkillsRepository();
  });

  afterEach(() => {
    if (REAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = REAL_VITEST;
    if (REAL_NODE === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = REAL_NODE;
    delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('issue-798-c2: managed auto-revert restores the prior SKILL.md byte-identically', async () => {
    const name = 'managed-byte-identity';
    const location = join(managedRoot, name, 'SKILL.md');
    mkdirSync(join(managedRoot, name), { recursive: true });
    const before = Buffer.from(
      '---\nname: managed-byte-identity\ndescription: "Original: exact formatting"\n---\n\n# Original\n\nKeep trailing spaces.  \n',
      'utf8',
    );
    writeFileSync(location, before);

    const outcome = await applyAndMeasure(
      {
        name,
        body: '# Revised\n\nThis should lose.\n',
        description: 'Revised',
        confidence: 0.9,
        source: 'auto-refined',
      },
      {
        repo,
        listSkills: async () => [{ name, location }],
        reloadSkills: vi.fn().mockResolvedValue([]),
        measure: (skill) =>
          measureAppliedSkill(skill, {
            repo,
            scorer: scorerFor({
              [before.toString('utf8')]: 90,
              '# Revised\n\nThis should lose.\n': 10,
            }),
            reload: vi.fn().mockResolvedValue([]),
          }),
      },
    );

    expect(outcome).toBe('applied-managed');
    expect(repo.findByName(name)?.status).toBe('reverted');
    expect(readFileSync(location)).toEqual(before);
  });

  it('issue-798-c3: an external skill is unchanged and restored live after shadow revert', async () => {
    const name = 'external-byte-identity';
    const externalLocation = join(root, 'external', 'SKILL.md');
    mkdirSync(join(root, 'external'), { recursive: true });
    const before = Buffer.from(
      '---\nname: external-byte-identity\ndescription: External original\n---\n\n# External original\n',
      'utf8',
    );
    writeFileSync(externalLocation, before);

    const outcome = await applyAndMeasure(
      {
        name,
        body: '# Revised shadow\n',
        description: 'Shadow',
        confidence: 0.9,
        source: 'auto-refined',
      },
      {
        repo,
        listSkills: async () => [{ name, location: externalLocation }],
        reloadSkills: vi.fn().mockResolvedValue([]),
        measure: (skill) =>
          measureAppliedSkill(skill, {
            repo,
            scorer: scorerFor({
              [before.toString('utf8')]: 90,
              '# Revised shadow\n': 10,
            }),
            reload: vi.fn().mockResolvedValue([]),
          }),
      },
    );

    expect(outcome).toBe('applied-external-fork');
    expect(repo.findByName(name)?.status).toBe('reverted');
    expect(readFileSync(externalLocation)).toEqual(before);
    expect(existsSync(join(managedRoot, name))).toBe(false);
  });

  it('issue-977-c6: a managed rollback restores a file-backed snapshot without DB body/version content', async () => {
    // CONTRACT TEST — catches the source-of-truth regression where rollback
    // leaves a revised managed file live after agent_skills content/version rows
    // have been retired. The real apply/measure path must restore the bytes that
    // were present on disk before apply, not recover them from the DB ledger.
    const name = 'file-backed-snapshot';
    const location = join(managedRoot, name, 'SKILL.md');
    mkdirSync(join(managedRoot, name), { recursive: true });
    const before = Buffer.from(
      '---\nname: file-backed-snapshot\ndescription: "Preserve exact source bytes"\n---\n\n# Original\n\nKeep this exact file-backed revision.  \n',
      'utf8',
    );
    writeFileSync(location, before);

    const applied = await applyToEngineSkill(
      {
        name,
        body: '# Revised\n\nThis non-improving revision must roll back.\n',
        description: 'Revised',
        confidence: 0.9,
        source: 'auto-refined',
      },
      {
        repo,
        listSkills: async () => [{ name, location }],
        reloadSkills: vi.fn().mockResolvedValue([]),
      },
    );
    expect(applied).toBe('applied-managed');
    expect(readFileSync(location)).not.toEqual(before);

    // Model the post-#977 sidecar: lifecycle metadata remains, but content and
    // version history are no longer a rollback source. This is the deliberately
    // narrow seam that production code must satisfy before materializers/routes
    // are retired in a later slice.
    const measuring = repo.findByName(name)!;
    const db = getDb();
    db.prepare('DELETE FROM agent_skill_versions WHERE skill_id = ?').run(measuring.id);
    db.prepare('UPDATE agent_skills SET body = NULL, base_version = NULL WHERE id = ?').run(
      measuring.id,
    );
    const metadataOnly = repo.findByName(name)!;
    expect(metadataOnly.body).toBeNull();
    expect(metadataOnly.baseVersion).toBeNull();
    expect(repo.listVersions(metadataOnly.id)).toEqual([]);

    const outcome = await measureAppliedSkill(metadataOnly, {
      repo,
      // The judge is the true external boundary; a tie must fail closed to
      // exercise the real managed revert branch.
      scorer: scorerFor({}),
      reload: vi.fn().mockResolvedValue([]),
    });

    expect(outcome).toBe('reverted');
    expect(readFileSync(location)).toEqual(before);
    expect(repo.findByName(name)?.status).toBe('reverted');
  });
});
