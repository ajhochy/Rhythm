/**
 * Tests for skill_extractor.distillFromSession (P2-1 / #949).
 *
 * Two concerns:
 *  1. INJECTED-LLM LOGIC: with a fake `llmCall` (no live model, no network),
 *     verify the round-count gate, JSON parse, confidence floor, dedup, and
 *     draft FILE write (the #949 harvest-to-file path: drafts are written as
 *     SKILL.md under the rhythm-managed-skills drafts namespace, NOT as DB
 *     rows) plus auto-bind to the extracting agent's allowedSkillsJson. To
 *     exercise this logic the isTestEnv() guard must be lifted for these
 *     cases — we clear VITEST/NODE_ENV in beforeEach and restore them in
 *     afterEach. The injected llmCall guarantees the real opencode-backed
 *     default path is never reached, so no model is hit.
 *  2. TEST-ENV GUARD (the key test): with VITEST='true' restored, the default
 *     (real) llmCall must NEVER run and ZERO files/rows are written, even with
 *     >= 2 rounds seeded — proving the isTestEnv() short-circuit.
 *
 * Sessions/messages are seeded into a fresh in-memory migrated DB via setDb()
 * (mirrors other repo tests). agent_session_messages rows are inserted through
 * the AgentSessionMessagesRepository.append() API. Draft files are redirected
 * to a per-test temp dir via RHYTHM_MANAGED_SKILLS_DIR (which
 * rhythm_managed_skills.managedSkillsRoot() honors).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { env } from '../config/env';
import {
  _setCuratorExtractRunning,
  distillFromSession,
  getCuratorExtractStatus,
  type LlmCall,
} from '../services/skill_extractor';
import { draftSkillExists, draftsRoot } from '../services/rhythm_managed_skills';

// #1112 — distillFromSession's gap-write branch dynamically imports
// gap_discovery_scheduler.ts (to avoid a static circular dependency: that
// module imports isEngineColdStart from skill_extractor.ts). Mock it so
// these tests can assert scheduling fired without a real debounce timer.
const mockScheduleGapDrivenDiscovery = vi.fn();
vi.mock('../services/gap_discovery_scheduler', () => ({
  scheduleGapDrivenDiscovery: mockScheduleGapDrivenDiscovery,
}));

const SESSION_ID = 'sess-extract-1';
const AGENT_CONFIG_ID = 'claude-code'; // matches seedSession's agent_kind

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

/**
 * Ensure an agent_configs row exists for AGENT_CONFIG_ID with the given scoped
 * allowedSkillsJson. The migrations already seed a 'claude-code' row, so this
 * upserts (update if present, insert if absent). The session's
 * agent_kind='claude-code' resolves to this profile for auto-bind.
 */
