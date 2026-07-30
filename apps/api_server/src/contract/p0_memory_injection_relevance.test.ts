/**
 * P0 acceptance contract — automatic memory injection relevance and safety.
 *
 * Falsification target: a best-available but irrelevant memory must never be
 * treated as relevant, and an accepted memory must be a bounded excerpt with
 * body-free provenance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import {
  AgentMemoryRepository,
  type AgentMemory,
} from '../repositories/agent_memory_repository';
import { AgentSessionMemoryProvenanceRepository } from '../repositories/agent_session_memory_provenance_repository';
import * as memoryRetrieval from '../services/memory_retrieval';
import { EngraphHttpClient } from '../services/engraph_client';
import {
  classifyVaultNoteInjectability,
  parseNote,
} from '../services/memoryVaultSyncService';

type MemoryFixture = AgentMemory & { autoInjectable?: boolean };

function memory(overrides: Partial<MemoryFixture> = {}): MemoryFixture {
  return {
    id: 'memory',
    kind: 'fact',
    content: 'Stored memory.',
    source: 'obsidian-memory',
    sourceId: 'fact/memory.md',
    tagsJson: '[]',
    status: 'stable',
    staleAfter: null,
    verifiedJson: '[]',
    sourcesJson: '[]',
    generatedBy: null,
    generatedAt: null,
    trustTier: 'human',
    ownerUserId: 1,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    autoInjectable: true,
    ...overrides,
  };
}

function fakeRepo(fts: AgentMemory[], joined: AgentMemory[] = []) {
  return {
    searchAsync: vi.fn().mockResolvedValue(fts),
    findBySourceIdsAsync: vi.fn().mockResolvedValue(joined),
  };
}

beforeEach(() => {
  process.env.AGENT_MEMORY_RETRIEVAL_MODE = 'fts';
  process.env.AGENT_MEMORY_INJECTION_ENABLED = 'true';
  process.env.MEMORY_VAULT_PATH = '/private/tmp/rhythm-p0-memory-contract';
  process.env.MEMORY_VAULT_SUBDIR = '';
  process.env.ENGRAPH_MEMORY_VAULT_ROOT = '/private/tmp/rhythm-p0-memory-contract';
});

afterEach(() => {
  delete process.env.AGENT_MEMORY_RETRIEVAL_MODE;
  delete process.env.AGENT_MEMORY_INJECTION_ENABLED;
  delete process.env.AGENT_MEMORY_INJECTION_MIN_RELEVANCE;
  delete process.env.MEMORY_VAULT_PATH;
  delete process.env.MEMORY_VAULT_SUBDIR;
  delete process.env.ENGRAPH_MEMORY_VAULT_ROOT;
  vi.restoreAllMocks();
});

describe('P0 automatic memory relevance contract', () => {
  it('issue-0-c1: “six mins to glob homie” injects zero memories', async () => {
    const unrelated = memory({
      id: 'mcd-report',
      sourceId: 'Areas/Research/General/Reports/mcdonalds-world-cup.md',
      content: 'McDonald’s World Cup collector cups include several rare variants.',
    });
    const result = await memoryRetrieval.buildMemoryPreface(
      'six mins to glob homie',
      1,
      { getRelevant: vi.fn().mockResolvedValue([unrelated]) },
    );
    expect(result).toMatchObject({ text: '', memoryIds: [] });
  });

  it('issue-0-c2: a Worship Committee agenda prompt excludes reports, daily summaries, and repo maps', async () => {
    const excluded = [
      memory({
        id: 'mcd',
        sourceId: 'Areas/Research/General/Reports/mcdonalds-world-cup.md',
        content: 'Worship committee report about unrelated collector cups.',
        autoInjectable: false,
      }),
      memory({
        id: 'ai-trends',
        sourceId: 'Areas/Research/General/Reports/ai-trends.md',
        content: 'Worship committee report about AI market trends.',
        autoInjectable: false,
      }),
      memory({
        id: 'daily',
        sourceId: 'Daily/2026-07-26.md',
        content: 'Daily worship committee administrative summary.',
        autoInjectable: false,
      }),
      memory({
        id: 'repo-map',
        sourceId: 'Archives/repo-map.md',
        content: 'Repository map mentioning a worship committee package.',
        autoInjectable: false,
      }),
    ];
    const result = await memoryRetrieval.buildMemoryPreface(
      'Edit the Worship Committee agenda for next week',
      1,
      { getRelevant: vi.fn().mockResolvedValue(excluded) },
    );
    expect(result).toMatchObject({ text: '', memoryIds: [] });
  });

  it('issue-0-c3: “resume?” is too underspecified to inject an arbitrary nearest document', async () => {
    const arbitrary = memory({
      id: 'arbitrary',
      content: 'Resume the quarterly repository migration checklist.',
    });
    const result = await memoryRetrieval.buildMemoryPreface(
      'resume?',
      1,
      { getRelevant: vi.fn().mockResolvedValue([arbitrary]) },
    );
    expect(result).toMatchObject({ text: '', memoryIds: [] });
  });

  it('issue-0-c4: a semantic backend returning path-only hits fails closed', async () => {
    const candidate = memory({
      id: 'semantic-only',
      sourceId: 'fact/collector-cups.md',
      content: 'The rare collector cups are regional World Cup variants.',
    });
    const result = await memoryRetrieval.getRelevantMemoriesSemantic(
      'Which World Cup collector cups are rare?',
      1,
      5,
      fakeRepo([], [candidate]),
      { search: vi.fn().mockResolvedValue([{ file: 'fact/collector-cups.md' }]) },
    );
    expect(result).toEqual([]);
  });

  it('issue-0-c5: candidates below the configured relevance threshold produce zero injection', async () => {
    process.env.AGENT_MEMORY_INJECTION_MIN_RELEVANCE = '0.60';
    const weak = memory({
      id: 'weak',
      content: 'Committee parking instructions for a different campus.',
    });
    const result = await memoryRetrieval.buildMemoryPreface(
      'Edit the Worship Committee agenda',
      1,
      { getRelevant: vi.fn().mockResolvedValue([weak]) },
    );
    expect(result).toMatchObject({ text: '', memoryIds: [] });
  });

  it('issue-0-c6: an explicitly injectable McDonald’s collector-cup report yields a relevant excerpt', async () => {
    const report = memory({
      id: 'mcd-report',
      sourceId: 'Areas/Research/General/Reports/mcdonalds-world-cup.md',
      content:
        'Collector guide introduction. The rare McDonald’s World Cup collector cups are the mascot cup and limited regional team cup. Common player cups are easier to find.',
      autoInjectable: true,
    });
    const result = await memoryRetrieval.buildMemoryPreface(
      'Which McDonald’s World Cup collector cups are rare?',
      1,
      { getRelevant: vi.fn().mockResolvedValue([report]) },
    );
    expect(result.memoryIds).toEqual(['mcd-report']);
    expect(result.text).toMatch(/rare|mascot|regional/i);
    expect(result.text.length).toBeLessThanOrEqual(1200);
  });

  it('issue-0-c7: a directly relevant preference is injected within the documented budget', async () => {
    const preference = memory({
      id: 'preference',
      kind: 'preference',
      sourceId: 'preference/worship-committee.md',
      content: 'Worship Committee meetings should be scheduled on Tuesdays at 6 PM.',
    });
    const result = await memoryRetrieval.buildMemoryPreface(
      'When should the Worship Committee meetings be scheduled?',
      1,
      { getRelevant: vi.fn().mockResolvedValue([preference]) },
    );
    expect(result.memoryIds).toEqual(['preference']);
    expect(result.text).toContain('Tuesdays');
    expect(result.text.length).toBeLessThanOrEqual(1200);
    expect(Math.ceil(result.text.length / 4)).toBeLessThanOrEqual(300);
  });

  it('issue-0-c8: explicit on-demand repository search still finds an auto-excluded report', async () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const repo = new AgentMemoryRepository();
    await repo.createAsync({
      kind: 'fact',
      content: 'McDonald’s World Cup collector cup rarity guide.',
      source: 'obsidian-memory',
      sourceId: 'Areas/Research/General/Reports/mcdonalds-world-cup.md',
      autoInjectable: false,
    });
    const results = await repo.searchAsync('collector', undefined, 10);
    expect(results.map((item) => item.sourceId)).toContain(
      'Areas/Research/General/Reports/mcdonalds-world-cup.md',
    );
    const automaticResults = await repo.searchAsync(
      'collector',
      undefined,
      10,
      { injectableOnly: true },
    );
    expect(automaticResults).toEqual([]);
    db.close();
  });

  it('issue-0-c9: user A injection excludes user B even when a custom retrieval returns both', async () => {
    const userA = memory({
      id: 'user-a',
      ownerUserId: 1,
      content: 'Worship Committee meetings are Tuesday evenings.',
    });
    const userB = memory({
      id: 'user-b',
      ownerUserId: 2,
      content: 'Worship Committee meetings are Friday mornings.',
    });
    const result = await memoryRetrieval.buildMemoryPreface(
      'When are Worship Committee meetings?',
      1,
      { getRelevant: vi.fn().mockResolvedValue([userA, userB]) },
    );
    expect(result.memoryIds).toEqual(['user-a']);
    expect(result.text).not.toContain('Friday');
  });

  it('issue-0-c10: null owner never injects user-owned context', async () => {
    const privateMemory = memory({
      id: 'private',
      ownerUserId: 1,
      content: 'Worship Committee meetings are Tuesday evenings.',
    });
    const result = await memoryRetrieval.buildMemoryPreface(
      'When are Worship Committee meetings?',
      null,
      { getRelevant: vi.fn().mockResolvedValue([privateMemory]) },
    );
    expect(result).toMatchObject({ text: '', memoryIds: [] });
  });

  it('issue-0-c11: generated/long-form classes are excluded unless explicitly injectable', async () => {
    const report = parseNote('---\nkind: fact\n---\nCollector report.');
    const explicitReport = parseNote(
      '---\nkind: fact\ninjectable: true\n---\nCollector report.',
    );
    expect(classifyVaultNoteInjectability(
      'Areas/Research/General/Reports/collector-cups.md',
      report,
    )).toBe(false);
    expect(classifyVaultNoteInjectability(
      'Generated/Documents/collector-cups.md',
      report,
    )).toBe(false);
    expect(classifyVaultNoteInjectability(
      'Areas/Research/General/Reports/collector-cups.md',
      explicitReport,
    )).toBe(true);

    const generated = memory({
      id: 'generated',
      sourceId: 'Daily/generated-summary.md',
      generatedBy: 'agent:research/1',
      content: 'World Cup collector cups rare generated daily summary.',
      autoInjectable: false,
    });
    const explicit = memory({
      id: 'explicit',
      sourceId: 'Areas/Research/General/Reports/collector-cups.md',
      content: 'World Cup collector cups rare explicit reference.',
      autoInjectable: true,
    });
    const result = await memoryRetrieval.buildMemoryPreface(
      'Which World Cup collector cups are rare?',
      1,
      { getRelevant: vi.fn().mockResolvedValue([generated, explicit]) },
    );
    expect(result.memoryIds).toEqual(['explicit']);
  });

  it('issue-0-c12: automatic context prefers fewer excerpts and never exceeds 1200 chars / 300 estimated tokens', async () => {
    const matches = Array.from({ length: 5 }, (_, index) => memory({
      id: `long-${index}`,
      content:
        `Worship Committee agenda preference ${index}. ` +
        'This deliberately long relevant paragraph must be excerpted. '.repeat(100),
    }));
    const result = await memoryRetrieval.buildMemoryPreface(
      'Worship Committee agenda preference',
      1,
      { getRelevant: vi.fn().mockResolvedValue(matches) },
    );
    expect(result.memoryIds.length).toBeLessThanOrEqual(2);
    expect(result.text.length).toBeLessThanOrEqual(1200);
    expect(Math.ceil(result.text.length / 4)).toBeLessThanOrEqual(300);
  });

  it('issue-0-c13: the fixture corpus separates positives from negatives at threshold 0.60', () => {
    const score = (
      memoryRetrieval as unknown as {
        scoreMemoryForAutomaticInjection?: (
          query: string,
          candidate: AgentMemory,
        ) => { score: number; matchedTokens: number; queryTokens: number };
      }
    ).scoreMemoryForAutomaticInjection;
    expect(typeof score).toBe('function');
    if (!score) return;

    const fixtures = [
      {
        label: 'positive collector report',
        query: 'Which McDonald’s World Cup collector cups are rare?',
        candidate: memory({
          content: 'The rare McDonald’s World Cup collector cups are the mascot and regional team cups.',
        }),
        expected: 0.86,
      },
      {
        label: 'positive stored preference',
        query: 'When should Worship Committee meetings be scheduled?',
        candidate: memory({
          content: 'Worship Committee meetings should be scheduled on Tuesdays.',
        }),
        expected: 0.83,
      },
      {
        label: 'negative worship-to-report',
        query: 'Edit the Worship Committee agenda',
        candidate: memory({
          content: 'McDonald’s World Cup collector cups and rare regional variants.',
        }),
        expected: 0,
      },
      {
        label: 'negative weak overlap',
        query: 'Edit the Worship Committee agenda',
        candidate: memory({
          content: 'Committee parking instructions for another campus.',
        }),
        expected: 0.25,
      },
    ];
    for (const fixture of fixtures) {
      expect(score(fixture.query, fixture.candidate).score, fixture.label)
        .toBeCloseTo(fixture.expected, 2);
    }
  });

  it('issue-0-c14: Engraph’s real score field is preserved but not mislabeled as confidence', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{
        file_path: 'fact/cups.md',
        file_id: 17,
        score: 0.0325,
        headings: ['Collector cups'],
        snippet: 'not forwarded',
        docid: 'abc123',
      }],
    }), { status: 200 }));
    const hits = await new EngraphHttpClient(
      'http://127.0.0.1:7777',
      fetchImpl,
    ).search('collector cups', 5);
    expect(hits).toEqual([expect.objectContaining({
      file: 'fact/cups.md',
      score: 0.0325,
      confidence: null,
    })]);
  });

  it('issue-0-c15: provenance records lane/score/reason without note content', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    setDb(db);
    const repo = new AgentSessionMemoryProvenanceRepository();
    const details = [{
      memoryId: 'preference',
      source: 'obsidian-memory',
      sourceId: 'preference/worship.md',
      lane: 'fts',
      score: 0.83,
      confidence: null,
      reason: 'lexical overlap 5/6 cleared threshold 0.60',
    }];
    (
      repo.record as unknown as (
        sessionId: string,
        ids: string[],
        paths: (string | null)[],
        items: typeof details,
      ) => void
    )('session', ['preference'], ['preference/worship.md'], details);
    const record = repo.getLatest('session') as unknown as {
      items?: typeof details;
    };
    expect(record.items).toEqual(details);
    expect(JSON.stringify(record)).not.toContain('Worship Committee meetings should');
    db.close();
  });
});
