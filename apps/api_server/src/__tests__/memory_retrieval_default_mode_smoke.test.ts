/**
 * Step-2 smoke tests — semantic (hybrid) memory retrieval becomes the DEFAULT.
 *
 * Target behavior:
 *  - `getAgentMemoryRetrievalMode()` returns 'hybrid' when
 *    AGENT_MEMORY_RETRIEVAL_MODE is unset or unrecognized; only an explicit
 *    'fts' (case-insensitive, trimmed) opts out.
 *  - `buildMemoryPreface` therefore engages the Engraph lane by default; when
 *    the lane yields nothing (manager disabled/unhealthy → fail-closed client)
 *    the preface still carries the FTS results — no regression for machines
 *    without Engraph.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentMemoryRepository } from '../repositories/agent_memory_repository';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import { getAgentMemoryRetrievalMode } from '../config/env';
import { buildMemoryPreface } from '../services/memory_retrieval';
import { EngraphHttpClient } from '../services/engraph_client';

function memory(overrides: Partial<AgentMemory>): AgentMemory {
  return {
    id: 'memory', kind: 'fact', content: 'memory', source: 'obsidian-memory',
    sourceId: 'fact/memory.md', tagsJson: '[]', ownerUserId: 1,
    status: 'stable', staleAfter: null, verifiedJson: '[]', sourcesJson: '[]',
    generatedBy: null, generatedAt: null, trustTier: 'unverified',
    createdAt: 'now', updatedAt: 'now', ...overrides,
  };
}

afterEach(() => {
  delete process.env.AGENT_MEMORY_RETRIEVAL_MODE;
  vi.restoreAllMocks();
});

describe('semantic retrieval default (step 2 smoke)', () => {
  it('defaults to hybrid when the env var is unset', () => {
    delete process.env.AGENT_MEMORY_RETRIEVAL_MODE;
    expect(getAgentMemoryRetrievalMode()).toBe('hybrid');
  });

  it('honors an explicit fts opt-out, case-insensitively', () => {
    process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'fts';
    expect(getAgentMemoryRetrievalMode()).toBe('fts');
    process.env.AGENT_MEMORY_RETRIEVAL_MODE = ' FTS ';
    expect(getAgentMemoryRetrievalMode()).toBe('fts');
  });

  it('treats unrecognized values as hybrid (the new default)', () => {
    process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'bananas';
    expect(getAgentMemoryRetrievalMode()).toBe('hybrid');
  });

  it('engages the Engraph lane by default in buildMemoryPreface', async () => {
    const fact = memory({ id: 'fact-1', content: 'AJ prefers Tuesday planning meetings' });
    vi.spyOn(AgentMemoryRepository.prototype, 'searchAsync').mockResolvedValue([fact]);
    vi.spyOn(AgentMemoryRepository.prototype, 'findBySourceIdsAsync').mockResolvedValue([]);
    const engraphSpy = vi.spyOn(EngraphHttpClient.prototype, 'search').mockResolvedValue([]);

    const preface = await buildMemoryPreface('planning meetings tuesday', 1);
    expect(engraphSpy).toHaveBeenCalled();
    // Semantic lane empty → FTS results still injected (fail-open to FTS).
    expect(preface.memoryIds).toContain('fact-1');
    expect(preface.text).toContain('Tuesday planning meetings');
  });

  it('does not touch Engraph when fts mode is explicitly requested', async () => {
    process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'fts';
    vi.spyOn(AgentMemoryRepository.prototype, 'searchAsync').mockResolvedValue([]);
    const engraphSpy = vi.spyOn(EngraphHttpClient.prototype, 'search').mockResolvedValue([]);

    await buildMemoryPreface('planning meetings tuesday', 1);
    expect(engraphSpy).not.toHaveBeenCalled();
  });
});
