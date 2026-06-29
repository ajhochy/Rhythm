/**
 * #794 — skill_apply tests (injected live-set reader + injected write/reload +
 * injected original-reader; NO real model, NO real FS).
 *
 * Covers the auto-apply step over the LIVE engine skill set:
 *   - managed target → managed SKILL.md written, sidecar 'measuring' row,
 *     is_external=0, base_version snapshot written, reloadSkills called.
 *   - external target → same-`name` managed fork written, sidecar is_external=1,
 *     origin_location recorded, the external file is NEVER written (no write to
 *     a path other than the managed name; original bytes captured as base_version).
 *   - duplicate-apply guard: same name+base+candidate-hash that is measuring (in
 *     flight) or reverted (already lost) is NOT re-applied.
 *   - pre-apply gate: confidence < floor OR < existing → not applied, no throw.
 *   - target resolution: a name absent from the live set → 'no-target'.
 *   - under VITEST with NO injected writeSkill → 'skipped', zero writes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import {
  applyToEngineSkill,
  hashBody,
  resolveLiveTarget,
  type ApplyCandidate,
  type ApplyDeps,
  type LiveEngineSkill,
} from '../services/skill_apply';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

const MANAGED_ROOT = '/tmp/rhythm-managed-skills-test';
const MANAGED_LOC = `${MANAGED_ROOT}/Send_the_weekly_staff_email/SKILL.md`;
const EXTERNAL_LOC = '/Users/me/.claude/skills/weekly-email/SKILL.md';

describe('skill_apply.resolveLiveTarget', () => {
  const live: LiveEngineSkill[] = [
    { name: 'Alpha', location: '/a/SKILL.md' },
    { name: 'Beta Skill', location: '/b/SKILL.md' },
  ];
  it('matches by exact name, case-insensitively', () => {
    expect(resolveLiveTarget('beta skill', live)?.name).toBe('Beta Skill');
  });
  it('returns null for an unknown name', () => {
    expect(resolveLiveTarget('Gamma', live)).toBeNull();
  });
  it('returns null for an empty name', () => {
    expect(resolveLiveTarget('   ', live)).toBeNull();
  });
});

describe('skill_apply.applyToEngineSkill', () => {
  let repo: AgentSkillsRepository;
  const REAL_VITEST = process.env.VITEST;
  const REAL_NODE = process.env.NODE_ENV;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
    process.env.RHYTHM_MANAGED_SKILLS_DIR = MANAGED_ROOT;
    // Lift the test guard so the real branch logic runs; the INJECTED write +
    // reload + reader doubles guarantee no real FS / engine call.
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (REAL_VITEST === undefined) delete process.env.VITEST;
    else process.env.VITEST = REAL_VITEST;
    if (REAL_NODE === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = REAL_NODE;
    delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
  });

  const candidate = (over: Partial<ApplyCandidate> = {}): ApplyCandidate => ({
    name: 'Send the weekly staff email',
    body: '# Send the weekly staff email\n\nRevised, clearer body.\n',
    description: 'A clearer description',
    confidence: 0.8,
    source: 'auto-refined',
    ...over,
  });

  /** A deps bundle whose write/read are spies and never touch the real FS. */
  function deps(over: Partial<ApplyDeps> = {}): ApplyDeps & {
    writeSkill: ReturnType<typeof vi.fn>;
    reloadSkills: ReturnType<typeof vi.fn>;
    readOriginal: ReturnType<typeof vi.fn>;
  } {
    const writeSkill = vi.fn(
      (name: string) => `${MANAGED_ROOT}/${name.replace(/\s+/g, '_')}/SKILL.md`,
    );
    const reloadSkills = vi.fn(async () => []);
    const readOriginal = vi.fn(() => '# old body\n');
    return { repo, writeSkill, reloadSkills, readOriginal, ...over } as never;
  }

  it('managed target → revised SKILL.md written, measuring row, is_external=0, snapshot + reload', async () => {
    const d = deps({
      listSkills: async () => [{ name: candidate().name, location: MANAGED_LOC }],
    });
    const outcome = await applyToEngineSkill(candidate(), d);
    expect(outcome).toBe('applied-managed');

    // The write went through the managed-dir boundary, keyed on the SAME name.
    expect(d.writeSkill).toHaveBeenCalledTimes(1);
    expect(d.writeSkill.mock.calls[0][0]).toBe(candidate().name);
    expect(d.writeSkill.mock.calls[0][2]).toContain('Revised, clearer body');
    expect(d.reloadSkills).toHaveBeenCalledTimes(1);

    const row = repo.findByName(candidate().name)!;
    expect(row.status).toBe('measuring');
    expect(row.isExternal).toBe(0);
    expect(row.originLocation).toBe(MANAGED_LOC);
    expect(row.baseVersion).toBe(1);
    expect(row.version).toBe(2); // bumped from base
    expect(row.body).toContain('Revised, clearer body');
    // The PRIOR body was snapshotted as the rollback target (#795 fuel).
    const versions = repo.listVersions(row.id);
    expect(versions).toHaveLength(1);
    expect(versions[0].body).toBe('# old body\n');
    expect(versions[0].versionNo).toBe(1);
  });

  it('external target → same-name managed fork, is_external=1, origin recorded, external file NEVER written', async () => {
    const externalBytes = '# handwritten original\n\nDo not touch.\n';
    const d = deps({
      listSkills: async () => [{ name: candidate().name, location: EXTERNAL_LOC }],
      readOriginal: vi.fn((loc: string) => {
        expect(loc).toBe(EXTERNAL_LOC); // we read the original to snapshot it
        return externalBytes;
      }),
    });
    const outcome = await applyToEngineSkill(candidate(), d);
    expect(outcome).toBe('applied-external-fork');

    // CRITICAL INVARIANT: the only write is the managed SHADOW (by name). The
    // write helper is the managed-dir boundary — it is never handed the external
    // location, so the original file at EXTERNAL_LOC is never written.
    expect(d.writeSkill).toHaveBeenCalledTimes(1);
    expect(d.writeSkill.mock.calls[0][0]).toBe(candidate().name);
    // No call argument is the external path.
    for (const call of d.writeSkill.mock.calls) {
      expect(call).not.toContain(EXTERNAL_LOC);
    }

    const row = repo.findByName(candidate().name)!;
    expect(row.status).toBe('measuring');
    expect(row.isExternal).toBe(1);
    expect(row.originLocation).toBe(EXTERNAL_LOC);
    // The external original bytes are the rollback base (#795 removes the shadow).
    const versions = repo.listVersions(row.id);
    expect(versions[0].body).toBe(externalBytes);
  });

  it('duplicate-apply guard: a measuring row for same name+base+hash is NOT re-applied', async () => {
    const c = candidate();
    const live = async () => [{ name: c.name, location: MANAGED_LOC }];

    // First apply → measuring row at base v1, hash of this body.
    const first = await applyToEngineSkill(c, deps({ listSkills: live }));
    expect(first).toBe('applied-managed');

    // Second apply of the SAME body. base_version is still 1 (the row's version
    // bumped to 2, but base_version stayed 1), hash identical → duplicate.
    const d2 = deps({ listSkills: live });
    const second = await applyToEngineSkill(c, d2);
    expect(second).toBe('skipped-duplicate');
    expect(d2.writeSkill).not.toHaveBeenCalled();
    expect(d2.reloadSkills).not.toHaveBeenCalled();
  });

  it('duplicate-apply guard: a reverted row for same name+base+hash is NOT re-applied', async () => {
    const c = candidate();
    // Seed a reverted sidecar row matching the candidate exactly.
    repo.recordAutoApply({
      name: c.name,
      baseVersion: 1,
      revisedBody: c.body,
      priorBody: '# old\n',
      candidateHash: hashBody(c.body),
      isExternal: false,
      originLocation: MANAGED_LOC,
      confidence: c.confidence,
      source: c.source,
    });
    repo.update(repo.findByName(c.name)!.id, { status: 'reverted' });

    const d = deps({ listSkills: async () => [{ name: c.name, location: MANAGED_LOC }] });
    const outcome = await applyToEngineSkill(c, d);
    expect(outcome).toBe('skipped-duplicate');
    expect(d.writeSkill).not.toHaveBeenCalled();
  });

  it('pre-apply gate: confidence below the floor → not applied, no write, no throw', async () => {
    const d = deps({ listSkills: async () => [{ name: candidate().name, location: MANAGED_LOC }] });
    const outcome = await applyToEngineSkill(candidate({ confidence: 0.4 }), d);
    expect(outcome).toBe('skipped-gate');
    expect(d.writeSkill).not.toHaveBeenCalled();
    expect(repo.findByName(candidate().name)).toBeNull();
  });

  it('pre-apply gate: candidate confidence < existing → not applied', async () => {
    // Seed an existing sidecar row with higher confidence.
    repo.create({ title: candidate().name, confidence: 0.9, status: 'active' });
    const d = deps({ listSkills: async () => [{ name: candidate().name, location: MANAGED_LOC }] });
    const outcome = await applyToEngineSkill(candidate({ confidence: 0.7 }), d);
    expect(outcome).toBe('skipped-gate');
    expect(d.writeSkill).not.toHaveBeenCalled();
  });

  it('target resolution: a name absent from the live set → no-target, no write', async () => {
    const d = deps({ listSkills: async () => [{ name: 'Some other skill', location: MANAGED_LOC }] });
    const outcome = await applyToEngineSkill(candidate(), d);
    expect(outcome).toBe('no-target');
    expect(d.writeSkill).not.toHaveBeenCalled();
  });
});

describe('skill_apply.applyToEngineSkill — test guard', () => {
  it('under VITEST with NO injected writeSkill → skipped, zero writes', async () => {
    // VITEST is set by the runner; do NOT inject writeSkill → hard skip.
    setDb(makeDb());
    const repo = new AgentSkillsRepository();
    const listSkills = vi.fn(async () => [
      { name: 'Send the weekly staff email', location: '/x/SKILL.md' },
    ]);
    const outcome = await applyToEngineSkill(
      {
        name: 'Send the weekly staff email',
        body: '# x\n',
        confidence: 0.9,
        source: 'auto-refined',
      },
      { repo, listSkills },
    );
    expect(outcome).toBe('skipped');
    // Short-circuits before even reading the live set.
    expect(listSkills).not.toHaveBeenCalled();
    expect(repo.findByName('Send the weekly staff email')).toBeNull();
  });
});
