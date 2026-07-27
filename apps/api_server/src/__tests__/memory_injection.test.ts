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
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import {
  buildMemoryPreface,
  getRelevantMemories,
} from '../services/memory_retrieval';
import { agentMemoryService } from '../services/agentMemoryService';

// ── DB helpers ──────────────────────────────────────────────────────────────────

let activeDb: Database.Database | null = null;
const linkVaultRoots: string[] = [];

function memoryDirWithNotes(sourceIds: string[]): string {
  const root = mkdtempSync(path.join(tmpdir(), 'memory-expansion-'));
  linkVaultRoots.push(root);
  for (const sourceId of sourceIds) {
    const abs = path.join(root, sourceId);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, '---\nkind: fact\n---\nLink target.', 'utf8');
  }
  const memoryDir = path.join(root, 'memory');
  mkdirSync(memoryDir, { recursive: true });
  return memoryDir;
}

afterEach(() => {
  while (linkVaultRoots.length > 0) {
    rmSync(linkVaultRoots.pop()!, { recursive: true, force: true });
  }
});

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
    status: 'stable',
    staleAfter: null,
    verifiedJson: '[]',
    sourcesJson: '[]',
    generatedBy: null,
    generatedAt: null,
    trustTier: 'unverified',
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
    delete process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED;
  });
  afterEach(() => {
    delete process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED;
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
    expect(preface.text).toBe([
      '## Known context (facts & preferences)',
      '- The senior pastor prefers Tuesday meetings',
      '- Budget approvals go through the elder board',
    ].join('\n'));
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

  it('defensively excludes inactive rows returned by a custom retrieval hook', async () => {
    const fakeGetRelevant = vi.fn().mockResolvedValue([
      mem({ id: 'stale', content: 'Expired detail', staleAfter: '2000-01-01' }),
      mem({ id: 'deprecated', content: 'Deprecated detail', status: 'deprecated' }),
      mem({ id: 'live', content: 'Current detail' }),
    ]);

    await expect(buildMemoryPreface('q', 1, { getRelevant: fakeGetRelevant }))
      .resolves.toEqual({
        text: '## Known context (facts & preferences)\n- Current detail',
        memoryIds: ['live'],
        notePaths: [null],
      });
  });

  it('#1195: expansion is default-off and performs no linked-row lookup', async () => {
    const direct = mem({
      id: 'direct',
      content: 'Direct detail. [Linked](/person/linked.md)',
      source: 'obsidian-memory',
      sourceId: 'memory/fact/direct.md',
      ownerUserId: 1,
    });
    const linkRepository = {
      searchAsync: vi.fn(),
      findBySourceIdsAsync: vi.fn(),
    };

    const preface = await buildMemoryPreface('detail', 1, {
      getRelevant: vi.fn().mockResolvedValue([direct]),
      linkRepository,
      memoryDir: '/vault/memory',
    });

    expect(preface).toEqual({
      text: [
        '## Known context (facts & preferences)',
        '- Direct detail. [Linked](/person/linked.md)',
      ].join('\n'),
      memoryIds: ['direct'],
      notePaths: ['memory/fact/direct.md'],
    });
    expect(linkRepository.findBySourceIdsAsync).not.toHaveBeenCalled();
  });

  it('#1195: one-hop expansion fills topN while re-gating owner and lifecycle', async () => {
    process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED = 'true';
    const direct = mem({
      id: 'direct',
      content: [
        'Direct detail.',
        '[Linked](/person/linked.md)',
        '[Stale](/person/stale.md)',
        '[Deprecated](/person/deprecated.md)',
        '[Private](/person/private.md)',
      ].join(' '),
      source: 'obsidian-memory',
      sourceId: 'memory/fact/direct.md',
      ownerUserId: 1,
    });
    const linked = mem({
      id: 'linked',
      content: 'Linked detail. [Third](/person/third.md)',
      source: 'obsidian-memory',
      sourceId: 'memory/person/linked.md',
      ownerUserId: 1,
    });
    const stale = mem({
      id: 'stale',
      content: 'Stale detail',
      source: 'obsidian-memory',
      sourceId: 'memory/person/stale.md',
      staleAfter: '2000-01-01',
      ownerUserId: 1,
    });
    const otherOwner = mem({
      id: 'private',
      content: 'Bob private detail',
      source: 'obsidian-memory',
      sourceId: 'memory/person/private.md',
      ownerUserId: 2,
    });
    const deprecated = mem({
      id: 'deprecated',
      content: 'Deprecated detail',
      source: 'obsidian-memory',
      sourceId: 'memory/person/deprecated.md',
      status: 'deprecated',
      ownerUserId: 1,
    });
    const third = mem({
      id: 'third',
      content: 'A second hop that must not appear',
      source: 'obsidian-memory',
      sourceId: 'memory/person/third.md',
      ownerUserId: 1,
    });
    const linkRepository = {
      searchAsync: vi.fn(),
      findBySourceIdsAsync: vi.fn().mockResolvedValue([
        otherOwner,
        stale,
        deprecated,
        linked,
        third,
      ]),
    };
    const memoryDir = memoryDirWithNotes([
      'memory/person/linked.md',
      'memory/person/stale.md',
      'memory/person/deprecated.md',
      'memory/person/private.md',
    ]);

    const preface = await buildMemoryPreface('detail', 1, {
      topN: 3,
      getRelevant: vi.fn().mockResolvedValue([direct]),
      linkRepository,
      memoryDir,
    });

    expect(linkRepository.findBySourceIdsAsync).toHaveBeenCalledWith(
      'obsidian-memory',
      [
        'memory/person/linked.md',
        'memory/person/stale.md',
        'memory/person/deprecated.md',
        'memory/person/private.md',
      ],
      1,
    );
    expect(preface.memoryIds).toEqual(['direct', 'linked']);
    expect(preface.text).toContain('Linked detail.');
    expect(preface.text).not.toContain('Stale detail');
    expect(preface.text).not.toContain('Deprecated detail');
    expect(preface.text).not.toContain('Bob private detail');
    expect(preface.text).not.toContain('A second hop');
  });

  it('#1195: ignores a stale index row after its linked file is deleted', async () => {
    process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED = 'true';
    const direct = mem({
      id: 'direct',
      content: 'Direct detail. [Deleted](/person/deleted.md)',
      source: 'obsidian-memory',
      sourceId: 'memory/fact/direct.md',
      ownerUserId: 1,
    });
    const linkRepository = {
      searchAsync: vi.fn(),
      findBySourceIdsAsync: vi.fn().mockResolvedValue([
        mem({
          id: 'deleted',
          content: 'Deleted linked content',
          source: 'obsidian-memory',
          sourceId: 'memory/person/deleted.md',
          ownerUserId: 1,
        }),
      ]),
    };
    const memoryDir = memoryDirWithNotes([]);

    const preface = await buildMemoryPreface('detail', 1, {
      topN: 2,
      getRelevant: vi.fn().mockResolvedValue([direct]),
      linkRepository,
      memoryDir,
    });

    expect(preface.memoryIds).toEqual(['direct']);
    expect(preface.text).not.toContain('Deleted linked content');
    expect(linkRepository.findBySourceIdsAsync).not.toHaveBeenCalled();
  });

  it('#1195: batches linked lookups and keeps scanning until topN is filled', async () => {
    process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED = 'true';
    const sourceIds = Array.from(
      { length: 201 },
      (_, index) => `memory/person/linked-${index}.md`,
    );
    const direct = mem({
      id: 'direct',
      content: sourceIds
        .map((sourceId, index) =>
          `[Linked ${index}](/person/${path.basename(sourceId)})`,
        )
        .join(' '),
      source: 'obsidian-memory',
      sourceId: 'memory/fact/direct.md',
      ownerUserId: 1,
    });
    const stale = mem({
      id: 'stale',
      content: 'Stale first-batch content',
      source: 'obsidian-memory',
      sourceId: sourceIds[0],
      staleAfter: '2000-01-01',
      ownerUserId: 1,
    });
    const late = mem({
      id: 'late',
      content: 'Late active content',
      source: 'obsidian-memory',
      sourceId: sourceIds[200],
      ownerUserId: 1,
    });
    const linkRepository = {
      searchAsync: vi.fn(),
      findBySourceIdsAsync: vi.fn().mockImplementation(
        async (_source: string, batch: string[]) =>
          batch.includes(sourceIds[200]) ? [late] : [stale],
      ),
    };
    const memoryDir = memoryDirWithNotes(sourceIds);

    const preface = await buildMemoryPreface('detail', 1, {
      topN: 2,
      getRelevant: vi.fn().mockResolvedValue([direct]),
      linkRepository,
      memoryDir,
    });

    expect(preface.memoryIds).toEqual(['direct', 'late']);
    expect(linkRepository.findBySourceIdsAsync).toHaveBeenCalledTimes(2);
    for (const call of linkRepository.findBySourceIdsAsync.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(200);
    }
  });
});

