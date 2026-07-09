/**
 * Tests for harvested_skill_evaluator.ts (#929 Units 3+4).
 *
 * Unit 3: a draft with >= EVAL_THRESHOLD (3) real skill-tool uses gets an
 * absolute quality score and transitions to active (keep) / rewrite-needed /
 * disabled (archived + removed from the live picker).
 * Unit 4: repeated bad outcomes (3-in-a-row OR 5-of-last-10) create exactly
 * one deduped `agent_org_proposals` row of kind 'harvester-quality'.
 *
 * The isTestEnv() guard is lifted (VITEST/NODE_ENV cleared) so the real
 * control flow runs; the LLM scorer and usage counter are always injected —
 * no model/network is ever touched.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentOrgProposalsRepository } from '../repositories/agent_org_proposals_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import {
  writeDraftManagedSkill,
  readDraftSkill,
  listDraftSkillNames,
  listDisabledSkillNames,
  readDisabledSkill,
} from '../services/rhythm_managed_skills';
import { evaluateHarvestedDrafts } from '../services/harvested_skill_evaluator';
import type { ScoreResult, RewriteCall } from '../services/skill_refiner';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function scorerReturning(score: number, reason = 'test score'): () => Promise<ScoreResult> {
  return async () => ({ score, reason });
}

function rewriterReturning(body: string): RewriteCall {
  return async () => body;
}

/**
 * #969 — a no-op stand-in for tests that don't care about the rewrite-needed
 * sweep but (in the "guard lifted" describe blocks below) now exercise it
 * anyway whenever their draft ends up rewrite-needed in the SAME pass. Never
 * a real network call; returns the body unchanged so a fixed-score fake
 * scorer ties the baseline and the non-destructive gate correctly no-ops.
 */
const identityRewriter: RewriteCall = async (_purpose, body) => body;

function usesReturning(map: Record<string, number>): () => Map<string, number> {
  return () => new Map(Object.entries(map));
}

const noopReload = async () => undefined;

describe('evaluateHarvestedDrafts — test-env guard', () => {
  it('returns the empty summary and touches nothing when no scorer is injected (VITEST set)', async () => {
    expect(process.env.VITEST).toBe('true');
    const summary = await evaluateHarvestedDrafts();
    expect(summary).toEqual({
      evaluated: 0,
      kept: 0,
      disabled: 0,
      rewriteNeeded: 0,
      rewriteAttempted: 0,
      rewritten: 0,
      harvesterSignalCreated: false,
    });
  });
});

