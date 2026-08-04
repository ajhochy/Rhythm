/**
 * 2026-07-11 incident — UNKNOWN IS NOT ZERO + the empty-body write invariant.
 *
 * On 2026-07-11, inside eight minutes, four of the user's hand-written skills
 * were emptied (descriptions preserved, bodies gone). One still carries the
 * reason verbatim in its `measure_reason`:
 *
 *     harvest-eval: disabled (score=0 < 40); unparseable score — treated as 0
 *
 * The judge could not be read, the parse coerced that to 0 — the BOTTOM of the
 * rubric — and the sub-threshold branch then disabled/rewrote the skill. These
 * tests pin BOTH halves of the fix:
 *
 *   1. an UNREADABLE score leaves a skill exactly as it is (no disable, no
 *      empty, no rewrite, no status change) while a GENUINE low score still
 *      does its job — otherwise the fix is just a disabled feature;
 *   2. the write boundary itself REFUSES to replace a non-empty body with an
 *      empty one, so any future caller with the same class of bug is stopped
 *      before it reaches the user's content.
 *
 * Every filesystem-touching describe redirects RHYTHM_MANAGED_SKILLS_DIR at a
 * fresh temp dir, so the real ~/.config/opencode/skills is unreachable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import {
  writeManagedSkill,
  writeDraftManagedSkill,
  restoreManagedSkillBytes,
  readManagedSkillBody,
  readDraftSkill,
  listDisabledSkillNames,
  managedSkillsRoot,
  slugForSkillName,
  draftsRoot,
  EmptyBodyOverwriteBlockedError,
} from '../services/rhythm_managed_skills';
import { evaluateHarvestedDrafts } from '../services/harvested_skill_evaluator';
import { measureAppliedSkill, candidateHash } from '../services/skill_measurement';
import {
  parseScoreResponse,
  scoreSkillBody,
  type ScoreCall,
  type RewriteCall,
} from '../services/skill_refiner';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** A judge whose answer could not be read at all. */
const unknownScorer: ScoreCall = async () => ({
  score: 0,
  reason: 'unparseable score — score UNKNOWN',
  unknown: true,
});

/** A judge that genuinely graded the body — 0 here means "this body is bad". */
const genuineScorer = (score: number): ScoreCall => async () => ({
  score,
  reason: `genuinely scored ${score}`,
});

function usesReturning(map: Record<string, number>): () => Map<string, number> {
  return () => new Map(Object.entries(map));
}

const noopReload = async () => undefined;

// ═══════════════════════════════════════════════════════════════════════════
// 1. The parse layer: unknown is a distinct outcome from a real 0.
// ═══════════════════════════════════════════════════════════════════════════

