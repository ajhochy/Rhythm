import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

let canonicalRoot: string;

// Native memory reference core: a selected semantic note is released only after
// canonical-file revalidation, so joined rows get a real note under the vault.
function writeCanonicalMemory(memory: AgentMemory): void {
  if (!memory.sourceId || memory.source !== 'obsidian-memory') return;
  const file = path.join(canonicalRoot, memory.sourceId);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `---\nkind: ${memory.kind}\nstatus: ${memory.status}\n---\n${memory.content}\n`);
}

function useRepository(fts: AgentMemory[], joined: AgentMemory[] = []): void {
  joined.forEach(writeCanonicalMemory);
  vi.spyOn(AgentMemoryRepository.prototype, 'searchAsync').mockResolvedValue(fts);
  vi.spyOn(AgentMemoryRepository.prototype, 'findBySourceIdsAsync').mockResolvedValue(joined);
}

function useEngraph(client: {
  search: (query: string, topN: number) => Promise<unknown[]>;
  lastSearchResult?: () => unknown;
}): void {
  vi.spyOn(engraphManager, 'getRetrievalClient').mockReturnValue(client as never);
}

beforeEach(() => {
  canonicalRoot = mkdtempSync(path.join(tmpdir(), 'issue-1573-canonical-'));
  process.env.MEMORY_VAULT_PATH = canonicalRoot;
  process.env.MEMORY_VAULT_SUBDIR = '';
  process.env.ENGRAPH_MEMORY_VAULT_ROOT = canonicalRoot;
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
  rmSync(canonicalRoot, { recursive: true, force: true });
});

describe('#1573 semantic degradation observability', () => {
  // Native reference core (50ebd40e): native scores are uncalibrated rank
  // signals, not a confidence gate, so the automatic lane no longer emits
  // 'no_confidence'. A low-score hit with a canonical-verified snippet is used.
  it('1573:1573-A-semantic-degradation-observability:1 records and logs a low-score native hit without prompt or note text', async () => {
    const fts = memory({ content: 'collector cup private-body-sentinel' });
    useRepository([fts], [fts]);
    useEngraph({
      search: vi.fn().mockResolvedValue([{
        file: 'fact/collector.md',
        score: 0.031,
        snippet: 'collector cup private-body-sentinel',
      }]),
    });
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    const result = await buildMemoryPreface('collector cup private-query-sentinel', 1);

    expect(result.semanticStatus).toBe('used');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].semanticStatus).toBe('used');
    // The body reaches only the fenced preface, never the log line.
    expect(result.text).toContain('private-body-sentinel');
    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toContain('semantic');
    expect(line).toContain('status=used');
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

  it('records bounded body-free phase timing without exposing adversarial retrieval data', async () => {
    const fts = memory({ content: 'private FTS body sentinel must stay out of logs' });
    useRepository([fts], [fts]);
    useEngraph({
      search: vi.fn().mockResolvedValue([]),
      lastSearchResult: () => ({
        hits: [],
        status: 'http_error' as const,
        rawError: 'private raw error sentinel',
        metadata: 'private native metadata sentinel',
      }),
    });
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    const result = await buildMemoryPreface('private query sentinel', 1);

    expect(result.semanticStatus).toBe('http_error');
    const line = String(info.mock.calls[0]?.[0]);
    expect(line).toContain('semantic status=http_error hits=0');
    expect(line).toMatch(/phase=[a-z_]+/);
    expect(line).toMatch(/pre_search_ms=\d+/);
    expect(line).toMatch(/elapsed_ms=\d+/);
    expect(line).toMatch(/remaining_ms=\d+/);
    expect(line).not.toContain('private query sentinel');
    expect(line).not.toContain('private FTS body sentinel');
    expect(line).not.toContain('private raw error sentinel');
    expect(line).not.toContain('private native metadata sentinel');
  });

  it.each([
    ['unavailable client', () => new EngraphHttpClient('', vi.fn()), 'backend_unavailable'],
    ['HTTP timeout', () => {
      const timeout = new Error('private timeout error sentinel');
      timeout.name = 'TimeoutError';
      return new EngraphHttpClient('http://127.0.0.1:7777', vi.fn().mockRejectedValue(timeout));
    }, 'http_timeout'],
  ] as const)('logs a distinct body-free phase for %s', async (_name, createClient, phase) => {
    const fts = memory();
    useRepository([fts], []);
    useEngraph(createClient());
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    await buildMemoryPreface('synthetic diagnostic query', 1);

    expect(String(info.mock.calls[0]?.[0])).toContain(`phase=${phase}`);
  });

  it('records downstream deadline exhaustion separately from HTTP search timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-03T12:00:00.000Z'));
    process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS = '5';
    const fts = memory();
    vi.spyOn(AgentMemoryRepository.prototype, 'searchAsync').mockResolvedValue([fts]);
    vi.spyOn(AgentMemoryRepository.prototype, 'findBySourceIdsAsync')
      .mockImplementation(() => new Promise<AgentMemory[]>(() => undefined));
    useEngraph({
      search: vi.fn().mockResolvedValue([{
        file: 'fact/collector.md',
        snippet: 'collector cup fact',
      }]),
    });
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);

    try {
      const pending = buildMemoryPreface('collector cup', 1);
      await vi.advanceTimersByTimeAsync(5);
      await expect(pending).resolves.toMatchObject({ semanticStatus: 'timeout' });
      expect(String(info.mock.calls[0]?.[0])).toContain('phase=downstream_deadline');
    } finally {
      vi.useRealTimers();
    }
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

  // Native reference core: a canonical-verified native excerpt is not lexically
  // gated (passesGate in memory_retrieval.ts), so 'lexical_gate' is no longer
  // emitted; the native reference ranks ahead of the FTS fallback instead.
  it('1573:1573-A-semantic-degradation-observability:5 native-ranked references bypass the lexical gate', async () => {
    const fts = memory();
    const semantic = memory({
      id: 'semantic-memory',
      sourceId: 'fact/semantic.md',
      content: 'entirely unrelated wording',
    });
    useRepository([fts], [semantic]);
    useEngraph({
      search: vi.fn().mockResolvedValue([{
        file: 'fact/semantic.md',
        confidence: 0.9,
        snippet: 'entirely unrelated wording',
      }]),
    });

    const result = await buildMemoryPreface('collector cup', 1);

    expect(result.semanticStatus).toBe('used');
    expect(result.memoryIds).toEqual(['semantic-memory', 'fts-memory']);
    expect(result.items[0]).toMatchObject({ memoryId: 'semantic-memory', semanticStatus: 'used' });
  });

  it('1573:1573-A-semantic-degradation-observability:6 records used on a trusted semantic hit', async () => {
    const matched = memory();
    useRepository([matched], [matched]);
    useEngraph({
      search: vi.fn().mockResolvedValue([{
        file: 'fact/collector.md',
        confidence: 0.9,
        snippet: 'collector cup fact',
      }]),
    });

    const result = await buildMemoryPreface('collector cup', 1);

    expect(result.semanticStatus).toBe('used');
    // Native reference core records native evidence as lane 'semantic' with
    // uncalibrated confidence (the old semantic+lexical 'hybrid' lane is gone).
    expect(result.items[0]).toMatchObject({ lane: 'semantic', confidence: null, semanticStatus: 'used' });
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
