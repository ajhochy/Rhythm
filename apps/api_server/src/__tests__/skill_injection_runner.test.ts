/**
 * P3-2 — AgentRunner-level skill-injection behavior.
 *
 * Mocks opencode_engine so no real model is hit, seeds the in-memory DB with a
 * matching skill, and asserts:
 *   • enabled (default) → the prompt forwarded to opencodeClient.prompt CONTAINS
 *     the retrieved-skills preface (the original user prompt is still appended);
 *   • disabled (AGENT_SKILLS_ENABLED='false') → forwarded prompt is unchanged
 *     (no preface) and no uses are incremented;
 *   • enabled → each injected skill's `uses` is incremented by exactly 1
 *     (multiple skills → all incremented).
 *
 * Kept in its own file because the opencode_engine module mock is hoisted
 * file-wide (mirrors P2-2's skill_extractor_wiring_runner.test.ts split).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import type { AgentSkillInput } from '../models/agent_skill';

// ── opencode_engine mock so nothing real launches ──────────────────────────────

const { mockCreateSession, mockPrompt, mockAbortSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
  mockPrompt: vi.fn(),
  mockAbortSession: vi.fn(),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    get isReady() {
      return true;
    },
    createSession: mockCreateSession,
    prompt: mockPrompt,
    abortSession: mockAbortSession,
    listMessages: vi.fn().mockResolvedValue([]),
  },
  opencodeSessionMap: new Map<string, string>(),
}));

// ── DB helpers ──────────────────────────────────────────────────────────────────

let activeDb: Database.Database | null = null;
function makeDb(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);
  activeDb = db;
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

function seed(repo: AgentSkillsRepository, input: AgentSkillInput): string {
  return repo.create({ status: 'published', confidence: 0.9, ...input }).id;
}

const PROMPT = 'help me build the weekly staff report';

describe('P3-2 — AgentRunner injects the skills preface (env-toggled)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_SKILLS_ENABLED;
    makeDb();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-1' });
    mockPrompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-1' },
      parts: [{ type: 'text', text: 'Done' }],
    });
    mockAbortSession.mockResolvedValue(true);
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
    delete process.env.AGENT_SKILLS_ENABLED;
  });

  // The injection gate (isSkillInjectionEnabled) reads process.env live, so no
  // module reset is needed — a single import shares the global DB set by makeDb().
  async function freshRun() {
    const { run } = await import('../services/agent_runner');
    return run;
  }

  it('enabled (default) → forwarded prompt CONTAINS the preface; original prompt preserved', async () => {
    const repo = new AgentSkillsRepository();
    seed(repo, {
      title: 'Weekly report builder',
      whenToUse: 'When assembling the weekly staff report',
      description: 'Builds the weekly report',
      tags: ['weekly', 'report'],
    });

    const run = await freshRun();
    const result = await run({ prompt: PROMPT });

    expect(result.status).toBe('done');
    expect(mockPrompt).toHaveBeenCalledOnce();
    const forwarded = mockPrompt.mock.calls[0][1] as string;
    expect(forwarded).toContain('## Available skills (retrieved)');
    expect(forwarded).toContain('Weekly report builder');
    // Original user prompt is still present (appended after the preface).
    expect(forwarded).toContain(PROMPT);
  });

  it('disabled (AGENT_SKILLS_ENABLED="false") → forwarded prompt is unchanged; no uses bump', async () => {
    process.env.AGENT_SKILLS_ENABLED = 'false';
    const repo = new AgentSkillsRepository();
    const id = seed(repo, {
      title: 'Weekly report builder',
      whenToUse: 'When assembling the weekly staff report',
      description: 'Builds the weekly report',
      tags: ['weekly', 'report'],
    });

    const run = await freshRun();
    const result = await run({ prompt: PROMPT });

    expect(result.status).toBe('done');
    const forwarded = mockPrompt.mock.calls[0][1] as string;
    expect(forwarded).toBe(PROMPT);
    expect(forwarded).not.toContain('Available skills');

    // No uses incremented when disabled.
    expect(repo.getById(id)!.uses).toBe(0);
  });

  it('enabled → each injected skill uses incremented by exactly 1', async () => {
    const repo = new AgentSkillsRepository();
    const id = seed(repo, {
      title: 'Weekly report builder',
      whenToUse: 'When assembling the weekly staff report',
      description: 'Builds the weekly report',
      tags: ['weekly', 'report'],
    });

    const run = await freshRun();
    await run({ prompt: PROMPT });

    expect(repo.getById(id)!.uses).toBe(1);
  });

  it('multiple matching skills → all uses incremented by exactly 1', async () => {
    const repo = new AgentSkillsRepository();
    const idA = seed(repo, {
      title: 'Weekly report builder',
      whenToUse: 'When assembling the weekly staff report',
      description: 'Builds the weekly report',
      tags: ['weekly', 'report'],
    });
    const idB = seed(repo, {
      title: 'Report formatter',
      whenToUse: 'Format the weekly report nicely',
      description: 'Formats the weekly report output',
      tags: ['report', 'format'],
    });

    const run = await freshRun();
    await run({ prompt: PROMPT });

    expect(repo.getById(idA)!.uses).toBe(1);
    expect(repo.getById(idB)!.uses).toBe(1);
  });
});

// ── P1b: runner path allowlist filter ──────────────────────────────────────────

describe('runner path allowlist (P1b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_SKILLS_ENABLED;
    makeDb();
    mockCreateSession.mockResolvedValue({ id: 'sdk-session-1' });
    mockPrompt.mockResolvedValue({
      info: { sessionID: 'sdk-session-1' },
      parts: [{ type: 'text', text: 'Done' }],
    });
    mockAbortSession.mockResolvedValue(true);
  });

  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
    delete process.env.AGENT_SKILLS_ENABLED;
  });

  async function freshRun() {
    const { run } = await import('../services/agent_runner');
    return run;
  }

  it('runner passes allowedSkillsJson from profile scope to buildSkillsPreface — out-of-allowlist skill excluded', async () => {
    const repo = new AgentSkillsRepository();
    // Seed TWO skills — idA is the high-scorer for PROMPT; idB is the non-scorer
    // The allowlist only includes idB, so idA must NOT appear in the forwarded prompt.
    const idA = seed(repo, {
      title: 'Weekly report builder',
      whenToUse: 'When assembling the weekly staff report',
      description: 'Builds the weekly report',
      tags: ['weekly', 'report'],
    });
    const idB = seed(repo, {
      title: 'Email triage',
      whenToUse: 'Sort incoming emails quickly',
      description: 'Sorts the inbox',
      tags: ['email'],
    });

    // Mock resolveProfileScope so the runner receives an allowlist for only idB.
    const scopeModule = await import('../services/agent_profile_scope');
    vi.spyOn(scopeModule, 'resolveProfileScope').mockResolvedValue({
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
      mcpRoleConfig: null,
      allowedSkillsJson: JSON.stringify([idB]),
      systemPrompt: null,
      ocAgent: null,
    });

    const run = await freshRun();
    const result = await run({ prompt: PROMPT });

    expect(result.status).toBe('done');
    expect(mockPrompt).toHaveBeenCalledOnce();
    const forwarded = mockPrompt.mock.calls[0][1] as string;
    // idA (Weekly report builder) would normally score highly but is NOT in the allowlist.
    expect(forwarded).not.toContain('Weekly report builder');
    // The forwarded prompt must still contain the original user prompt.
    expect(forwarded).toContain(PROMPT);

    void idA; // idA is used by the DB seed; suppress unused warning
  });
});
