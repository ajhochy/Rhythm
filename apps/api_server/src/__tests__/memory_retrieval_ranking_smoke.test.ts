/**
 * Step-1 smoke tests — multi-token FTS ranking for memory injection.
 *
 * Target behavior for `getRelevantMemories` (memory_retrieval.ts):
 *  - Probe EVERY significant prompt token (no early break once topN rows have
 *    accumulated — the old fill-and-break made the prompt's first word fill
 *    the whole preface).
 *  - Score each memory by how many DISTINCT probes returned it; more matched
 *    tokens = more relevant. Ties break by best in-probe rank, then first-seen.
 *  - JUNK SUPPRESSION: when at least one memory matched ≥2 tokens, drop all
 *    single-token matches — a preface with one relevant fact beats five
 *    word-coincidence facts. When nothing matched ≥2 tokens, keep singles
 *    (recall preserved).
 *  - Owner defense-in-depth filtering is unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import { getRelevantMemories } from '../services/memory_retrieval';

function memory(id: string, overrides: Partial<AgentMemory> = {}): AgentMemory {
  return {
    id, kind: 'fact', content: `content ${id}`, source: 'obsidian-memory',
    sourceId: `fact/${id}.md`, tagsJson: '[]', ownerUserId: 1,
    createdAt: 'now', updatedAt: 'now', ...overrides,
  };
}

/** Repo whose searchAsync answers per probe token, ignoring owner/topN args. */
function repoByProbe(map: Record<string, AgentMemory[]>) {
  return {
    searchAsync: vi.fn(async (probe: string) => map[probe] ?? []),
    findBySourceIdsAsync: vi.fn().mockResolvedValue([]),
  };
}

describe('multi-token FTS ranking (step 1 smoke)', () => {
  it('probes every significant token instead of stopping at the first full batch', async () => {
    const gold = memory('gold');
    const repo = repoByProbe({
      checkin: [memory('j1'), memory('j2')],
      process: [gold],
      sunday: [gold],
    });
    // topN=2: the old implementation broke after the first probe filled 2 slots
    // and never discovered that 'gold' matches two tokens.
    const result = await getRelevantMemories('checkin process sunday', 1, 2, repo);
    expect(repo.searchAsync).toHaveBeenCalledTimes(3);
    expect(result[0]?.id).toBe('gold');
  });

  it('suppresses single-token junk whenever a multi-token match exists', async () => {
    const gold = memory('gold');
    const repo = repoByProbe({
      checkin: [memory('j6'), gold],
      process: [memory('j1'), memory('j2'), memory('j3'), memory('j4'), memory('j5')],
      sunday: [gold, memory('j7')],
      volunteers: [memory('j8')],
    });
    const result = await getRelevantMemories('checkin process sunday volunteers', 1, 5, repo);
    // gold matched 2 tokens; every j* matched exactly 1 → all dropped.
    expect(result.map((m) => m.id)).toEqual(['gold']);
  });

  it('keeps single-token matches when nothing matches more than one token', async () => {
    const a = memory('a');
    const b = memory('b');
    const repo = repoByProbe({ checkin: [a], sunday: [b] });
    const result = await getRelevantMemories('checkin sunday', 1, 5, repo);
    expect(result.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('still returns results for a single-significant-token prompt', async () => {
    const a = memory('a');
    const repo = repoByProbe({ sunday: [a] });
    await expect(getRelevantMemories('sunday', 1, 5, repo)).resolves.toEqual([a]);
  });

  it('still enforces owner scoping after ranking', async () => {
    const mine = memory('mine');
    const theirs = memory('theirs', { ownerUserId: 2 });
    const repo = repoByProbe({ checkin: [theirs, mine], sunday: [theirs, mine] });
    const result = await getRelevantMemories('checkin sunday', 1, 5, repo);
    expect(result.map((m) => m.id)).toEqual(['mine']);
  });

  it('only retrieves null-owner rows when no owner is known', async () => {
    const owned = memory('owned', { ownerUserId: 2 });
    const global = memory('global', { ownerUserId: null });
    const repo = repoByProbe({ checkin: [owned, global], sunday: [owned, global] });
    const result = await getRelevantMemories('checkin sunday', null, 5, repo);
    expect(result.map((m) => m.id)).toEqual(['global']);
  });

  it('caps fused results at topN', async () => {
    const m = (id: string) => memory(id);
    const repo = repoByProbe({
      checkin: [m('m1'), m('m2'), m('m3')],
      sunday: [m('m1'), m('m2'), m('m4')],
    });
    const result = await getRelevantMemories('checkin sunday', 1, 2, repo);
    expect(result).toHaveLength(2);
    // m1 and m2 each matched both tokens; m3/m4 matched one and are suppressed.
    expect(result.map(({ id }) => id)).toEqual(['m1', 'm2']);
  });
});