function seedScopedAgentConfig(existingSkills: string[] | null = []): void {
  const configs = new AgentConfigsRepository();
  const existing = configs.getById(AGENT_CONFIG_ID);
  const json = existingSkills === null ? null : JSON.stringify(existingSkills);
  if (existing) {
    configs.update(AGENT_CONFIG_ID, { allowedSkillsJson: json });
  } else {
    configs.insert({
      id: AGENT_CONFIG_ID,
      label: 'Claude Code',
      icon: 'bot',
      allowedSkillsJson: json,
    });
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

// Expected skill name slug derived from the title above.
const EXPECTED_SKILL_NAME = 'rebuild-better-sqlite3-abi';

describe('skill_extractor — injected llmCall logic (guard lifted)', () => {
  // Snapshot + clear the test-env guard so distillFromSession runs its real
  // logic. The injected fake llmCall means no model/network is ever touched.
  let savedVitest: string | undefined;
  let savedNodeEnv: string | undefined;
  let savedManagedDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    _setCuratorExtractRunning(false);
    setDb(makeDb());
    seedSession(SESSION_ID);
    // Redirect the managed-skills root to a per-test temp dir so draft file
    // writes land in a clean, inspectable location.
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-drafts-'));
    savedManagedDir = process.env.RHYTHM_MANAGED_SKILLS_DIR;
    process.env.RHYTHM_MANAGED_SKILLS_DIR = tempDir;
    savedVitest = process.env.VITEST;
    savedNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'development';
    mockScheduleGapDrivenDiscovery.mockClear();
  });

  afterEach(() => {
    _setCuratorExtractRunning(false);
    if (savedVitest === undefined) delete process.env.VITEST;
    else process.env.VITEST = savedVitest;
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedManagedDir === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    else process.env.RHYTHM_MANAGED_SKILLS_DIR = savedManagedDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a draft SKILL.md file (not a DB row) when >= 2 rounds + valid high-confidence JSON', async () => {
    seedRounds(SESSION_ID, 2);
    seedScopedAgentConfig(['existing-skill']);
    const llmCall: LlmCall = async () => VALID_SKILL_JSON;

    const result = await distillFromSession(SESSION_ID, { llmCall });

    // Return shape — synthetic AgentSkill representing the written draft file.
    expect(result).not.toBeNull();
    expect(result?.status).toBe('draft');
    expect(result?.source).toBe('harvested');
    expect(result?.title).toBe('Rebuild better-sqlite3 ABI');
    expect(result?.steps).toEqual(['cd into the package', 'run node-gyp rebuild', 'verify it loads']);
    expect(result?.tags).toEqual(['node', 'native', 'sqlite']);
    expect(result?.confidence).toBe(0.9);
    expect(result?.originLocation).toBe(join(draftsRoot(), EXPECTED_SKILL_NAME, 'SKILL.md'));

    // #949 — the draft is a FILE under the drafts namespace, NOT a DB row.
    expect(draftSkillExists(EXPECTED_SKILL_NAME)).toBe(true);
    const fileContents = readFileSync(
      join(draftsRoot(), EXPECTED_SKILL_NAME, 'SKILL.md'),
      'utf8',
    );
    // Frontmatter carries the harvest metadata.
    expect(fileContents).toContain(`name: ${EXPECTED_SKILL_NAME}`);
    expect(fileContents).toContain('status: draft');
    expect(fileContents).toContain('source: harvested');
    expect(fileContents).toContain('provenance: auto-extract');
    expect(fileContents).toContain(`source_session: ${SESSION_ID}`);
    expect(fileContents).toContain('confidence: 0.9');
    expect(fileContents).toContain('# Rebuild better-sqlite3 ABI');

    // #949 — NO DB row was written (harvest goes to file, not the table).
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
    expect(new AgentSkillsRepository().findByTitle('Rebuild better-sqlite3 ABI')).toBeNull();

    // #949 — auto-bound to the extracting agent's allowedSkillsJson (appended).
    const config = new AgentConfigsRepository().getById(AGENT_CONFIG_ID);
    expect(config?.allowedSkillsJson).not.toBeNull();
    const bound = JSON.parse(config!.allowedSkillsJson!) as string[];
    expect(bound).toContain('existing-skill');
    expect(bound).toContain(EXPECTED_SKILL_NAME);
    expect(getCuratorExtractStatus().running).toBe(false);
  });

  it('#1112 — a genuinely NEW capability-gap schedules a gap-driven discovery pass', async () => {
    seedRounds(SESSION_ID, 2);
    seedScopedAgentConfig(['existing-skill']);
    const llmCall: LlmCall = async () => VALID_SKILL_JSON;

    await distillFromSession(SESSION_ID, { llmCall });

    expect(mockScheduleGapDrivenDiscovery).toHaveBeenCalledTimes(1);
  });

  it('#1112 — a dedup re-ask of the SAME intent (already-open gap) does not re-schedule', async () => {
    seedRounds(SESSION_ID, 2);
    seedScopedAgentConfig(['existing-skill']);
    const llmCall: LlmCall = async () => VALID_SKILL_JSON;

    await distillFromSession(SESSION_ID, { llmCall });
    expect(mockScheduleGapDrivenDiscovery).toHaveBeenCalledTimes(1);

    // A second harvest of the identical intent (same session, seeded fresh
    // below) re-asks the SAME dedup_key — insertIfAbsentAsync returns the
    // existing row unchanged (inserted: false), so scheduling must not fire
    // again even though the gap-write branch itself runs again.
    seedRounds(SESSION_ID, 2);
    await distillFromSession(SESSION_ID, { llmCall });

    expect(mockScheduleGapDrivenDiscovery).toHaveBeenCalledTimes(1);
  });

  it('strips the injected Known context memory preface from the distill transcript', async () => {
    const injectedInput = [
      '## Known context (facts & preferences)',
      '- The user prefers that harvested skills mention standing memory.',
      '- The agent should always preserve this fake preference.',
      '',
      'Please fix the actual websocket persistence bug.',
    ].join('\n');
    const msgRepo = new AgentSessionMessagesRepository();
    msgRepo.append(SESSION_ID, 'input', injectedInput, injectedInput);
    msgRepo.append(SESSION_ID, 'output', 'I inspected the gateway.', 'I inspected the gateway.');
    msgRepo.append(SESSION_ID, 'input', 'Now add the narrow regression test.', 'Now add the narrow regression test.');
    msgRepo.append(SESSION_ID, 'output', 'The scoped fix is ready.', 'The scoped fix is ready.');

    let capturedUserContent = '';
    const llmCall: LlmCall = async (_systemPrompt, userContent) => {
      capturedUserContent = userContent;
      return 'null';
    };

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    expect(capturedUserContent).toContain('[input] Please fix the actual websocket persistence bug.');
    expect(capturedUserContent).toContain('[input] Now add the narrow regression test.');
    expect(capturedUserContent).not.toContain('## Known context (facts & preferences)');
    expect(capturedUserContent).not.toContain('The user prefers that harvested skills');
    expect(capturedUserContent).not.toContain('The agent should always preserve this fake preference');
  });

  it('skips auto-bind when the extracting agent is unrestricted (allowedSkillsJson === null)', async () => {
    seedRounds(SESSION_ID, 2);
    // Unrestricted agent: null allowedSkillsJson (upsert the seeded 'claude-code').
    seedScopedAgentConfig(null);
    const llmCall: LlmCall = async () => VALID_SKILL_JSON;

    const result = await distillFromSession(SESSION_ID, { llmCall });

    // Draft file still written.
    expect(result).not.toBeNull();
    expect(draftSkillExists(EXPECTED_SKILL_NAME)).toBe(true);

    // But allowedSkillsJson stays null — the draft is already loadable to an
    // unrestricted agent; writing [name] would WRONGLY lock it down.
    const config = new AgentConfigsRepository().getById(AGENT_CONFIG_ID);
    expect(config?.allowedSkillsJson).toBeNull();
  });

  it('returns null and writes nothing when only 1 round', async () => {
    seedRounds(SESSION_ID, 1);
    seedScopedAgentConfig();
    let called = false;
    const llmCall: LlmCall = async () => {
      called = true;
      return VALID_SKILL_JSON;
    };

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    expect(called).toBe(false); // gate short-circuits before the LLM call
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
    expect(draftSkillExists(EXPECTED_SKILL_NAME)).toBe(false);
    expect(getCuratorExtractStatus().running).toBe(false);
  });

  it('clears running state when there are no recent text messages', async () => {
    seedScopedAgentConfig();

    const result = await distillFromSession(SESSION_ID, {
      llmCall: async () => VALID_SKILL_JSON,
    });

    expect(result).toBeNull();
    expect(getCuratorExtractStatus().running).toBe(false);
  });

  it('skips (returns null, no write) when confidence below 0.6', async () => {
    seedRounds(SESSION_ID, 3);
    seedScopedAgentConfig();
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
    expect(draftSkillExists('low-confidence-skill')).toBe(false);
    expect(getCuratorExtractStatus().running).toBe(false);
  });

  it('skips (dedup) when a skill with the same title already exists in the DB', async () => {
    seedRounds(SESSION_ID, 2);
    seedScopedAgentConfig();
    // Pre-create a DB skill with the same title the LLM will return (legacy
    // dedup path — the refiner/findByTitle still checks the DB table).
    new AgentSkillsRepository().create({
      title: 'Rebuild better-sqlite3 ABI',
      description: 'pre-existing',
      status: 'published',
      source: 'manual',
    });
    const llmCall: LlmCall = async () => VALID_SKILL_JSON;

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    // Still only the pre-existing DB row; no new draft row.
    expect(new AgentSkillsRepository().list()).toHaveLength(1);
    expect(new AgentSkillsRepository().findByTitle('Rebuild better-sqlite3 ABI')?.source).toBe('manual');
    // No draft file written either.
    expect(draftSkillExists(EXPECTED_SKILL_NAME)).toBe(false);
    expect(getCuratorExtractStatus().running).toBe(false);
  });

  it('skips (dedup) when a draft file with the same name already exists on disk', async () => {
    seedRounds(SESSION_ID, 2);
    seedScopedAgentConfig();
    // Pre-create a draft file with the same skill name (the #949 file dedup).
    const { writeDraftManagedSkill } = await import('../services/rhythm_managed_skills');
    writeDraftManagedSkill({
      name: EXPECTED_SKILL_NAME,
      description: 'pre-existing draft',
      body: '# Pre-existing\n',
      sourceSessionId: 'other-session',
      confidence: 0.8,
    });
    const llmCall: LlmCall = async () => VALID_SKILL_JSON;

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    // The pre-existing draft file is untouched; no DB row created.
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
    expect(draftSkillExists(EXPECTED_SKILL_NAME)).toBe(true);
    expect(getCuratorExtractStatus().running).toBe(false);
  });

  it("returns null (no throw, no write) when the LLM returns the bare word 'null'", async () => {
    seedRounds(SESSION_ID, 2);
    seedScopedAgentConfig();
    const llmCall: LlmCall = async () => 'null';

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
    expect(draftSkillExists(EXPECTED_SKILL_NAME)).toBe(false);
    expect(getCuratorExtractStatus().running).toBe(false);
  });

  it('returns null (no throw, no write) when the LLM returns garbage', async () => {
    seedRounds(SESSION_ID, 2);
    seedScopedAgentConfig();
    const llmCall: LlmCall = async () => 'I think the answer is somewhere around here, not JSON at all.';

    const result = await distillFromSession(SESSION_ID, { llmCall });

    expect(result).toBeNull();
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
    expect(draftSkillExists(EXPECTED_SKILL_NAME)).toBe(false);
    expect(getCuratorExtractStatus().running).toBe(false);
  });

  it('clears running state when the LLM call throws', async () => {
    seedRounds(SESSION_ID, 2);
    seedScopedAgentConfig();

    const result = await distillFromSession(SESSION_ID, {
      llmCall: async () => {
        throw new Error('contract LLM failure');
      },
    });

    expect(result).toBeNull();
    expect(getCuratorExtractStatus().running).toBe(false);
  });
});