describe('2026-07-11 incident parse layer — unknown vs a genuine zero', () => {
  it('an unparseable response is UNKNOWN, not zero', () => {
    expect(parseScoreResponse('no number here').unknown).toBe(true);
    expect(parseScoreResponse('').unknown).toBe(true);
  });

  it('a real 0 from the judge is NOT unknown (the rubric floor is a valid verdict)', () => {
    const r = parseScoreResponse('0 the body is off-topic and contradicts the purpose');
    expect(r.score).toBe(0);
    expect(r.unknown).toBeUndefined();
  });

  it('a parseable score keeps its exact shape (no stray unknown key)', () => {
    expect(parseScoreResponse('82 clear and complete')).toEqual({
      score: 82,
      reason: 'clear and complete',
    });
  });

  it('a thrown scorer is UNKNOWN, not zero', async () => {
    const r = await scoreSkillBody({ name: 'x' }, 'body', async () => {
      throw new Error('judge unavailable');
    });
    expect(r.unknown).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. harvested_skill_evaluator — the branch that destroyed the four skills.
// ═══════════════════════════════════════════════════════════════════════════

describe('2026-07-11 incident harvest-eval Unit 3 — unknown score never destroys a skill', () => {
  let savedVitest: string | undefined;
  let savedNodeEnv: string | undefined;
  let savedManagedDir: string | undefined;
  let tempDir: string;

  const BODY = '# hand-written\n\nThe user spent real time on this procedure.\n';

  beforeEach(() => {
    setDb(makeDb());
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-1317-eval-'));
    savedManagedDir = process.env.RHYTHM_MANAGED_SKILLS_DIR;
    process.env.RHYTHM_MANAGED_SKILLS_DIR = tempDir;
    savedVitest = process.env.VITEST;
    savedNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (savedVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = savedVitest;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedManagedDir === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    else process.env.RHYTHM_MANAGED_SKILLS_DIR = savedManagedDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  function seedDraft(name: string): string {
    writeDraftManagedSkill({
      name,
      description: `about ${name}`,
      body: BODY,
      sourceSessionId: 'sess-1',
      confidence: 0.7,
    });
    return join(draftsRoot(), slugForSkillName(name), 'SKILL.md');
  }

  it('REGRESSION: an unparseable score leaves the draft byte-for-byte untouched', async () => {
    const location = seedDraft('daily-email-triage');
    const before = readFileSync(location);

    const summary = await evaluateHarvestedDrafts({
      scorer: unknownScorer,
      countUses: usesReturning({ 'daily-email-triage': 3 }),
      reload: noopReload,
      now: () => '2026-07-11T22:52:40.000Z',
      proposalsRepo: new AgentOrgProposalsRepository(),
    });

    // Nothing was decided, so nothing was written.
    expect(summary).toMatchObject({
      evaluated: 0,
      kept: 0,
      disabled: 0,
      rewriteNeeded: 0,
      scoreUnknown: 1,
      harvesterSignalCreated: false,
    });
    expect(readFileSync(location).equals(before)).toBe(true);

    const draft = readDraftSkill('daily-email-triage');
    expect(draft?.body).toBe(BODY.trim());
    expect(draft?.body.length).toBeGreaterThan(0);
    // Still `draft`, which is the status this loop selects on → it retries.
    expect(draft?.frontmatter.status).toBe('draft');
    expect(listDisabledSkillNames()).toEqual([]);
  });

  it('a later pass with a readable score DOES decide (the retry actually works)', async () => {
    seedDraft('daily-dev-summary');
    const deps = {
      countUses: usesReturning({ 'daily-dev-summary': 3 }),
      reload: noopReload,
      now: () => '2026-07-11T22:58:53.000Z',
      proposalsRepo: new AgentOrgProposalsRepository(),
    };
    const first = await evaluateHarvestedDrafts({ ...deps, scorer: unknownScorer });
    expect(first.scoreUnknown).toBe(1);

    const second = await evaluateHarvestedDrafts({ ...deps, scorer: genuineScorer(85) });
    expect(second).toMatchObject({ evaluated: 1, kept: 1, scoreUnknown: 0 });
    expect(readDraftSkill('daily-dev-summary')?.frontmatter.status).toBe('active');
  });

  it('FEATURE STILL WORKS: a genuine disable-tier score still disables + archives', async () => {
    seedDraft('genuinely-bad');
    const summary = await evaluateHarvestedDrafts({
      scorer: genuineScorer(5),
      countUses: usesReturning({ 'genuinely-bad': 3 }),
      reload: noopReload,
      now: () => '2026-07-11T23:00:00.000Z',
      proposalsRepo: new AgentOrgProposalsRepository(),
    });
    expect(summary).toMatchObject({ evaluated: 1, disabled: 1, scoreUnknown: 0 });
    expect(readDraftSkill('genuinely-bad')).toBeNull();
    expect(listDisabledSkillNames()).toContain(slugForSkillName('genuinely-bad'));
  });

  it('FEATURE STILL WORKS: a genuine mid-tier score still flags rewrite-needed', async () => {
    seedDraft('genuinely-mediocre');
    const summary = await evaluateHarvestedDrafts({
      scorer: genuineScorer(45),
      rewriter: (async (_p, body) => body) as RewriteCall,
      countUses: usesReturning({ 'genuinely-mediocre': 3 }),
      reload: noopReload,
      now: () => '2026-07-11T23:00:00.000Z',
      proposalsRepo: new AgentOrgProposalsRepository(),
    });
    expect(summary).toMatchObject({ evaluated: 1, rewriteNeeded: 1, scoreUnknown: 0 });
    expect(readDraftSkill('genuinely-mediocre')?.frontmatter.status).toBe('rewrite-needed');
  });

  it('Unit 5: an unknown rewrite judge neither rewrites nor burns the one-shot attempt', async () => {
    // Seed a draft already flagged rewrite-needed with a recorded baseline.
    writeDraftManagedSkill({
      name: 'monthly-gc-report',
      description: 'monthly report',
      body: BODY,
      sourceSessionId: 'sess-1',
      confidence: 0.7,
      status: 'rewrite-needed',
      evaluatedAt: '2026-07-11T22:57:15.000Z',
      postScore: 45,
      measureReason: 'flagged',
    });
    const location = join(draftsRoot(), slugForSkillName('monthly-gc-report'), 'SKILL.md');
    const before = readFileSync(location);

    await evaluateHarvestedDrafts({
      scorer: unknownScorer,
      rewriter: (async () => '# a shiny new body\n\nrewritten\n') as RewriteCall,
      countUses: usesReturning({}),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
    });

    expect(readFileSync(location).equals(before)).toBe(true);
    const draft = readDraftSkill('monthly-gc-report');
    expect(draft?.body).toBe(BODY.trim());
    expect(draft?.frontmatter.status).toBe('rewrite-needed');
    // The cap marker must NOT be stamped — a judge outage cannot consume the
    // draft's single lifetime rewrite attempt.
    expect(draft?.frontmatter.rewriteAttemptedAt).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The write-boundary invariant: empty never replaces non-empty.
// ═══════════════════════════════════════════════════════════════════════════

describe('2026-07-11 incident write boundary — an empty body never overwrites a non-empty one', () => {
  let savedManagedDir: string | undefined;
  let tempDir: string;

  const BODY = '# real\n\nreal content the user wrote\n';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-1317-write-'));
    savedManagedDir = process.env.RHYTHM_MANAGED_SKILLS_DIR;
    process.env.RHYTHM_MANAGED_SKILLS_DIR = tempDir;
  });

  afterEach(() => {
    if (savedManagedDir === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    else process.env.RHYTHM_MANAGED_SKILLS_DIR = savedManagedDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writeManagedSkill refuses an empty body over existing content', () => {
    writeManagedSkill({ name: 'keeper', body: BODY });
    expect(() => writeManagedSkill({ name: 'keeper', body: '' })).toThrow(
      EmptyBodyOverwriteBlockedError,
    );
    expect(() => writeManagedSkill({ name: 'keeper', body: '   \n\n  ' })).toThrow(
      EmptyBodyOverwriteBlockedError,
    );
    expect(readManagedSkillBody('keeper')).toBe(BODY.trim());
  });

  it('writeDraftManagedSkill refuses an empty body over existing content', () => {
    const draft = {
      name: 'draft-keeper',
      description: 'd',
      sourceSessionId: 's',
      confidence: 0.5,
    };
    writeDraftManagedSkill({ ...draft, body: BODY });
    expect(() => writeDraftManagedSkill({ ...draft, body: '' })).toThrow(
      EmptyBodyOverwriteBlockedError,
    );
    expect(readDraftSkill('draft-keeper')?.body).toBe(BODY.trim());
  });

  it('restoreManagedSkillBytes refuses a restore of literally nothing', () => {
    writeManagedSkill({ name: 'restore-keeper', body: BODY });
    // A caller with no snapshot at all synthesizes '' — the 2026-07-11 class of
    // bug (`prior?.body ?? restored.body ?? ''`).
    expect(() => restoreManagedSkillBytes('restore-keeper', Buffer.alloc(0))).toThrow(
      EmptyBodyOverwriteBlockedError,
    );
    expect(() => restoreManagedSkillBytes('restore-keeper', '   \n')).toThrow(
      EmptyBodyOverwriteBlockedError,
    );
    expect(readManagedSkillBody('restore-keeper')).toBe(BODY.trim());
  });

  it('LEGITIMATE: a byte-exact rollback to a frontmatter-only snapshot still works', () => {
    // Issue #1082 contract c4: a skill whose file legitimately holds only
    // frontmatter must be restorable to exactly that. The invariant guards
    // SYNTHESIZED emptiness, not a real snapshot that happens to have no body.
    writeManagedSkill({ name: 'was-frontmatter-only', body: BODY });
    const snapshot = '---\nname: was-frontmatter-only\n---\n\n';
    expect(() => restoreManagedSkillBytes('was-frontmatter-only', snapshot)).not.toThrow();
    expect(readManagedSkillBody('was-frontmatter-only')).toBe('');
  });

  it('LEGITIMATE: an empty→content write still succeeds', () => {
    // A file that exists but whose body is empty is not content worth keeping.
    const dir = join(managedSkillsRoot(), slugForSkillName('was-empty'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: was-empty\n---\n\n', 'utf8');
    expect(readManagedSkillBody('was-empty')).toBe('');

    writeManagedSkill({ name: 'was-empty', body: BODY });
    expect(readManagedSkillBody('was-empty')).toBe(BODY.trim());
  });

  it('LEGITIMATE: a first write and a content→content overwrite still succeed', () => {
    writeManagedSkill({ name: 'brand-new', body: BODY });
    expect(readManagedSkillBody('brand-new')).toBe(BODY.trim());
    writeManagedSkill({ name: 'brand-new', body: '# v2\n\nbetter\n' });
    expect(readManagedSkillBody('brand-new')).toBe('# v2\n\nbetter');
  });

  it('LEGITIMATE: an empty body for a name with no file on disk is not blocked', () => {
    expect(() => writeManagedSkill({ name: 'never-existed', body: '' })).not.toThrow();
    expect(existsSync(join(managedSkillsRoot(), slugForSkillName('never-existed'), 'SKILL.md'))).toBe(
      true,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. skill_measurement — an unknown BASELINE must not manufacture a "keep".
// ═══════════════════════════════════════════════════════════════════════════

describe('2026-07-11 incident skill_measurement — unknown score never decides "keep"', () => {
  let repo: AgentSkillsRepository;
  let savedVitest: string | undefined;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    setDb(makeDb());
    repo = new AgentSkillsRepository();
    savedVitest = process.env.VITEST;
    savedNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (savedVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = savedVitest;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
  });

  function seedMeasuring(name: string) {
    const created = repo.create({
      title: name,
      description: `desc ${name}`,
      body: 'BASE body',
      confidence: 0.7,
      status: 'active',
    });
    repo.reviseInPlace(created.id, { body: 'REVISED body' }, 'auto-applied');
    repo.update(created.id, {
      status: 'measuring',
      appliedForName: name,
      baseVersion: 1,
      isExternal: 0,
      measureReason: `hash:${candidateHash('REVISED body')}`,
    });
    return repo.getById(created.id)!;
  }

  it('REGRESSION: an unknown BASELINE + a good post score reverts (it used to keep)', async () => {
    const skill = seedMeasuring('unknown-baseline');
    // Pre-fix: baseline unknown → 0, post 55 → 55 > 0 → KEEP an unmeasured revision.
    const scorer: ScoreCall = async (_p, body) =>
      body === 'BASE body'
        ? { score: 0, reason: 'unparseable', unknown: true }
        : { score: 55, reason: 'ok' };

    const outcome = await measureAppliedSkill(skill, {
      repo,
      scorer,
      reload: vi.fn().mockResolvedValue([]),
      write: vi.fn(),
      remove: vi.fn(),
    });

    expect(outcome).toBe('reverted');
    const after = repo.getById(skill.id)!;
    expect(after.status).toBe('reverted');
    expect(after.body).toBe('BASE body');
  });

  it('FEATURE STILL WORKS: two readable scores still keep a real improvement', async () => {
    const skill = seedMeasuring('real-improvement');
    const scorer: ScoreCall = async (_p, body) =>
      body === 'BASE body' ? { score: 40, reason: 'meh' } : { score: 80, reason: 'better' };

    const outcome = await measureAppliedSkill(skill, {
      repo,
      scorer,
      reload: vi.fn().mockResolvedValue([]),
      write: vi.fn(),
      remove: vi.fn(),
    });

    expect(outcome).toBe('kept');
    const after = repo.getById(skill.id)!;
    expect(after.status).toBe('active');
    expect(after.baselineScore).toBe(40);
    expect(after.postScore).toBe(80);
  });

  it('refuses to "restore" an empty prior body over a live file', async () => {
    // A row with base_version but NO body in that version snapshot — the exact
    // shape a file-authored skill leaves behind (`?? ''` used to write nothing).
    const created = repo.create({
      title: 'file-authored',
      description: 'd',
      body: null as unknown as string,
      confidence: 0.7,
      status: 'active',
    });
    repo.reviseInPlace(created.id, { body: 'REVISED body' }, 'auto-applied');
    repo.update(created.id, {
      status: 'measuring',
      appliedForName: 'file-authored',
      baseVersion: 1,
      isExternal: 0,
    });
    const skill = repo.getById(created.id)!;
    const write = vi.fn();

    const outcome = await measureAppliedSkill(skill, {
      repo,
      scorer: genuineScorer(10),
      reload: vi.fn().mockResolvedValue([]),
      write,
      remove: vi.fn(),
    });

    expect(outcome).toBe('skipped');
    expect(write).not.toHaveBeenCalled();
  });
});
