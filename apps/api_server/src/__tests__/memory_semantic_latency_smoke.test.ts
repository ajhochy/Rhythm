/**
 * Step-3 smoke tests — prompt-path latency budget for semantic memory search.
 *
 * Target behavior:
 *  - New env getter `getSemanticSearchBudgetMs()` (config/env.ts): default
 *    500ms; positive-integer env override AGENT_MEMORY_SEMANTIC_BUDGET_MS;
 *    invalid values fall back to the default.
 *  - The prompt path (EngraphManager.getRetrievalClient + the default client
 *    used by getRelevantMemoriesSemantic) uses this budget as the search
 *    timeout, so a hung/slow Engraph can never delay a first agent response
 *    by more than the budget. Health-check and startup budgets are separate
 *    and unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentMemory } from '../repositories/agent_memory_repository';
import { getSemanticSearchBudgetMs } from '../config/env';
import { EngraphHttpClient } from '../services/engraph_client';
import { getRelevantMemoriesSemantic } from '../services/memory_retrieval';

function memory(id: string): AgentMemory {
  return {
    id, kind: 'fact', content: `content ${id}`, source: 'obsidian-memory',
    sourceId: `fact/${id}.md`, tagsJson: '[]', ownerUserId: 1,
    createdAt: 'now', updatedAt: 'now',
  };
}

afterEach(() => {
  delete process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS;
  vi.restoreAllMocks();
});

describe('semantic search latency budget (step 3 smoke)', () => {
  it('defaults to 500ms and honors a positive-integer override', () => {
    delete process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS;
    expect(getSemanticSearchBudgetMs()).toBe(500);
    process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS = '250';
    expect(getSemanticSearchBudgetMs()).toBe(250);
  });

  it.each(['garbage', '-100', '0', ''])('falls back to the default for invalid value %j', (raw) => {
    process.env.AGENT_MEMORY_SEMANTIC_BUDGET_MS = raw;
    expect(getSemanticSearchBudgetMs()).toBe(500);
  });

  it('a hung Engraph service cannot delay retrieval beyond the budget', async () => {
    const hangingFetch = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const client = new EngraphHttpClient('http://127.0.0.1:7777', hangingFetch, 50);
    const fts = [memory('fresh')];
    const repo = {
      searchAsync: vi.fn().mockResolvedValue(fts),
      findBySourceIdsAsync: vi.fn().mockResolvedValue([]),
    };

    const started = Date.now();
    const result = await getRelevantMemoriesSemantic('checkin sunday', 1, 5, repo, client);
    expect(Date.now() - started).toBeLessThan(400);
    expect(result).toEqual(fts);
  });
});