describe('skill_extractor — VITEST guard (default real llmCall)', () => {
  let savedManagedDir: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    _setCuratorExtractRunning(false);
    setDb(makeDb());
    seedSession(SESSION_ID);
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-drafts-'));
    savedManagedDir = process.env.RHYTHM_MANAGED_SKILLS_DIR;
    process.env.RHYTHM_MANAGED_SKILLS_DIR = tempDir;
    // VITEST='true' is set by the runner — assert it, do not toggle it.
    expect(process.env.VITEST).toBe('true');
  });

  afterEach(() => {
    _setCuratorExtractRunning(false);
    if (savedManagedDir === undefined) delete process.env.RHYTHM_MANAGED_SKILLS_DIR;
    else process.env.RHYTHM_MANAGED_SKILLS_DIR = savedManagedDir;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null and writes ZERO rows/files with the default llmCall even with >= 2 rounds', async () => {
    seedRounds(SESSION_ID, 3);

    // No injected llmCall — the default opencode-backed path would run if the
    // guard were absent. isTestEnv() must short-circuit before any LLM/DB/file work.
    const result = await distillFromSession(SESSION_ID);

    expect(result).toBeNull();
    expect(new AgentSkillsRepository().list()).toHaveLength(0);
    expect(existsSync(draftsRoot())).toBe(false);
    expect(getCuratorExtractStatus().running).toBe(false);
  });

  it('returns idle from the postgres guard without starting extraction', async () => {
    const originalDbClient = env.dbClient;
    (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'postgres';
    try {
      const result = await distillFromSession(SESSION_ID, {
        llmCall: async () => VALID_SKILL_JSON,
      });

      expect(result).toBeNull();
      expect(getCuratorExtractStatus().running).toBe(false);
    } finally {
      (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = originalDbClient;
    }
  });
});