// ── Layer 1b: real DB — owner scoping (the CRITICAL cross-user-leak guard) ───────

describe('memory injection — getRelevantMemories is OWNER-SCOPED (no cross-user leak)', () => {
  beforeEach(() => {
    delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
    delete process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED;
    makeDb();
  });
  afterEach(() => {
    delete process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED;
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

  it('#1195: a link cannot expand owner B memory into owner A preface', async () => {
    process.env.AGENT_MEMORY_LINK_EXPANSION_ENABLED = 'true';
    const repo = new AgentMemoryRepository();
    const direct = await repo.createAsync({
      content: 'Alice direct context. [Private](/person/private.md)',
      source: 'obsidian-memory',
      sourceId: 'memory/fact/direct.md',
      ownerUserId: 1,
    });
    await repo.createAsync({
      content: 'Bob private linked content',
      source: 'obsidian-memory',
      sourceId: 'memory/person/private.md',
      ownerUserId: 2,
    });
    const memoryDir = memoryDirWithNotes(['memory/person/private.md']);

    const preface = await buildMemoryPreface('direct', 1, {
      topN: 3,
      getRelevant: vi.fn().mockResolvedValue([direct]),
      linkRepository: repo,
      memoryDir,
    });

    expect(preface.memoryIds).toEqual([direct.id]);
    expect(preface.text).toContain('Alice direct context');
    expect(preface.text).not.toContain('Bob private linked content');
  });

  it('null/unknown owner retrieves ONLY instance-global (null-owner) memory — never a user-owned fact', async () => {
    const repo = new AgentMemoryRepository();
    await repo.createAsync({ content: 'Global policy: standups are optional', ownerUserId: undefined });
    await repo.createAsync({ content: 'Alice private standup note', ownerUserId: 1 });

    const forUnknown = await getRelevantMemories('standups', null);
    expect(forUnknown.map((m) => m.content)).toEqual(['Global policy: standups are optional']);
    expect(forUnknown.some((m) => m.content.includes('Alice'))).toBe(false);
  });

  it('retrieves a null-owner memory queried with a hyphenated fresh FTS marker', async () => {
    const repo = new AgentMemoryRepository();
    const marker = `fresh-fts-${randomUUID()}`;
    const created = await repo.createAsync({ content: marker, ownerUserId: undefined });

    const matches = await getRelevantMemories(marker, null);

    expect(matches.map(({ id }) => id)).toContain(created.id);
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

  it('filters in SQL before LIMIT so inactive rows do not consume live slots', async () => {
    const repo = new AgentMemoryRepository();
    const marker = `replacement${randomUUID().replaceAll('-', '')}`;
    const rows = [];
    for (let index = 0; index < 8; index += 1) {
      rows.push(await repo.createAsync({
        content: `${marker} candidate ${index}`,
        ownerUserId: undefined,
      }));
    }
    activeDb!.prepare(
      `UPDATE agent_memory SET status = 'deprecated' WHERE id = ?`,
    ).run(rows[0].id);
    activeDb!.prepare(
      `UPDATE agent_memory SET stale_after = '2000-01-01' WHERE id = ?`,
    ).run(rows[1].id);

    const matches = await getRelevantMemories(marker, null, 5, repo);
    expect(matches).toHaveLength(5);
    expect(matches.map(({ id }) => id)).not.toContain(rows[0].id);
    expect(matches.map(({ id }) => id)).not.toContain(rows[1].id);
  });

  it('keeps inactive rows visible to explicit MCP-backed search', async () => {
    const repo = new AgentMemoryRepository();
    const marker = `explicit${randomUUID().replaceAll('-', '')}`;
    const deprecated = await repo.createAsync({
      content: `${marker} deprecated`,
      ownerUserId: undefined,
    });
    const stale = await repo.createAsync({
      content: `${marker} stale`,
      ownerUserId: undefined,
    });
    activeDb!.prepare(
      `UPDATE agent_memory SET status = 'deprecated' WHERE id = ?`,
    ).run(deprecated.id);
    activeDb!.prepare(
      `UPDATE agent_memory SET stale_after = '2000-01-01' WHERE id = ?`,
    ).run(stale.id);

    // rhythm_search_memory calls agentMemoryService.search, which intentionally
    // leaves the repository's activeOnly option unset.
    const explicit = await agentMemoryService.search(marker, undefined, 20);
    expect(new Set(explicit.map(({ id }) => id))).toEqual(
      new Set([deprecated.id, stale.id]),
    );
    await expect(getRelevantMemories(marker, null, 5, repo))
      .resolves.toEqual([]);
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
