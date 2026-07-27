/**
 * Step-1 smoke tests — multi-token FTS ranking for memory injection.
 *
 * Target behavior for `getRelevantMemories` (memory_retrieval.ts):
 *  - Probe EVERY significant prompt token (no early break once topN rows have
 *    accumulated — the old fill-and-break made the prompt's first word fill
 *    the whole preface).
 *  - Score each memory by how many DISTINCT probes returned it; more matched
 *    tokens = more relevant. Ties break by best in-probe rank, trust, then
 *    first-seen.
 *  - JUNK SUPPRESSION: when at least one memory matched ≥2 tokens, drop all
 *    single-token matches — a preface with one relevant fact beats five
 *    word-coincidence facts. When nothing matched ≥2 tokens, keep singles
 *    (recall preserved).
 *  - Owner defense-in-depth filtering is unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import { getRelevantMemories } from '../services/memory_retrieval';

function memory(id: string, overrides: Partial<AgentMemory> = {}): AgentMemory {
  return {
    id, kind: 'fact', content: `content ${id}`, source: 'obsidian-memory',
    sourceId: `fact/${id}.md`, tagsJson: '[]', ownerUserId: 1,
    status: 'stable', staleAfter: null, verifiedJson: '[]', sourcesJson: '[]',
    generatedBy: null, generatedAt: null, trustTier: 'unverified',
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

const originalTimezone = process.env.TZ;

afterEach(() => {
  vi.useRealTimers();
  if (originalTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
});

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

  it('gates inactive rows before topN so stale hits are replaced, not merely dropped', async () => {
    const live = (id: string) => memory(id);
    const stale = (id: string) => memory(id, { staleAfter: '2000-01-01' });
    const deprecated = memory('deprecated', { status: 'deprecated' });

    const threeLive = repoByProbe({
      schedule: [
        stale('stale-1'),
        deprecated,
        stale('stale-2'),
        live('live-1'),
        live('live-2'),
        live('live-3'),
      ],
    });
    await expect(getRelevantMemories('schedule', 1, 5, threeLive))
      .resolves.toMatchObject([
        { id: 'live-1' },
        { id: 'live-2' },
        { id: 'live-3' },
      ]);

    const sixLive = repoByProbe({
      schedule: [
        stale('stale-3'),
        deprecated,
        ...Array.from({ length: 6 }, (_, index) => live(`replacement-${index + 1}`)),
      ],
    });
    const result = await getRelevantMemories('schedule', 1, 5, sixLive);
    expect(result.map(({ id }) => id)).toEqual([
      'replacement-1',
      'replacement-2',
      'replacement-3',
      'replacement-4',
      'replacement-5',
    ]);
    expect(sixLive.searchAsync).toHaveBeenCalledWith(
      'schedule',
      1,
      5,
      expect.objectContaining({ activeOnly: true, today: expect.any(String) }),
    );
  });

  it('uses the call-time local calendar across an LA midnight boundary', async () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.useFakeTimers();
    const repo = repoByProbe({
      boundary: [
        memory('expires-at-local-midnight', { staleAfter: '2026-07-27' }),
        memory('future', { staleAfter: '2026-07-28' }),
      ],
    });

    // 2026-07-27 in UTC is still the evening of 2026-07-26 in Los Angeles.
    vi.setSystemTime(new Date('2026-07-27T06:59:59.000Z'));
    await expect(getRelevantMemories('boundary', 1, 5, repo))
      .resolves.toMatchObject([
        { id: 'expires-at-local-midnight' },
        { id: 'future' },
      ]);
    expect(repo.searchAsync).toHaveBeenLastCalledWith(
      'boundary',
      1,
      5,
      expect.objectContaining({ today: '2026-07-26' }),
    );

    // The next call crosses local midnight without a restart or module reload.
    vi.setSystemTime(new Date('2026-07-27T07:00:00.000Z'));
    await expect(getRelevantMemories('boundary', 1, 5, repo))
      .resolves.toMatchObject([{ id: 'future' }]);
    expect(repo.searchAsync).toHaveBeenLastCalledWith(
      'boundary',
      1,
      5,
      expect.objectContaining({ today: '2026-07-27' }),
    );
  });

  it('orders by match count, best in-probe rank, trust, then first seen', async () => {
    const human = memory('human', { trustTier: 'human' });
    const machine = memory('machine', { trustTier: 'machine' });
    const unverified = memory('unverified');
    const differentBestRank = repoByProbe({
      schedule: [unverified, machine, human],
    });
    expect((await getRelevantMemories('schedule', 1, 5, differentBestRank))
      .map(({ id }) => id)).toEqual(['unverified', 'machine', 'human']);

    const strongerUnverified = repoByProbe({
      alpha: [unverified, human],
      beta: [unverified, human],
      gamma: [unverified],
    });
    expect((await getRelevantMemories(
      'alpha beta gamma',
      1,
      5,
      strongerUnverified,
    )).map(({ id }) => id)).toEqual(['unverified', 'human']);

    // Both match both probes and each has bestIndex=0. Machine is first-seen,
    // so the human result proves trust is consulted before firstSeen.
    const equalRelevance = repoByProbe({
      alpha: [machine, human],
      beta: [human, machine],
    });
    expect((await getRelevantMemories(
      'alpha beta',
      1,
      5,
      equalRelevance,
    )).map(({ id }) => id)).toEqual(['human', 'machine']);
  });
});