describe('evaluateHarvestedDrafts — Unit 3 keep/disable/rewrite-needed (guard lifted)', () => {
  let savedVitest: string | undefined;
  let savedNodeEnv: string | undefined;
  let savedManagedDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    setDb(makeDb());
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-harvest-eval-'));
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

  function seedDraft(name: string): void {
    writeDraftManagedSkill({
      name,
      description: `about ${name}`,
      body: `# ${name}\n\nSome procedure.\n`,
      sourceSessionId: 'sess-1',
      confidence: 0.7,
    });
  }

  it('leaves a draft untouched (status: draft) below the use threshold', async () => {
    seedDraft('under-threshold');
    const summary = await evaluateHarvestedDrafts({
      scorer: scorerReturning(90),
      countUses: usesReturning({ 'under-threshold': 2 }), // EVAL_THRESHOLD is 3
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
    });
    expect(summary.evaluated).toBe(0);
    expect(readDraftSkill('under-threshold')?.frontmatter.status).toBe('draft');
  });

  it('keeps a high-scoring draft: status -> active, stays live, score/reason recorded', async () => {
    seedDraft('good-skill');
    const summary = await evaluateHarvestedDrafts({
      scorer: scorerReturning(85, 'precise and complete'),
      countUses: usesReturning({ 'good-skill': 3 }),
      reload: noopReload,
      now: () => '2026-07-09T00:00:00.000Z',
      proposalsRepo: new AgentOrgProposalsRepository(),
    });
    expect(summary).toMatchObject({ evaluated: 1, kept: 1, disabled: 0, rewriteNeeded: 0 });

    const draft = readDraftSkill('good-skill');
    expect(draft?.frontmatter.status).toBe('active');
    expect(draft?.frontmatter.postScore).toBe(85);
    expect(draft?.frontmatter.measureReason).toBe('precise and complete');
    expect(listDraftSkillNames()).toContain('good-skill'); // still live
  });

  it('flags a mediocre draft rewrite-needed, leaving it live', async () => {
    seedDraft('mediocre-skill');
    const summary = await evaluateHarvestedDrafts({
      scorer: scorerReturning(40, 'basic coverage, notable gaps'),
      countUses: usesReturning({ 'mediocre-skill': 5 }),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
      // #969 — this same pass's Unit-5 sweep now also fires on the
      // rewrite-needed draft it just produced; inject a no-op rewriter so it
      // never falls through to a real LLM call (this describe block lifts
      // isTestEnv() the same way for the WHOLE pass, not just Unit 3).
      rewriter: identityRewriter,
    });
    expect(summary).toMatchObject({ evaluated: 1, kept: 0, disabled: 0, rewriteNeeded: 1 });

    const draft = readDraftSkill('mediocre-skill');
    expect(draft?.frontmatter.status).toBe('rewrite-needed');
    expect(listDraftSkillNames()).toContain('mediocre-skill'); // still live/usable
  });

  it('disables a low-scoring draft: archived to disabled/, removed from the live picker', async () => {
    seedDraft('useless-skill');
    const summary = await evaluateHarvestedDrafts({
      scorer: scorerReturning(5, 'off-topic'),
      countUses: usesReturning({ 'useless-skill': 3 }),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
    });
    expect(summary).toMatchObject({ evaluated: 1, kept: 0, disabled: 1, rewriteNeeded: 0 });

    expect(listDraftSkillNames()).not.toContain('useless-skill');
    expect(listDisabledSkillNames()).toContain('useless-skill');
    expect(readDisabledSkill('useless-skill')?.frontmatter.postScore).toBe(5);
  });

  it('never throws when the scorer itself rejects — the draft is simply skipped this pass', async () => {
    seedDraft('flaky-skill');
    const summary = await evaluateHarvestedDrafts({
      scorer: async () => {
        throw new Error('judge unavailable');
      },
      countUses: usesReturning({ 'flaky-skill': 3 }),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
    });
    // scoreSkillBody itself is fail-closed (score 0 on a throw), so this
    // still evaluates to a disable outcome rather than crashing the pass.
    expect(summary.evaluated).toBe(1);
    expect(summary.disabled).toBe(1);
  });

  // #959 — dependency guard: a harvested skill referenced by any agent's
  // allowed_skills_json must never be moved to disabled/, even at a
  // disable-tier score.
  describe('#959 dependency guard', () => {
    it('a low-scoring draft referenced by an agent allowlist is left rewrite-needed, never disabled', async () => {
      seedDraft('depended-on-skill');
      const configsRepo = new AgentConfigsRepository();
      configsRepo.insert({
        label: 'Some Agent',
        icon: 'robot',
        allowedSkillsJson: JSON.stringify(['depended-on-skill', 'other-skill']),
      });

      const summary = await evaluateHarvestedDrafts({
        scorer: scorerReturning(5, 'off-topic'),
        countUses: usesReturning({ 'depended-on-skill': 3 }),
        reload: noopReload,
        proposalsRepo: new AgentOrgProposalsRepository(),
        agentConfigsRepo: configsRepo,
        // #969 — see the mediocre-skill test above: the same-pass Unit-5 sweep
        // now also fires on this rewrite-needed draft; no-op it out.
        rewriter: identityRewriter,
      });

      expect(summary).toMatchObject({ evaluated: 1, kept: 0, disabled: 0, rewriteNeeded: 1 });
      expect(listDraftSkillNames()).toContain('depended-on-skill'); // still live
      expect(listDisabledSkillNames()).not.toContain('depended-on-skill');
      expect(readDraftSkill('depended-on-skill')?.frontmatter.status).toBe('rewrite-needed');
    });

    it('a low-scoring draft with no agent dependents is still disabled as before', async () => {
      seedDraft('undepended-skill');
      const configsRepo = new AgentConfigsRepository();
      configsRepo.insert({
        label: 'Some Agent',
        icon: 'robot',
        allowedSkillsJson: JSON.stringify(['some-other-skill']),
      });

      const summary = await evaluateHarvestedDrafts({
        scorer: scorerReturning(5, 'off-topic'),
        countUses: usesReturning({ 'undepended-skill': 3 }),
        reload: noopReload,
        proposalsRepo: new AgentOrgProposalsRepository(),
        agentConfigsRepo: configsRepo,
      });

      expect(summary).toMatchObject({ evaluated: 1, kept: 0, disabled: 1, rewriteNeeded: 0 });
      expect(listDisabledSkillNames()).toContain('undepended-skill');
    });

    it('an agent allowlist with a null allowed_skills_json (unrestricted) never blocks disabling', async () => {
      seedDraft('unrestricted-agent-skill');
      const configsRepo = new AgentConfigsRepository();
      configsRepo.insert({ label: 'Unrestricted Agent', icon: 'robot', allowedSkillsJson: null });

      const summary = await evaluateHarvestedDrafts({
        scorer: scorerReturning(5, 'off-topic'),
        countUses: usesReturning({ 'unrestricted-agent-skill': 3 }),
        reload: noopReload,
        proposalsRepo: new AgentOrgProposalsRepository(),
        agentConfigsRepo: configsRepo,
      });

      expect(summary).toMatchObject({ disabled: 1, rewriteNeeded: 0 });
    });
  });

  // #959 — RHYTHM_HARVEST_EVAL_THRESHOLD=0 makes the live gate deterministic:
  // a zero-usage draft is evaluated on any pass (no skill invocation needed).
  describe('#959 RHYTHM_HARVEST_EVAL_THRESHOLD override', () => {
    let savedThreshold: string | undefined;
    beforeEach(() => {
      savedThreshold = process.env.RHYTHM_HARVEST_EVAL_THRESHOLD;
    });
    afterEach(() => {
      if (savedThreshold === undefined) delete process.env.RHYTHM_HARVEST_EVAL_THRESHOLD;
      else process.env.RHYTHM_HARVEST_EVAL_THRESHOLD = savedThreshold;
    });

    it('threshold 0 evaluates a draft with zero recorded uses; default (3) skips it', async () => {
      seedDraft('zero-use-skill');

      // Default threshold (env unset) → a 0-use draft is skipped.
      delete process.env.RHYTHM_HARVEST_EVAL_THRESHOLD;
      const skipped = await evaluateHarvestedDrafts({
        scorer: scorerReturning(90),
        countUses: usesReturning({}), // zero uses
        reload: noopReload,
        proposalsRepo: new AgentOrgProposalsRepository(),
      });
      expect(skipped.evaluated).toBe(0);
      expect(readDraftSkill('zero-use-skill')?.frontmatter.status).toBe('draft');

      // Threshold 0 → the same 0-use draft IS evaluated.
      process.env.RHYTHM_HARVEST_EVAL_THRESHOLD = '0';
      const evaluated = await evaluateHarvestedDrafts({
        scorer: scorerReturning(90),
        countUses: usesReturning({}),
        reload: noopReload,
        proposalsRepo: new AgentOrgProposalsRepository(),
      });
      expect(evaluated.evaluated).toBe(1);
      expect(readDraftSkill('zero-use-skill')?.frontmatter.status).toBe('active');
    });
  });
});

