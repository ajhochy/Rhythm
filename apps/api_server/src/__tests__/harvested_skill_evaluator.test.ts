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
import type { ScoreResult } from '../services/skill_refiner';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

function scorerReturning(score: number, reason = 'test score'): () => Promise<ScoreResult> {
  return async () => ({ score, reason });
}

function usesReturning(map: Record<string, number>): () => Map<string, number> {
  return () => new Map(Object.entries(map));
}

const noopReload = async () => undefined;

describe('evaluateHarvestedDrafts — test-env guard', () => {
  it('returns the empty summary and touches nothing when no scorer is injected (VITEST set)', async () => {
    expect(process.env.VITEST).toBe('true');
    const summary = await evaluateHarvestedDrafts();
    expect(summary).toEqual({ evaluated: 0, kept: 0, disabled: 0, rewriteNeeded: 0, harvesterSignalCreated: false });
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
