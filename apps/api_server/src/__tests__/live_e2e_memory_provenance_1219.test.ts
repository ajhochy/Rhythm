/**
 * Live sandbox contract for #1219.
 *
 * Drives the real HTTP surface and then inspects the sandbox SQLite file. The
 * suite is skipped unless RHYTHM_LIVE_E2E=1 and refuses production/live ports.
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = process.env.RHYTHM_LIVE_URL ?? 'http://127.0.0.1:4198';
const DB_PATH = path.resolve(process.env.RHYTHM_LIVE_DB_PATH ?? '/invalid/rhythm.db');
const TOKEN = `memory1219-${Date.now()}`;

interface MemoryResponse {
  id: string;
  content: string;
  status: string;
  lifecycleState: string;
  sourcesJson: string;
  generatedBy: string | null;
  auditHistory?: Array<{
    id: string;
    action: string;
    rollbackTarget: string | null;
  }>;
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

describeLive('live #1219 memory provenance lifecycle', () => {
  beforeAll(() => {
    const url = new URL(BASE);
    expect(url.hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
    expect(['4001', '4096', '4098', '']).not.toContain(url.port);
    expect(DB_PATH).not.toContain('Library/Application Support/Rhythm');
  });

  it('persists provenance and append-only lifecycle audit rows over real HTTP', async () => {
    await apiJson('/agent-memory', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'fact',
        content: `${TOKEN} provenance lifecycle contract.`,
        sources: [{
          id: 'live-source',
          type: 'document',
          ref: `rhythm://live-e2e/${TOKEN}`,
        }],
      }),
    });

    const rows = await apiJson<MemoryResponse[]>(
      `/agent-memory/search?q=${encodeURIComponent(TOKEN)}`,
    );
    const created = rows.find((row) => row.content.includes(TOKEN));
    expect(created).toBeDefined();

    const verified = await apiJson<MemoryResponse>(
      `/agent-memory/${created!.id}/agent-lifecycle`,
      {
        method: 'POST',
        body: JSON.stringify({
          action: 'verify',
          staleAfter: '2099-12-31',
        }),
      },
    );
    const deprecated = await apiJson<MemoryResponse>(
      `/agent-memory/${created!.id}/agent-lifecycle`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'deprecate' }),
      },
    );

    expect(verified.lifecycleState).toBe('active');
    expect(deprecated.lifecycleState).toBe('deprecated');
    expect(deprecated.auditHistory?.map((entry) => entry.action)).toEqual([
      'verified',
      'deprecated',
    ]);
    expect(deprecated.auditHistory?.[1].rollbackTarget)
      .toBe(deprecated.auditHistory?.[0].id);

    const db = new Database(DB_PATH, { readonly: true });
    try {
      const stored = db.prepare(`
        SELECT status, stale_after, sources_json, generated_by, trust_tier
        FROM agent_memory WHERE id = ?
      `).get(created!.id) as Record<string, unknown>;
      expect(stored).toMatchObject({
        status: 'deprecated',
        stale_after: '2099-12-31',
        generated_by: 'agent:rhythm/1',
      });
      expect(JSON.parse(stored.sources_json as string)).toEqual([
        {
          id: 'live-source',
          type: 'document',
          ref: `rhythm://live-e2e/${TOKEN}`,
        },
      ]);

      const audit = db.prepare(`
        SELECT action, actor, prior_state_json, rollback_target,
               source_context_json
        FROM agent_memory_changes
        WHERE memory_id = ?
        ORDER BY changed_at ASC, id ASC
      `).all(created!.id) as Array<Record<string, unknown>>;
      expect(audit).toHaveLength(2);
      expect(audit[0]).toMatchObject({
        action: 'verified',
        actor: 'agent:rhythm-mcp/1',
        rollback_target: null,
      });
      expect(JSON.parse(audit[0].prior_state_json as string))
        .toMatchObject({ status: 'stable' });
      expect(JSON.parse(audit[0].source_context_json as string))
        .toMatchObject({ sourceId: expect.any(String) });
      expect(audit[1].rollback_target).toBeTruthy();
    } finally {
      db.close();
    }
  });
});
