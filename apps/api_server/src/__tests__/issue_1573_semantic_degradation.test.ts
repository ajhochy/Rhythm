import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import { EngraphHttpClient } from '../services/engraph_client';
import { engraphManager } from '../services/engraph_manager';
import { buildMemoryPreface } from '../services/memory_retrieval';
import { logger } from '../utils/logger';

function memory(overrides: Partial<AgentMemory> = {}): AgentMemory {
  return {
    id: 'fts-memory',
    kind: 'fact',
    content: 'collector cup fact',
    source: 'obsidian-memory',
    sourceId: 'fact/collector.md',
    tagsJson: '[]',
    ownerUserId: 1,
    status: 'stable',
    staleAfter: null,
    verifiedJson: '[]',
    sourcesJson: '[]',
    generatedBy: null,
    generatedAt: null,
    trustTier: 'unverified',
    autoInjectable: true,
    createdAt: 'now',
    updatedAt: 'now',
    ...overrides,
  };
}

function useRepository(fts: AgentMemory[], joined: AgentMemory[] = []): void {
  vi.spyOn(AgentMemoryRepository.prototype, 'searchAsync').mockResolvedValue(fts);
  vi.spyOn(AgentMemoryRepository.prototype, 'findBySourceIdsAsync').mockResolvedValue(joined);
}

function useEngraph(client: { search: (query: string, topN: number) => Promise<unknown[]> }): void {
  vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue(client as never);
}

beforeEach(() => {
  process.env.MEMORY_VAULT_PATH = '/vault/AGENT-MEMORY';
  process.env.MEMORY_VAULT_SUBDIR = '';
  process.env.ENGRAPH_MEMORY_VAULT_ROOT = '/vault/AGENT-MEMORY';
  delete process.env.AGENT_MEMORY_RETRIEVAL_MODE;
  delete process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS;
});

afterEach(() => {
  delete process.env.MEMORY_VAULT_PATH;
  delete process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.ENGRAPH_MEMORY_VAULT_ROOT;
  delete process.env.AGENT_MEMORY_RETRIEVAL_MODE;
  delete process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS;
  vi.restoreAllMocks();
});

describe('#1573 semantic degradation observability', () => {
  it('1573:1573-A-semantic-degradation-observability:1 records and logs no_confidence without prompt or note text', async () => {
    const fts = memory({ content: 'collector cup private-body-sentinel' });
    useRepository([fts], [fts]);
    useEngraph({
      search: vi.fn().mockResolvedValue([{ file: 'fact/collector.md', score: 0.031 }]),
    });
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    const result = await buildMemoryPreface('collector cup private-query-sentinel', 1);

    expect(result.semanticStatus).toBe('no_confidence');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].semanticStatus).toBe('no_confidence');
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toContain('semantic');
    expect(line).toContain('no_confidence');
    expect(line).toContain('hits=1');
    expect(line).not.toContain('private-query-sentinel');
    expect(line).not.toContain('private-body-sentinel');
  });

  it.each([
    ['http_error', new EngraphHttpClient('http://127.0.0.1:7777', vi.fn().mockResolvedValue(new Response('', { status: 503 })))],
    ['malformed', new EngraphHttpClient('http://127.0.0.1:7777', vi.fn().mockResolvedValue(new Response('{', { status: 200 })))],
    ['backend_unavailable', new EngraphHttpClient('', vi.fn())],
  ] as const)('1573:1573-A-semantic-degradation-observability:2 surfaces %s', async (status, client) => {
    const fts = memory();
    useRepository([fts], [fts]);
    useEngraph(client);

    const result = await buildMemoryPreface('collector cup', 1);

    expect(result.semanticStatus).toBe(status);
    expect(result.items[0].semanticStatus).toBe(status);
  });

  it('1573:1573-A-semantic-degradation-observability:3 surfaces a shared-budget timeout', async () => {
    process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS = '5';
    const fts = memory();
    useRepository([fts], [fts]);
    useEngraph({ search: vi.fn(() => new Promise<never>(() => undefined)) });

    const result = await buildMemoryPreface('collector cup', 1);

    expect(result.semanticStatus).toBe('timeout');
    expect(result.items[0].semanticStatus).toBe('timeout');
  });

  it('1573:1573-A-semantic-degradation-observability:4 distinguishes unmapped semantic hits', async () => {
    const fts = memory();
    useRepository([fts], []);
    useEngraph({
      search: vi.fn().mockResolvedValue([{ file: '/outside/fact.md', confidence: 0.9 }]),
    });

    const result = await buildMemoryPreface('collector cup', 1);

    expect(result.semanticStatus).toBe('unmapped');
    expect(result.items[0].semanticStatus).toBe('unmapped');
  });

  it('1573:1573-A-semantic-degradation-observability:5 distinguishes the unchanged lexical gate', async () => {
    const fts = memory();
    const semantic = memory({
      id: 'semantic-memory',
      sourceId: 'fact/semantic.md',
      content: 'entirely unrelated wording',
    });
    useRepository([fts], [semantic]);
    useEngraph({
      search: vi.fn().mockResolvedValue([{ file: 'fact/semantic.md', confidence: 0.9 }]),
    });

    const result = await buildMemoryPreface('collector cup', 1);

    expect(result.semanticStatus).toBe('lexical_gate');
    expect(result.items[0].semanticStatus).toBe('lexical_gate');
  });

  it('1573:1573-A-semantic-degradation-observability:6 records used on a trusted semantic hit', async () => {
    const matched = memory();
    useRepository([matched], [matched]);
    useEngraph({
      search: vi.fn().mockResolvedValue([{ file: 'fact/collector.md', confidence: 0.9 }]),
    });

    const result = await buildMemoryPreface('collector cup', 1);

    expect(result.semanticStatus).toBe('used');
    expect(result.items[0]).toMatchObject({ lane: 'hybrid', semanticStatus: 'used' });
  });

  it('1573:1573-A-semantic-degradation-observability:7 marks FTS-only retrieval disabled and never calls Engraph', async () => {
    process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'fts';
    const fts = memory();
    useRepository([fts]);
    const getClient = vi.spyOn(engraphManager, 'getRetrievalClient');

    const result = await buildMemoryPreface('collector cup', 1);

    expect(result.semanticStatus).toBe('disabled');
    expect(result.items[0].semanticStatus).toBe('disabled');
    expect(getClient).not.toHaveBeenCalled();
  });
});
