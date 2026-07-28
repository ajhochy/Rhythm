/**
 * Live sandbox gate for #1218 and #1215.
 *
 * Run only against tools/dev/sandbox.sh with an explicit synthetic DB source,
 * temp HOME, temp vault, API :4115, and a separate engine port.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';

import { getDb, setDb } from '../database/db';
import { getRelevantMemories } from '../services/memory_retrieval';
import {
  MEMORY_CONSOLIDATION_PROMPT,
  MEMORY_CONSOLIDATION_SEED_NAME,
} from '../services/memory_consolidation_seed';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4115';
const DB_PATH = path.resolve(process.env.DB_PATH ?? '/invalid/rhythm.db');
const VAULT_PATH = path.resolve(process.env.RHYTHM_LIVE_VAULT_PATH ?? '/invalid/vault');
const BOOT_MODE = process.env.RHYTHM_EXPECT_PROMPT_BOOT ?? 'unspecified';
const TOKEN = `memory1218${Date.now()}`;

interface MemoryRow {
  id: string;
  kind: string;
  content: string;
  source: string | null;
  sourceId: string | null;
}

async function apiJson<T>(route: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${route}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route} -> ${response.status}: ${text}`);
  return text ? JSON.parse(text) as T : undefined as T;
}

async function poll<T>(operation: () => T, label: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`${label} timed out: ${String(lastError)}`);
}

describeLive('live #1218/#1215 memory behavior', () => {
  beforeAll(() => {
    expect(new URL(BASE).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    expect(new URL(BASE).port).toBe('4115');
    expect(DB_PATH).not.toContain('Library/Application Support/Rhythm');
    expect(VAULT_PATH).not.toContain('Documents');
    setDb(new Database(DB_PATH));
  });

  it('issue-1218: curated memory outranks distinguishable synthesis with provenance', async () => {
    const synthesisPath = path.join(VAULT_PATH, 'synthesis', `${TOKEN}.md`);
    const factPath = path.join(VAULT_PATH, 'fact', `${TOKEN}.md`);
    await fs.mkdir(path.dirname(synthesisPath), { recursive: true });
    await fs.mkdir(path.dirname(factPath), { recursive: true });
    await fs.writeFile(
      synthesisPath,
      `---\nkind: fact\ntags: [${TOKEN}]\n---\n${`${TOKEN} launch rollback detail `.repeat(400)}\n`,
    );
    await fs.writeFile(
      factPath,
      `---\nkind: fact\ntags: [${TOKEN}]\n---\n${TOKEN} launch rollback requires rehearsal.\n`,
    );

    await apiJson('/agent-memory/sync', { method: 'POST', body: '{}' });
    const ranked = await getRelevantMemories(`${TOKEN} launch rollback`, null, 5);
    const synthesis = ranked.find((row) => row.sourceId === `synthesis/${TOKEN}.md`);

    expect(ranked[0].sourceId).toBe(`fact/${TOKEN}.md`);
    expect(synthesis?.kind).toBe('synthesis');
    expect(synthesis?.source).toBe('obsidian-memory');
  });

  it(`issue-1215: ${BOOT_MODE} boot activates v2 prompt and supported memory write`, async () => {
    const promptRow = await poll(() => {
      const row = getDb().prepare(`
          SELECT prompt, allowed_mcps_json, allowed_skills_json
          FROM agent_scheduled_tasks
          WHERE name = ?
          ORDER BY created_at ASC
          LIMIT 1
        `)
        .get(MEMORY_CONSOLIDATION_SEED_NAME) as {
          prompt: string;
          allowed_mcps_json: string | null;
          allowed_skills_json: string | null;
        } | undefined;
      if (!row) throw new Error('managed consolidation row not present yet');
      return row;
    }, 'consolidation seed');

    expect(promptRow.prompt).toBe(MEMORY_CONSOLIDATION_PROMPT);
    expect(JSON.parse(promptRow.allowed_mcps_json ?? '[]')).toEqual(['rhythm']);
    expect(JSON.parse(promptRow.allowed_skills_json ?? '[]')).toEqual([]);

    await apiJson('/agent-memory', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'fact',
        content: `${TOKEN} supported consolidation memory outcome.`,
        source: 'agent',
      }),
    });
    const found = await apiJson<MemoryRow[]>(
      `/agent-memory/search?q=${encodeURIComponent(TOKEN)}&limit=20`,
    );
    expect(found.some((row) => row.content.includes('supported consolidation memory outcome'))).toBe(true);
  });
});