describe('evaluateHarvestedDrafts — Unit 4 harvester-quality signal (guard lifted)', () => {
  let savedVitest: string | undefined;
  let savedNodeEnv: string | undefined;
  let savedManagedDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    setDb(makeDb());
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-harvest-eval-signal-'));
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

  function seedDraft(name: string): void {
    writeDraftManagedSkill({
      name,
      body: `# ${name}\n`,
      sourceSessionId: 'sess-1',
      confidence: 0.7,
    });
  }

  it('trips after 3 bad outcomes in a row, creating exactly one harvester-quality proposal', async () => {
    seedDraft('bad-1');
    seedDraft('bad-2');
    seedDraft('bad-3');
    const proposalsRepo = new AgentOrgProposalsRepository();

    // Evaluate one at a time (like real usage: each becomes eligible on its own turn),
    // each scoring in the disable band, with strictly increasing evaluatedAt so the
    // "newest first" ordering the trip check relies on is deterministic.
    for (const [i, name] of ['bad-1', 'bad-2', 'bad-3'].entries()) {
      await evaluateHarvestedDrafts({
        scorer: scorerReturning(5, 'off-topic'),
        countUses: usesReturning({ [name]: 3 }),
        reload: async () => undefined,
        now: () => `2026-07-09T00:0${i}:00.000Z`,
        proposalsRepo,
      });
    }

    const proposals = await proposalsRepo.listProposedAsync();
    const harvesterProposals = proposals.filter((p) => p.kind === 'harvester-quality');
    expect(harvesterProposals).toHaveLength(1);
    expect(harvesterProposals[0].risk).toBe('high'); // fail-closed default (no auto-fix exists)
    expect(harvesterProposals[0].rationale).toContain('bad-1');
  });

  it('does not trip on fewer than 3 bad outcomes with no 5-of-10 window either', async () => {
    seedDraft('bad-1');
    seedDraft('bad-2');
    const proposalsRepo = new AgentOrgProposalsRepository();

    for (const [i, name] of ['bad-1', 'bad-2'].entries()) {
      await evaluateHarvestedDrafts({
        scorer: scorerReturning(5, 'off-topic'),
        countUses: usesReturning({ [name]: 3 }),
        reload: async () => undefined,
        now: () => `2026-07-09T00:0${i}:00.000Z`,
        proposalsRepo,
      });
    }

    expect((await proposalsRepo.listProposedAsync()).filter((p) => p.kind === 'harvester-quality')).toHaveLength(0);
  });

  it('de-dupes: re-tripping the SAME streak never creates a second proposal', async () => {
    seedDraft('bad-1');
    seedDraft('bad-2');
    seedDraft('bad-3');
    const proposalsRepo = new AgentOrgProposalsRepository();

    for (const [i, name] of ['bad-1', 'bad-2', 'bad-3'].entries()) {
      await evaluateHarvestedDrafts({
        scorer: scorerReturning(5, 'off-topic'),
        countUses: usesReturning({ [name]: 3 }),
        reload: async () => undefined,
        now: () => `2026-07-09T00:0${i}:00.000Z`,
        proposalsRepo,
      });
    }
    // A 4th, unrelated draft that scores fine — should not touch the existing
    // signal (no new bad outcome this pass at all).
    seedDraft('good-4');
    await evaluateHarvestedDrafts({
      scorer: scorerReturning(90, 'great'),
      countUses: usesReturning({ 'good-4': 3 }),
      reload: async () => undefined,
      now: () => '2026-07-09T00:10:00.000Z',
      proposalsRepo,
    });

    expect((await proposalsRepo.listProposedAsync()).filter((p) => p.kind === 'harvester-quality')).toHaveLength(1);
  });

  it('a NEW bad skill entering the window creates a second, distinctly-keyed proposal', async () => {
    seedDraft('bad-1');
    seedDraft('bad-2');
    seedDraft('bad-3');
    const proposalsRepo = new AgentOrgProposalsRepository();

    for (const [i, name] of ['bad-1', 'bad-2', 'bad-3'].entries()) {
      await evaluateHarvestedDrafts({
        scorer: scorerReturning(5, 'off-topic'),
        countUses: usesReturning({ [name]: 3 }),
        reload: async () => undefined,
        now: () => `2026-07-09T00:0${i}:00.000Z`,
        proposalsRepo,
      });
    }

    seedDraft('bad-4');
    await evaluateHarvestedDrafts({
      scorer: scorerReturning(5, 'off-topic'),
      countUses: usesReturning({ 'bad-4': 3 }),
      reload: async () => undefined,
      now: () => '2026-07-09T00:04:00.000Z',
      proposalsRepo,
    });

    // bad-2/bad-3/bad-4 is a NEW 3-in-a-row streak with a different name set.
    expect((await proposalsRepo.listProposedAsync()).filter((p) => p.kind === 'harvester-quality')).toHaveLength(2);
  });
});

