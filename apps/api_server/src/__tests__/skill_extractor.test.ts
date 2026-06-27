/**
 * Tests for skill_extractor.distillFromSession (P2-1).
 *
 * Two concerns:
 *  1. INJECTED-LLM LOGIC: with a fake `llmCall` (no live model, no network),
 *     verify the round-count gate, JSON parse, confidence floor, dedup, and
 *     draft insertion. To exercise this logic the isTestEnv() guard must be
 *     lifted for these cases — we clear VITEST/NODE_ENV in beforeEach and
 *     restore them in afterEach. The injected llmCall guarantees the real
 *     opencode-backed default path is never reached, so no model is hit.
 *  2. TEST-ENV GUARD (the key test): with VITEST='true' restored, the default
 *     (real) llmCall must NEVER run and ZERO rows are written, even with >= 2
 *     rounds seeded — proving the isTestEnv() short-circuit.
 *
 * Sessions/messages are seeded into a fresh in-memory migrated DB via setDb()
 * (mirrors other repo tests). agent_session_messages rows are inserted through
 * the AgentSessionMessagesRepository.append() API.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { distillFromSession, type LlmCall } from '../services/skill_extractor';

const SESSION_ID = 'sess-extract-1';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Insert a parent agent_sessions row so message FK (ON DELETE CASCADE) holds. */
function seedSession(id: string): void {
  getDb()
    .prepare(
      `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name)
       VALUES (?, 'claude-code', 'idle', '/tmp', 'extract-test')`,
    )
    .run(id);
}

/** Seed `rounds` assistant ('output') messages interleaved with user input. */
function seedRounds(sessionId: string, rounds: number): void {
  const msgRepo = new AgentSessionMessagesRepository();
  for (let i = 0; i < rounds; i++) {
    msgRepo.append(sessionId, 'input', `user turn ${i}`, `user turn ${i}`);
    msgRepo.append(sessionId, 'output', `assistant turn ${i}`, `assistant turn ${i}`);
  }
}

const VALID_SKILL_JSON = JSON.stringify({
  title: 'Rebuild better-sqlite3 ABI',
  problem: 'Native module ABI mismatch after a Node upgrade.',
  solution: 'Run node-gyp rebuild against the runtime Node version.',
  steps: ['cd into the package', 'run node-gyp rebuild', 'verify it loads'],
  tags: ['node', 'native', 'sqlite'],
  confidence: 0.9,
});

describe('skill_extractor — injected llmCall logic (guard lifted)', () => {
  // Snapshot + clear the test-env guard so distillFromSession runs its real
  // logic. The injected fake llmCall means no model/network is ever touched.
  let savedVitest: string | undefined;
  let savedNodeEnv: string | undefined;

  beforeEach(() => {
    setDb(makeDb());
    seedSession(SESSION_ID);
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

  it('inserts a draft when >= 2 rounds + valid high-confidence JSON', async () => {
    seedRounds(SESSION_ID, 2);
    const llmCall: LlmCall = async () => VALID_SKILL_JSON;

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('draft');
    expect(result?.source).toBe('auto-extract');
    expect(result?.title).toBe('Rebuild better-sqlite3 ABI');
    expect(result?.steps).toEqual(['cd into the package', 'run node-gyp rebuild', 'verify it loads']);
    expect(result?.tags).toEqual(['node', 'native', 'sqlite']);
    expect(result?.confidence).toBe(0.9);

    // Persisted and round-trips through the repo.
    const persisted = new AgentSkillsRepository().findByTitle('Rebuild better-sqlite3 ABI');
    expect(persisted).not.toBeNull();
    expect(persisted?.steps).toEqual(['cd into the package', 'run node-gyp rebuild', 'verify it loads']);
    expect(persisted?.tags).toEqual(['node', 'native', 'sqlite']);
    expect(new AgentSkillsRepository().list()).toHaveLength(1);
  });

  it('returns null and inserts nothing when only 1 round', async () => {
    seedRounds(SESSION_ID, 1);
    let called = false;
    const llmCall: LlmCall = async () => {
      called = true;
      return VALID_SKILL_JSON;
    };

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    expect(called).toBe(false); // gate short-circuits before the LLM call
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
  });

  it('skips (returns null, no insert) when confidence below 0.6', async () => {
    seedRounds(SESSION_ID, 3);
    const lowConf = JSON.stringify({
      title: 'Low confidence skill',
      problem: 'p',
      solution: 's',
      steps: ['a', 'b', 'c'],
      tags: ['x'],
      confidence: 0.4,
    });
    const llmCall: LlmCall = async () => lowConf;

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
  });

  it('skips (dedup) when a skill with the same title already exists', async () => {
    seedRounds(SESSION_ID, 2);
    // Pre-create a skill with the same title the LLM will return.
    new AgentSkillsRepository().create({
      title: 'Rebuild better-sqlite3 ABI',
      description: 'pre-existing',
      status: 'published',
      source: 'manual',
    });
    const llmCall: LlmCall = async () => VALID_SKILL_JSON;

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    // Still only the pre-existing row; no second draft inserted.
    expect(new AgentSkillsRepository().list()).toHaveLength(1);
    expect(new AgentSkillsRepository().findByTitle('Rebuild better-sqlite3 ABI')?.source).toBe('manual');
  });

  it("returns null (no throw, no insert) when the LLM returns the bare word 'null'", async () => {
    seedRounds(SESSION_ID, 2);
    const llmCall: LlmCall = async () => 'null';

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
  });

  it('returns null (no throw, no insert) when the LLM returns garbage', async () => {
    seedRounds(SESSION_ID, 2);
    const llmCall: LlmCall = async () => 'I think the answer is somewhere around here, not JSON at all.';

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
  });
});

describe('skill_extractor — VITEST guard (default real llmCall)', () => {
  beforeEach(() => {
    setDb(makeDb());
    seedSession(SESSION_ID);
    // VITEST='true' is set by the runner — assert it, do not toggle it.
    expect(process.env.VITEST).toBe('true');
  });

  it('returns null and writes ZERO rows with the default llmCall even with >= 2 rounds', async () => {
    seedRounds(SESSION_ID, 3);

    // No injected llmCall — the default opencode-backed path would run if the
    // guard were absent. isTestEnv() must short-circuit before any LLM/DB work.
    const result = await distillFromSession(SESSION_ID);

    expect(result).toBeNull();
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
  });
});
