/**
 * FOLLOW-UP (memory injection) — AgentRunner-level memory-injection behavior.
 *
 * Mocks opencode_engine so no real model is hit, seeds the in-memory DB with
 * owner-scoped memories, and asserts:
 *   • enabled (default) → the prompt forwarded to opencodeClient.prompt CONTAINS
 *     the owner's "Known context" preface (original prompt still appended);
 *   • THE CRITICAL cross-user-leak test — a run owned by user A injects user A's
 *     memory but NOT user B's;
 *   • disabled (AGENT_MEMORY_INJECTION_ENABLED='false') → forwarded prompt
 *     unchanged (no preface);
 *   • empty store → no preface, no error, run still succeeds;
 *   • memory injection coexists with skills injection (both prefaces present).
 *
 * Kept in its own file because the opencode_engine module mock is hoisted
 * file-wide (mirrors P3-2's skill_injection_runner.test.ts split).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
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
  // agent_memory.owner_user_id REFERENCES users(id) — seed the owners we use.
  db.prepare(`INSERT INTO users (id, name, email) VALUES (?,?,?)`).run(1, 'Alice', 'alice@example.com');
  db.prepare(`INSERT INTO users (id, name, email) VALUES (?,?,?)`).run(2, 'Bob', 'bob@example.com');
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

// NB: contains the exact FTS token "standups" so it matches the seeded memory
// content ("... prefers morning standups"). FTS5 tokenizes on exact words, so a
// singular "standup" would NOT match the plural "standups".
const PROMPT = 'remind me about the standups preferences';

describe('memory injection — AgentRunner injects owner-scoped memory preface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
    // Disable skills injection here so the memory assertions are isolated
    // (a dedicated coexistence test re-enables both).
    process.env.AGENT_SKILLS_ENABLED = 'false';
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
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
    delete process.env.AGENT_SKILLS_ENABLED;
  });

  async function freshRun() {
    const { run } = await import('../services/agent_runner');
    return run;
  }

  it('enabled (default) → forwarded prompt CONTAINS the owner memory preface; original prompt preserved', async () => {
    const repo = new AgentMemoryRepository();
    await repo.createAsync({ content: 'Alice standups preference is morning', ownerUserId: 1 });

    const run = await freshRun();
    const result = await run({ prompt: PROMPT, ownerUserId: 1 });

    expect(result.status).toBe('done');
    expect(mockPrompt).toHaveBeenCalledOnce();
    const forwarded = mockPrompt.mock.calls[0][1] as string;
    const opts = mockPrompt.mock.calls[0][4] as { system?: string };
    expect(forwarded).toBe(PROMPT);
    expect(opts.system).toContain('## Known context (facts & preferences)');
    expect(opts.system).toContain('Alice standups preference is morning');
  });

  // ── THE CRITICAL cross-user-leak test ──────────────────────────────────────
  it("owner B's memory is NOT injected into owner A's run", async () => {
    const repo = new AgentMemoryRepository();
    await repo.createAsync({ content: 'Alice standups preference is morning', ownerUserId: 1 });
    await repo.createAsync({ content: 'Bob standups preference is afternoon', ownerUserId: 2 });

    const run = await freshRun();
    await run({ prompt: PROMPT, ownerUserId: 1 });

    const opts = mockPrompt.mock.calls[0][4] as { system?: string };
    expect(opts.system).toContain('Alice standups preference is morning');
    // Bob's fact must NEVER appear in Alice's run.
    expect(opts.system).not.toContain('Bob standups preference is afternoon');
  });

  it('null owner → only instance-global memory injected, never a user-owned fact', async () => {
    const repo = new AgentMemoryRepository();
    await repo.createAsync({ content: 'Global standups preference is optional', ownerUserId: undefined });
    await repo.createAsync({ content: 'Alice private standup note', ownerUserId: 1 });

    const run = await freshRun();
    await run({ prompt: PROMPT }); // no ownerUserId → null

    const opts = mockPrompt.mock.calls[0][4] as { system?: string };
    expect(opts.system).toContain('Global standups preference is optional');
    expect(opts.system).not.toContain('Alice private standup note');
  });

  it('disabled (AGENT_MEMORY_INJECTION_ENABLED="false") → forwarded prompt is unchanged', async () => {
    process.env.AGENT_MEMORY_INJECTION_ENABLED = 'false';
    const repo = new AgentMemoryRepository();
    await repo.createAsync({ content: 'Alice prefers morning standups', ownerUserId: 1 });

    const run = await freshRun();
    const result = await run({ prompt: PROMPT, ownerUserId: 1 });

    expect(result.status).toBe('done');
    const forwarded = mockPrompt.mock.calls[0][1] as string;
    expect(forwarded).toBe(PROMPT);
    expect(forwarded).not.toContain('Known context');
  });

  it('empty store → no preface, no error, run still succeeds', async () => {
    const run = await freshRun();
    const result = await run({ prompt: PROMPT, ownerUserId: 1 });

    expect(result.status).toBe('done');
    const forwarded = mockPrompt.mock.calls[0][1] as string;
    expect(forwarded).toBe(PROMPT);
    expect(forwarded).not.toContain('Known context');
  });

  it('coexists with skills injection — BOTH prefaces present, original prompt preserved', async () => {
    // Re-enable skills for this test (beforeEach disabled it).
    delete process.env.AGENT_SKILLS_ENABLED;

    const memRepo = new AgentMemoryRepository();
    await memRepo.createAsync({ content: 'Alice standups preference is morning', ownerUserId: 1 });

    const skillRepo = new AgentSkillsRepository();
    const skillInput: AgentSkillInput = {
      title: 'Standup organizer',
      whenToUse: 'When organizing standup preferences',
      description: 'Organizes standup scheduling',
      tags: ['standup', 'preferences'],
      status: 'published',
      confidence: 0.9,
    };
    skillRepo.create(skillInput);

    const run = await freshRun();
    await run({ prompt: PROMPT, ownerUserId: 1 });

    const forwarded = mockPrompt.mock.calls[0][1] as string;
    const opts = mockPrompt.mock.calls[0][4] as { system?: string };
    expect(forwarded).toBe(PROMPT);
    expect(opts.system).toContain('## Known context (facts & preferences)');
    expect(opts.system).toContain('Alice standups preference is morning');
    expect(opts.system).toContain('## Available skills (retrieved)');
    expect(opts.system).toContain('Standup organizer');
  });
});
