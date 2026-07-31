import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import {
  buildMemoryPreface,
  fuseMemoryRanks,
  getRelevantMemoriesSemantic,
} from '../services/memory_retrieval';
import {
  EngraphHttpClient,
  mapEngraphFileToSourceId,
} from '../services/engraph_client';

function memory(overrides: Partial<AgentMemory>): AgentMemory {
  return {
    id: 'memory', kind: 'fact', content: 'memory', source: 'obsidian-memory',
    sourceId: 'fact/memory.md', tagsJson: '[]', ownerUserId: 1,
    status: 'stable', staleAfter: null, verifiedJson: '[]', sourcesJson: '[]',
    generatedBy: null, generatedAt: null, trustTier: 'unverified',
    autoInjectable: true,
    createdAt: 'now', updatedAt: 'now', ...overrides,
  };
}

function repo(fts: AgentMemory[], joined: AgentMemory[]) {
  return {
    searchAsync: vi.fn().mockResolvedValue(fts),
    findBySourceIdsAsync: vi.fn().mockResolvedValue(joined),
  };
}

afterEach(() => {
  delete process.env.AGENT_MEMORY_RETRIEVAL_MODE;
  vi.restoreAllMocks();
});

describe('Engraph HTTP client', () => {
  it('accepts a well-formed persistent-service response without exposing snippets', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ file_path: 'fact/x.md', snippet: 'untrusted' }],
    }), { status: 200 }));
    const hits = await new EngraphHttpClient('http://127.0.0.1:7777', fetchImpl).search('query', 5);
    expect(hits).toEqual([{
      file: 'fact/x.md',
      score: null,
      confidence: null,
      distance: null,
    }]);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:7777/api/search', expect.any(Object));
  });

  it('rejects mock-only file fields instead of treating them as Engraph hits', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ file: 'fact/x.md' }],
    }), { status: 200 }));
    await expect(new EngraphHttpClient('http://127.0.0.1:7777', fetchImpl).search('query', 5))
      .resolves.toEqual([]);
  });

  it.each([
    ['unavailable URL', '', vi.fn()],
    ['malformed response', 'http://127.0.0.1:7777', vi.fn().mockResolvedValue(new Response('{', { status: 200 }))],
    ['non-2xx response', 'http://127.0.0.1:7777', vi.fn().mockResolvedValue(new Response('', { status: 503 }))],
  ])('fails closed for %s', async (_name, url, fetchImpl) => {
    await expect(new EngraphHttpClient(url, fetchImpl).search('query', 5)).resolves.toEqual([]);
  });

  it('fails closed when the request times out', async () => {
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    await expect(new EngraphHttpClient('http://127.0.0.1:7777', fetchImpl, 1).search('query', 5)).resolves.toEqual([]);
  });
});

describe('Engraph path confinement', () => {
  const parentVault = '/vault';
  const memoryRoot = '/vault/AGENT-MEMORY';

  it('maps both parent-vault and memory-root-relative paths exactly', () => {
    expect(mapEngraphFileToSourceId('AGENT-MEMORY/fact/x.md', memoryRoot, parentVault)).toBe('fact/x.md');
    expect(mapEngraphFileToSourceId('fact/x.md', memoryRoot, memoryRoot)).toBe('fact/x.md');
  });

  it.each(['/vault/AGENT-MEMORY/fact/x.md', '../AGENT-MEMORY/fact/x.md', 'AGENT-MEMORY/../AGENT-MEMORY/fact/x.md', 'agent-memory/fact/x.md'])(
    'rejects untrusted path %s',
    (file) => expect(mapEngraphFileToSourceId(file, memoryRoot, parentVault)).toBeNull(),
  );
});

