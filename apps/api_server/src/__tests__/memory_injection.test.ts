/**
 * FOLLOW-UP (memory injection) — owner-scoped retrieval + transient preface.
 *
 * Two layers (mirrors P3-2 skill_injection.test.ts):
 *  1. buildMemoryPreface / getRelevantMemories: toggle behavior, preface
 *     contents/ids, the OWNER-SCOPING (cross-user-leak) guard, empty store, and
 *     the transient/never-persist safeguard (writeAgentProfileFile NOT called).
 *
 * No real model/opencode is ever hit. getRelevantMemories hits a real in-memory
 * SQLite DB through AgentMemoryRepository.searchAsync (FTS5 + owner filter).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import {
  buildMemoryPreface,
  getRelevantMemories,
} from '../services/memory_retrieval';

// ── DB helpers ──────────────────────────────────────────────────────────────────

let activeDb: Database.Database | null = null;
function makeDb(): void {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  // agent_memory.owner_user_id REFERENCES users(id) — seed the owners we use so
  // the FK constraint is satisfiable for owner-scoped rows.
  db.prepare(`INSERT INTO users (id, name, email) VALUES (?,?,?)`).run(1, 'Alice', 'alice@example.com');
  db.prepare(`INSERT INTO users (id, name, email) VALUES (?,?,?)`).run(2, 'Bob', 'bob@example.com');
  db.prepare(`INSERT INTO users (id, name, email) VALUES (?,?,?)`).run(5, 'Carol', 'carol@example.com');
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

function mem(over: Partial<AgentMemory>): AgentMemory {
  return {
    id: 'm-x',
    kind: 'fact',
    content: 'some content',
    source: null,
    sourceId: null,
    tagsJson: '[]',
    ownerUserId: null,
    createdAt: 'x',
    updatedAt: 'x',
    ...over,
  };
}

// ── Layer 1: buildMemoryPreface (toggle + format) with injected retrieval ───────

describe('memory injection — buildMemoryPreface (toggle + format)', () => {
  beforeEach(() => {
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
  });

  it('enabled (default) + matching memory → preface contains "Known context" + the memory content + ids', async () => {
    const a = mem({ id: 'mem-a', content: 'The senior pastor prefers Tuesday meetings' });
    const b = mem({ id: 'mem-b', content: 'Budget approvals go through the elder board' });
    const fakeGetRelevant = vi.fn().mockResolvedValue([a, b]);

    const preface = await buildMemoryPreface('when should we schedule the meeting', 7, {
      getRelevant: fakeGetRelevant,
    });

    expect(fakeGetRelevant).toHaveBeenCalledOnce();
    // owner threaded straight through to retrieval
    expect(fakeGetRelevant).toHaveBeenCalledWith('when should we schedule the meeting', 7, 5);
    expect(preface.text).toContain('## Known context (facts & preferences)');
    expect(preface.text).toContain('The senior pastor prefers Tuesday meetings');
    expect(preface.text).toContain('Budget approvals go through the elder board');
    expect(preface.memoryIds).toEqual(['mem-a', 'mem-b']);
  });

  it('toggle OFF (AGENT_MEMORY_INJECTION_ENABLED="false") → empty preface, retrieval NOT called', async () => {
    process.env.AGENT_MEMORY_INJECTION_ENABLED = 'false';
    const fakeGetRelevant = vi.fn().mockResolvedValue([mem({ id: 'x' })]);

    const preface = await buildMemoryPreface('anything', 1, {
      getRelevant: fakeGetRelevant,
    });

    expect(preface.text).toBe('');
    expect(preface.memoryIds).toEqual([]);
    expect(fakeGetRelevant).not.toHaveBeenCalled();
  });

  it('no matches → empty preface', async () => {
    const fakeGetRelevant = vi.fn().mockResolvedValue([]);
    const preface = await buildMemoryPreface('q', 1, { getRelevant: fakeGetRelevant });
    expect(preface.text).toBe('');
    expect(preface.memoryIds).toEqual([]);
  });

  it('retrieval throwing → empty preface (never-throws backstop)', async () => {
    const fakeGetRelevant = vi.fn().mockRejectedValue(new Error('db down'));
    const preface = await buildMemoryPreface('q', 1, { getRelevant: fakeGetRelevant });
    expect(preface.text).toBe('');
    expect(preface.memoryIds).toEqual([]);
  });
});

// ── Layer 1b: real DB — owner scoping (the CRITICAL cross-user-leak guard) ───────

describe('memory injection — getRelevantMemories is OWNER-SCOPED (no cross-user leak)', () => {
  beforeEach(() => {
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
    makeDb();
  });
  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
  });

  it("owner B's memory is NOT retrieved for owner A's run — and vice versa", async () => {
    const repo = new AgentMemoryRepository();
    await repo.createAsync({ content: 'Alice prefers morning standups', ownerUserId: 1 });
    await repo.createAsync({ content: 'Bob prefers afternoon standups', ownerUserId: 2 });

    // Owner A (user 1) querying for "standups" must see ONLY Alice's row.
    const forA = await getRelevantMemories('standups', 1);
    expect(forA.map((m) => m.content)).toEqual(['Alice prefers morning standups']);
    expect(forA.some((m) => m.content.includes('Bob'))).toBe(false);

    // Owner B (user 2) must see ONLY Bob's row.
    const forB = await getRelevantMemories('standups', 2);
    expect(forB.map((m) => m.content)).toEqual(['Bob prefers afternoon standups']);
    expect(forB.some((m) => m.content.includes('Alice'))).toBe(false);
  });

  it('null/unknown owner retrieves ONLY instance-global (null-owner) memory — never a user-owned fact', async () => {
    const repo = new AgentMemoryRepository();
    await repo.createAsync({ content: 'Global policy: standups are optional', ownerUserId: undefined });
    await repo.createAsync({ content: 'Alice private standup note', ownerUserId: 1 });

    const forUnknown = await getRelevantMemories('standups', null);
    expect(forUnknown.map((m) => m.content)).toEqual(['Global policy: standups are optional']);
    expect(forUnknown.some((m) => m.content.includes('Alice'))).toBe(false);
  });

  it('empty / whitespace query → no retrieval', async () => {
    const repo = new AgentMemoryRepository();
    await repo.createAsync({ content: 'anything', ownerUserId: 1 });
    expect(await getRelevantMemories('', 1)).toEqual([]);
    expect(await getRelevantMemories('   ', 1)).toEqual([]);
  });

  it('empty store → no preface, no error', async () => {
    const preface = await buildMemoryPreface('standups', 1);
    expect(preface.text).toBe('');
    expect(preface.memoryIds).toEqual([]);
  });
});

// ── Layer 1c: transient / never-persist safeguard ───────────────────────────────

describe('memory injection — buildMemoryPreface is transient (never persists)', () => {
  beforeEach(() => {
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
    makeDb();
  });
  afterEach(() => {
    teardownDb();
    vi.restoreAllMocks();
  });

  it('does NOT mutate the stored memory row and never invokes the agent writer', async () => {
    const repo = new AgentMemoryRepository();
    const created = await repo.createAsync({
      content: 'The worship team rehearses Thursdays at 7pm',
      ownerUserId: 5,
    });

    // Spy on the agent writer to prove injection never writes a profile .md.
    const writer = await import('../services/opencode_agent_writer');
    const writeSpy = vi.spyOn(writer, 'writeAgentProfileFile');

    // Query shares exact FTS tokens with the stored content ("worship", "team").
    const preface = await buildMemoryPreface('what does the worship team do', 5);
    expect(preface.text).toContain('The worship team rehearses Thursdays at 7pm');
    expect(preface.memoryIds).toContain(created.id);

    // Row is unchanged — content/owner identical, nothing edited.
    const after = await repo.findByIdAsync(created.id);
    expect(after?.content).toBe('The worship team rehearses Thursdays at 7pm');
    expect(after?.ownerUserId).toBe(5);

    // The agent writer is never invoked by the injection path.
    expect(writeSpy).not.toHaveBeenCalled();
  });
});
