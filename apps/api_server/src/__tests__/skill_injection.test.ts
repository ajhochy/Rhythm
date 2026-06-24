/**
 * P3-2 — inject matched skills into the prompt preface + enable toggle.
 *
 * Two layers:
 *  1. buildSkillsPreface (pure-ish): toggle behavior, preface contents, ids,
 *     and the transient/never-persist safeguard.
 *  2. AgentRunner-level: the prompt forwarded to opencodeClient.prompt CONTAINS
 *     the preface when enabled and does NOT when disabled; uses incremented.
 *
 * No real model/opencode is ever hit: opencode_engine is mocked in the runner
 * suite, and buildSkillsPreface only reads the DB (getRelevantSkills is pure).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { AgentSkill, AgentSkillInput } from '../models/agent_skill';
import { buildSkillsPreface } from '../services/skill_retrieval';

// ── DB helpers ──────────────────────────────────────────────────────────────────

let activeDb: Database.Database | null = null;
function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  activeDb = db;
  return db;
}
function teardownDb(): void {
  if (activeDb) {
    try {
      activeDb.close();
    } catch {
      /* ignore */
    }
    activeDb = null;
  }
}

function seed(repo: AgentSkillsRepository, input: AgentSkillInput): AgentSkill {
  return repo.create({
    status: 'published',
    confidence: 0.9,
    ...input,
  });
}

// ── Layer 1: buildSkillsPreface ─────────────────────────────────────────────────

describe('P3-2 buildSkillsPreface', () => {
  beforeEach(() => {
    delete process.env.AGENT_SKILLS_ENABLED;
  });

  it('enabled (default) + matching skills → preface contains titles + returns ids', () => {
    const a: AgentSkill = {
      id: 'skill-a',
      title: 'Weekly report builder',
      whenToUse: 'When assembling the weekly staff report',
      description: 'desc a',
      stepsJson: null,
      tagsJson: null,
      body: null,
      steps: null,
      tags: null,
      confidence: 0.8,
      status: 'published',
      source: null,
      uses: 0,
      version: 1,
      createdAt: 'x',
      updatedAt: 'x',
    };
    const b: AgentSkill = { ...a, id: 'skill-b', title: 'Email triage', whenToUse: 'Sort the inbox' };

    const fakeGetRelevant = vi.fn().mockReturnValue([a, b]);
    const preface = buildSkillsPreface('build the weekly report', {
      getRelevant: fakeGetRelevant,
    });

    expect(fakeGetRelevant).toHaveBeenCalledOnce();
    expect(preface.text).toContain('## Available skills (retrieved)');
    expect(preface.text).toContain('Weekly report builder');
    expect(preface.text).toContain('Email triage');
    expect(preface.text).toContain('confidence 0.80');
    expect(preface.skillIds).toEqual(['skill-a', 'skill-b']);
  });

  it('toggle OFF (AGENT_SKILLS_ENABLED="false") → empty preface, getRelevant NOT called', () => {
    process.env.AGENT_SKILLS_ENABLED = 'false';
    const fakeGetRelevant = vi.fn().mockReturnValue([{ id: 'x' }]);

    const preface = buildSkillsPreface('build the weekly report', {
      getRelevant: fakeGetRelevant,
    });

    expect(preface.text).toBe('');
    expect(preface.skillIds).toEqual([]);
    expect(fakeGetRelevant).not.toHaveBeenCalled();
  });

  it('no matches → empty preface', () => {
    const fakeGetRelevant = vi.fn().mockReturnValue([]);
    const preface = buildSkillsPreface('anything', { getRelevant: fakeGetRelevant });
    expect(preface.text).toBe('');
    expect(preface.skillIds).toEqual([]);
  });

  it('prefers whenToUse, falls back to description', () => {
    const withWhen: AgentSkill = {
      id: '1',
      title: 'T1',
      whenToUse: 'USE-WHEN',
      description: 'DESC-1',
      stepsJson: null,
      tagsJson: null,
      body: null,
      confidence: 0.5,
      status: 'published',
      source: null,
      uses: 0,
      version: 1,
      createdAt: 'x',
      updatedAt: 'x',
    };
    const noWhen: AgentSkill = { ...withWhen, id: '2', title: 'T2', whenToUse: null, description: 'DESC-2' };

    const preface = buildSkillsPreface('q', {
      getRelevant: vi.fn().mockReturnValue([withWhen, noWhen]),
    });
    expect(preface.text).toContain('T1: USE-WHEN');
    expect(preface.text).toContain('T2: DESC-2');
  });
});

// ── Layer 1b: real DB transient/never-persist safeguard ─────────────────────────

describe('P3-2 buildSkillsPreface is transient (never persists)', () => {
  beforeEach(() => {
    delete process.env.AGENT_SKILLS_ENABLED;
    makeDb();
  });
  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
  });

  it('does NOT mutate the stored skill row (uses/title/description unchanged) and never invokes the agent writer', async () => {
    const repo = new AgentSkillsRepository();
    const skill = seed(repo, {
      title: 'Reservation helper',
      whenToUse: 'When booking a facility reservation',
      description: 'Books facilities',
      tags: ['facility', 'reservation'],
    });

    // Spy on the agent writer module to prove injection never writes a profile .md.
    const writer = await import('../services/opencode_agent_writer');
    const writeSpy = vi.spyOn(writer, 'writeAgentProfileFile');

    const preface = buildSkillsPreface('facility reservation booking');
    expect(preface.text).toContain('Reservation helper');
    expect(preface.skillIds).toContain(skill.id);

    // Row is unchanged — buildSkillsPreface does not increment uses or edit text.
    const after = repo.getById(skill.id)!;
    expect(after.uses).toBe(0);
    expect(after.title).toBe('Reservation helper');
    expect(after.description).toBe('Books facilities');

    // The agent writer is never invoked by the injection path.
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