describe('hybrid memory retrieval', () => {
  it('fails path-only semantic hits closed and preserves FTS', async () => {
    const fresh = memory({ id: 'fresh', sourceId: 'fact/fresh.md', content: 'fresh FTS memory' });
    const otherOwner = memory({ id: 'other', sourceId: 'fact/semantic.md', ownerUserId: 2, content: 'private' });
    const fakeRepo = repo([fresh], [otherOwner]);
    const engraph = { search: vi.fn().mockResolvedValue([{ file: 'fact/semantic.md' }]) };

    await expect(getRelevantMemoriesSemantic('query', 1, 2, fakeRepo, engraph)).resolves.toEqual([fresh]);
    expect(fakeRepo.findBySourceIdsAsync).not.toHaveBeenCalled();
  });

  it('fails path-only semantic hits closed for a null owner', async () => {
    const privateMemory = memory({ id: 'private', sourceId: 'fact/private.md', ownerUserId: 2 });
    const ownerless = memory({ id: 'ownerless', sourceId: 'fact/ownerless.md', ownerUserId: null });
    const fakeRepo = repo([], [privateMemory, ownerless]);
    const engraph = { search: vi.fn().mockResolvedValue([
      { file: 'fact/private.md' },
      { file: 'fact/ownerless.md' },
    ]) };

    const result = await getRelevantMemoriesSemantic('query', undefined, 2, fakeRepo, engraph);
    expect(fakeRepo.findBySourceIdsAsync).not.toHaveBeenCalled();
    expect(result).toEqual([]);
    expect(result.map(({ id }) => id)).not.toContain('private');
  });

  it('fuses deduped FTS and semantic ranks with deterministic RRF while retaining fresh FTS', async () => {
    const fresh = memory({ id: 'fresh', sourceId: 'fact/fresh.md', content: 'collector cup facts' });
    const shared = memory({ id: 'shared', sourceId: 'fact/shared.md', content: 'collector cup facts' });
    const semantic = memory({ id: 'semantic', sourceId: 'fact/semantic.md', content: 'collector cup facts' });
    const fakeRepo = repo([fresh, shared], [semantic, shared]);
    const engraph = { search: vi.fn().mockResolvedValue([
      { file: 'fact/semantic.md', confidence: 0.9 },
      { file: 'fact/shared.md', confidence: 0.9 },
    ]) };

    const result = await getRelevantMemoriesSemantic('collector cup', 1, 3, fakeRepo, engraph);
    expect(result.map(({ id }) => id)).toEqual(['shared', 'fresh', 'semantic']);
    expect(new Set(result.map(({ id }) => id)).size).toBe(result.length);
  });

  it('returns the original FTS order when Engraph is unavailable', async () => {
    const first = memory({ id: 'first' });
    const second = memory({ id: 'second' });
    const fakeRepo = repo([first, second], []);
    await expect(getRelevantMemoriesSemantic('query', 1, 2, fakeRepo, { search: vi.fn().mockResolvedValue([]) }))
      .resolves.toEqual([first, second]);
  });

  it('uses hybrid by default but fails RRF-only HTTP hits closed', async () => {
    const semantic = memory({ id: 'semantic', sourceId: 'fact/semantic.md', content: 'semantic only' });
    const ftsSpy = vi.spyOn(AgentMemoryRepository.prototype, 'searchAsync').mockResolvedValue([]);
    vi.spyOn(AgentMemoryRepository.prototype, 'findBySourceIdsAsync').mockResolvedValue([semantic]);
    const engraphSpy = vi.spyOn(EngraphHttpClient.prototype, 'search').mockResolvedValue([{ file: 'fact/semantic.md' }]);

    await expect(buildMemoryPreface('query', 1)).resolves.toMatchObject({ memoryIds: [] });
    expect(engraphSpy).toHaveBeenCalledOnce();
    expect(ftsSpy).toHaveBeenCalled();

    process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'fts';
    await expect(buildMemoryPreface('query', 1)).resolves.toMatchObject({ text: '' });
    expect(engraphSpy).toHaveBeenCalledOnce();
  });

  it('uses rank-only RRF and stable ties', () => {
    const a = memory({ id: 'a' });
    const b = memory({ id: 'b' });
    const c = memory({ id: 'c' });
    expect(fuseMemoryRanks([a, b], [c, b], 3).map(({ id }) => id)).toEqual(['b', 'a', 'c']);
  });

  it('gates each lane before RRF truncation and uses trust for equal-score ties', () => {
    const inactiveFts = memory({ id: 'stale-fts', staleAfter: '2000-01-01' });
    const inactiveSemantic = memory({ id: 'deprecated-semantic', status: 'deprecated' });
    const unverified = memory({ id: 'unverified' });
    const human = memory({ id: 'human', trustTier: 'human' });
    const machine = memory({ id: 'machine', trustTier: 'machine' });

    expect(fuseMemoryRanks(
      [inactiveFts, unverified, machine],
      [inactiveSemantic, human],
      3,
    ).map(({ id }) => id)).toEqual(['human', 'unverified', 'machine']);
  });

  it('overfetches semantic candidates and replaces inactive top hits with live rows', async () => {
    const hits = Array.from({ length: 8 }, (_, index) => ({
      file: `fact/${index + 1}.md`, confidence: 0.9,
    }));
    const joined = [
      memory({ id: 'stale', sourceId: 'fact/1.md', staleAfter: '2000-01-01' }),
      memory({ id: 'deprecated', sourceId: 'fact/2.md', status: 'deprecated' }),
      ...Array.from({ length: 6 }, (_, index) => memory({
        id: `live-${index + 1}`,
        sourceId: `fact/${index + 3}.md`, content: 'collector cup fact',
      })),
    ];
    const fakeRepo = repo([], joined);
    const engraph = { search: vi.fn().mockResolvedValue(hits) };

    const result = await getRelevantMemoriesSemantic(
      'collector cup',
      1,
      5,
      fakeRepo,
      engraph,
    );

    expect(engraph.search).toHaveBeenCalledWith('collector cup', 20);
    expect(result).toHaveLength(5);
    expect(result.every(({ id }) => id.startsWith('live-'))).toBe(true);
  });

  it('progressively widens past 25 inactive hits to recover 5 live rows', async () => {
    const hits = Array.from({ length: 30 }, (_, index) => ({
      file: `fact/${index + 1}.md`, confidence: 0.9,
    }));
    const joinedBySourceId = new Map([
      ...Array.from({ length: 25 }, (_, index) => {
        const sourceId = `fact/${index + 1}.md`;
        return [
          sourceId,
          memory({
            id: `inactive-${index + 1}`,
            sourceId,
            content: 'collector cup fact',
            staleAfter: '2000-01-01',
          }),
        ] as const;
      }),
      ...Array.from({ length: 5 }, (_, index) => {
        const sourceId = `fact/${index + 26}.md`;
        return [
          sourceId,
          memory({
            id: `live-${index + 1}`,
            sourceId,
            content: 'collector cup fact',
          }),
        ] as const;
      }),
    ]);
    const fakeRepo = {
      searchAsync: vi.fn().mockResolvedValue([]),
      findBySourceIdsAsync: vi.fn(
        async (_source: string, sourceIds: string[]) =>
          sourceIds.flatMap((sourceId) => {
            const joined = joinedBySourceId.get(sourceId);
            return joined ? [joined] : [];
          }),
      ),
    };
    const engraph = {
      search: vi.fn(async (_query: string, limit: number) =>
        hits.slice(0, limit)),
    };

    const result = await getRelevantMemoriesSemantic(
      'collector cup',
      1,
      5,
      fakeRepo,
      engraph,
    );

    expect(engraph.search.mock.calls.map(([, limit]) => limit))
      .toEqual([20, 40]);
    expect(result.map(({ id }) => id)).toEqual([
      'live-1',
      'live-2',
      'live-3',
      'live-4',
      'live-5',
    ]);
  });

  it('stops widening when Engraph reports that its result set is exhausted', async () => {
    const hits = [
      { file: 'fact/stale-1.md', confidence: 0.9 },
      { file: 'fact/stale-2.md', confidence: 0.9 },
      { file: 'fact/live.md', confidence: 0.9 },
    ];
    const joined = [
      memory({
        id: 'stale-1',
        sourceId: 'fact/stale-1.md',
        staleAfter: '2000-01-01',
      }),
      memory({
        id: 'stale-2',
        sourceId: 'fact/stale-2.md',
        staleAfter: '2000-01-01',
      }),
      memory({ id: 'live', sourceId: 'fact/live.md', content: 'collector cup fact' }),
    ];
    const fakeRepo = repo([], joined);
    const engraph = { search: vi.fn().mockResolvedValue(hits) };

    await expect(getRelevantMemoriesSemantic(
      'collector cup',
      1,
      5,
      fakeRepo,
      engraph,
    )).resolves.toMatchObject([{ id: 'live' }]);
    expect(engraph.search).toHaveBeenCalledTimes(1);
    expect(engraph.search).toHaveBeenCalledWith('collector cup', 20);
  });

  it('rejects an ambiguous source id before gating its stale duplicate', async () => {
    const active = memory({ id: 'active', sourceId: 'fact/shared.md', content: 'collector cup fact' });
    const staleDuplicate = memory({
      id: 'stale-duplicate',
      sourceId: 'fact/shared.md',
      staleAfter: '2000-01-01',
    });
    const fakeRepo = repo([], [active, staleDuplicate]);
    const engraph = {
      search: vi.fn().mockResolvedValue([{ file: 'fact/shared.md', confidence: 0.9 }]),
    };

    await expect(getRelevantMemoriesSemantic(
      'collector cup',
      1,
      5,
      fakeRepo,
      engraph,
    )).resolves.toEqual([]);
  });
});