// #969 — Unit 5 isTestEnv guard, checked with the REAL vitest env (VITEST
// stays 'true', unlike the "guard lifted" describe blocks below which delete
// it). Proves the rewrite sweep has its OWN independent guard on
// `deps.rewriter` — injecting `deps.scorer` alone (as every OTHER test in
// this file does, to control Unit 3's judge) must never be enough to fall
// through to a real rewriter LLM call.
describe('evaluateHarvestedDrafts — Unit 5 (#969) isTestEnv guard (real VITEST env)', () => {
  let savedManagedDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    expect(process.env.VITEST).toBe('true'); // sanity: guard is NOT lifted in this block
    setDb(makeDb());
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-harvest-rewrite-guard-'));
    savedManagedDir = process.env.RHYTHM_MANAGED_SKILLS_DIR;
    process.env.RHYTHM_MANAGED_SKILLS_DIR = tempDir;
  });

  afterEach(() => {
    if (savedManagedDir === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    else process.env.RHYTHM_MANAGED_SKILLS_DIR = savedManagedDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('does nothing when no rewriter is injected — a real rewriter call is never attempted', async () => {
    writeDraftManagedSkill({
      name: 'untouched-skill',
      description: 'about untouched-skill',
      body: '# untouched-skill\n\nVague, incomplete procedure.\n',
      sourceSessionId: 'sess-1',
      confidence: 0.7,
      status: 'rewrite-needed',
      evaluatedAt: '2026-07-09T00:00:00.000Z',
      postScore: 40,
      measureReason: 'basic coverage, notable gaps',
    });

    // deps.scorer is injected (as every OTHER test in this file does, to lift
    // the OUTER evaluateHarvestedDrafts guard) but deps.rewriter is NOT — if
    // the sweep's guard incorrectly keyed off deps.scorer instead of its own
    // deps.rewriter, this would attempt a real (network) LLM call and hang/
    // throw instead of returning cleanly.
    const summary = await evaluateHarvestedDrafts({
      scorer: scorerReturning(90),
      countUses: usesReturning({}),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
    });
    expect(summary).toMatchObject({ rewriteAttempted: 0, rewritten: 0 });
    const draft = readDraftSkill('untouched-skill');
    expect(draft?.frontmatter.status).toBe('rewrite-needed');
    expect(draft?.frontmatter.rewriteAttemptedAt).toBeUndefined();
  });
});

describe('evaluateHarvestedDrafts — Unit 5 (#969) rewrite-needed -> refiner wiring (guard lifted)', () => {
  let savedVitest: string | undefined;
  let savedNodeEnv: string | undefined;
  let savedManagedDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    setDb(makeDb());
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-harvest-rewrite-'));
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

  function seedRewriteNeeded(
    name: string,
    opts: { postScore?: number; measureReason?: string; evaluatedAt?: string } = {},
  ): void {
    writeDraftManagedSkill({
      name,
      description: `about ${name}`,
      body: `# ${name}\n\nVague, incomplete procedure.\n`,
      sourceSessionId: 'sess-1',
      confidence: 0.7,
      status: 'rewrite-needed',
      evaluatedAt: opts.evaluatedAt ?? '2026-07-09T00:00:00.000Z',
      postScore: opts.postScore ?? 40,
      measureReason: opts.measureReason ?? 'basic coverage, notable gaps',
    });
  }

  it('an improving rewrite is invoked via the refiner and transitions the draft to active, in place', async () => {
    seedRewriteNeeded('fixable-skill', { postScore: 40 });
    const summary = await evaluateHarvestedDrafts({
      scorer: scorerReturning(90, 'accurate and complete now'),
      countUses: usesReturning({}),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
      rewriter: rewriterReturning('# fixable-skill\n\nA complete, accurate, actionable procedure.\n'),
      now: () => '2026-07-09T01:00:00.000Z',
    });
    expect(summary).toMatchObject({ rewriteAttempted: 1, rewritten: 1 });

    const draft = readDraftSkill('fixable-skill');
    expect(draft?.frontmatter.status).toBe('active');
    expect(draft?.body).toContain('A complete, accurate, actionable procedure.');
    expect(draft?.frontmatter.postScore).toBe(90);
    expect(draft?.frontmatter.measureReason).toBe('accurate and complete now');
    expect(draft?.frontmatter.rewriteAttemptedAt).toBe('2026-07-09T01:00:00.000Z');
    expect(listDraftSkillNames()).toContain('fixable-skill'); // still under drafts/ — never promoted/moved
  });

  it('a non-improving rewrite is NOT applied — non-destructive, stays rewrite-needed', async () => {
    seedRewriteNeeded('stubborn-skill', { postScore: 40 });
    const originalBody = readDraftSkill('stubborn-skill')?.body;

    const summary = await evaluateHarvestedDrafts({
      scorer: scorerReturning(35, 'still loosely related'), // worse than the recorded baseline (40)
      countUses: usesReturning({}),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
      rewriter: rewriterReturning('# stubborn-skill\n\nStill not great.\n'),
      now: () => '2026-07-09T01:00:00.000Z',
    });
    expect(summary).toMatchObject({ rewriteAttempted: 1, rewritten: 0 });

    const draft = readDraftSkill('stubborn-skill');
    expect(draft?.frontmatter.status).toBe('rewrite-needed');
    expect(draft?.body).toBe(originalBody); // byte-for-byte untouched
    expect(draft?.frontmatter.postScore).toBe(40); // baseline preserved, not overwritten
    expect(draft?.frontmatter.rewriteAttemptedAt).toBe('2026-07-09T01:00:00.000Z'); // marker still stamped
  });

  it('a candidate that only ties the baseline is treated as NOT improving (strictly-greater gate)', async () => {
    seedRewriteNeeded('tied-skill', { postScore: 61 }); // already at the KEEP bar
    const summary = await evaluateHarvestedDrafts({
      scorer: scorerReturning(61, 'same score'),
      countUses: usesReturning({}),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
      rewriter: rewriterReturning('# tied-skill\n\nA slightly different but equally-good rewrite.\n'),
      now: () => '2026-07-09T01:00:00.000Z',
    });
    expect(summary).toMatchObject({ rewriteAttempted: 1, rewritten: 0 });
    expect(readDraftSkill('tied-skill')?.frontmatter.status).toBe('rewrite-needed');
  });

  it('loop-safety cap: a later pass never re-attempts an already-attempted, unimproved draft', async () => {
    seedRewriteNeeded('capped-skill', { postScore: 40 });
    let rewriterCalls = 0;
    const rewriter: RewriteCall = async () => {
      rewriterCalls++;
      return '# capped-skill\n\nStill mediocre.\n';
    };

    const summary1 = await evaluateHarvestedDrafts({
      scorer: scorerReturning(35),
      countUses: usesReturning({}),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
      rewriter,
      now: () => '2026-07-09T01:00:00.000Z',
    });
    expect(summary1.rewriteAttempted).toBe(1);
    expect(rewriterCalls).toBe(1);

    // A LATER pass (simulating the next completed turn) with the SAME
    // unimproved draft: the loop cap must skip it — zero new rewriter calls,
    // no matter how many more turns run afterward.
    const summary2 = await evaluateHarvestedDrafts({
      scorer: scorerReturning(35),
      countUses: usesReturning({}),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
      rewriter,
      now: () => '2026-07-09T02:00:00.000Z',
    });
    expect(rewriterCalls).toBe(1); // NOT called again
    expect(summary2.rewriteAttempted).toBe(0);
    expect(readDraftSkill('capped-skill')?.frontmatter.status).toBe('rewrite-needed');
  });

  // #959 x #969 — a depended-on skill routed to rewrite-needed instead of
  // disabled must be rewritten IN PLACE and stay live/discoverable throughout,
  // exactly as if it had been an ordinary mediocre (non-depended-on) draft.
  it('a #959 depended-on rewrite-needed skill stays live throughout an improving rewrite', async () => {
    seedRewriteNeeded('depended-fixable-skill', { postScore: 15 }); // originally disable-tier, routed here by #959
    const summary = await evaluateHarvestedDrafts({
      scorer: scorerReturning(85, 'now solid'),
      countUses: usesReturning({}),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
      rewriter: rewriterReturning('# depended-fixable-skill\n\nNow a real, complete procedure.\n'),
      now: () => '2026-07-09T01:00:00.000Z',
    });
    expect(summary).toMatchObject({ rewritten: 1 });
    expect(listDraftSkillNames()).toContain('depended-fixable-skill'); // never removed
    expect(listDisabledSkillNames()).not.toContain('depended-fixable-skill'); // never disabled
    expect(readDraftSkill('depended-fixable-skill')?.frontmatter.status).toBe('active');
  });

  it('never throws when the rewriter itself rejects — the draft is simply left rewrite-needed this pass', async () => {
    seedRewriteNeeded('flaky-rewrite-skill', { postScore: 40 });
    const summary = await evaluateHarvestedDrafts({
      // A real judge re-scoring the SAME (unchanged) inadequate body would not
      // suddenly call it great — model that with a below-bar score here, since
      // this fake scorer (unlike the real one) does not read body content.
      scorer: scorerReturning(35, 'unchanged body still inadequate'),
      countUses: usesReturning({}),
      reload: noopReload,
      proposalsRepo: new AgentOrgProposalsRepository(),
      rewriter: async () => {
        throw new Error('rewriter unavailable');
      },
      now: () => '2026-07-09T01:00:00.000Z',
    });
    // rewriteSkillBody is fail-closed (returns the unchanged body on a throw),
    // so a thrown rewriter can never itself manufacture an "improvement".
    expect(summary).toMatchObject({ rewriteAttempted: 1, rewritten: 0 });
    const draft = readDraftSkill('flaky-rewrite-skill');
    expect(draft?.frontmatter.status).toBe('rewrite-needed');
    expect(draft?.body).toBe(`# flaky-rewrite-skill\n\nVague, incomplete procedure.`);
  });
});
