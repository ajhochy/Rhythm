/**
 * P0 live behavioral contract. WRITE-ONLY in this workstream: the external
 * orchestrator runs it against tools/dev/sandbox.sh with a disposable migrated
 * DB and vault. This suite refuses the installed DB, real vault, and reserved
 * ports.
 *
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:<isolated-port> \
 * RHYTHM_SANDBOX_API_PORT=<isolated-port> \
 * RHYTHM_LIVE_DB_PATH=/private/tmp/<sandbox>/rhythm.db \
 * DB_PATH=/private/tmp/<sandbox>/rhythm.db \
 * RHYTHM_LIVE_VAULT_PATH=/private/tmp/<sandbox>/vault \
 * npx vitest run src/__tests__/live_e2e_p0_memory_injection_relevance.test.ts \
 *   --no-file-parallelism
 */
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const vaultPath = process.env.RHYTHM_LIVE_VAULT_PATH ?? '';
const expectedPort = process.env.RHYTHM_SANDBOX_API_PORT ?? '';

interface ProvenanceItem {
  memoryId: string;
  source: string | null;
  sourceId: string | null;
  lane: string;
  score: number;
  confidence: number | null;
  reason: string;
  excerptChars: number;
  estimatedTokens: number;
}

interface ProvenanceResponse {
  recorded: boolean;
  memoryIds: string[];
  notePaths: (string | null)[];
  items: ProvenanceItem[];
}

function assertIsolated(): void {
  if (
    process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
    !/^\d{4,5}$/.test(expectedPort) ||
    ['4001', '4096', '4097'].includes(expectedPort) ||
    baseUrl !== `http://127.0.0.1:${expectedPort}`
  ) {
    throw new Error('P0 live test requires the declared isolated sandbox API port');
  }
  if (
    !dbPath.startsWith('/private/tmp/') ||
    dbPath.includes('/Library/Application Support/Rhythm/') ||
    process.env.DB_PATH !== dbPath
  ) {
    throw new Error('P0 live test requires one attested disposable migrated DB');
  }
  if (
    !vaultPath.startsWith('/private/tmp/') ||
    vaultPath.includes('/Documents/') ||
    !vaultPath.includes('sandbox')
  ) {
    throw new Error('P0 live test requires a disposable sandbox vault');
  }
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
}

async function apiJson<T>(
  route: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${baseUrl}${route}`, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${route} -> ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) as T : undefined as T;
}

async function poll<T>(
  fn: () => Promise<T>,
  label: string,
  timeoutMs = 20_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${label} timed out: ${String(lastError)}`);
}

async function sendPrompt(
  sessionId: string,
  prompt: string,
): Promise<ProvenanceResponse> {
  const ws = new WebSocket(baseUrl.replace(/^http/, 'ws') + '/ws/agents');
  await new Promise<void>((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify({
    v: 1,
    type: 'session.input',
    id: sessionId,
    data: prompt,
  }));
  const provenance = await poll(async () => {
    const result = await apiJson<ProvenanceResponse>(
      `/agent-sessions/${sessionId}/memory-provenance`,
    );
    if (!result.recorded) throw new Error('turn provenance not recorded yet');
    return result;
  }, `provenance for ${sessionId}`);
  ws.close();
  return provenance;
}

describeLive('P0 live memory injection relevance', () => {
  it('issue-0-c21: real prompt path enforces relevance, isolation, provenance, and persistence', async () => {
    assertIsolated();
    expect((await fetch(`${baseUrl}/health`)).ok).toBe(true);
    expect((await apiJson<{ status: string }>('/opencode/health')).status)
      .toBe('ready');

    const db = new Database(dbPath);
    const runId = randomUUID();
    const ownerToken = randomUUID();
    const otherToken = randomUUID();
    const createdSessionIds: string[] = [];
    const createdUserIds: number[] = [];
    const fixturePaths = {
      worship: `P0-${runId}/Worship Committee agenda.md`,
      mcd: `P0-${runId}/Areas/Research/General/Reports/mcdonalds-world-cup.md`,
      daily: `P0-${runId}/Daily/2026-07-30.md`,
    };
    const fixtureBodies = {
      worship:
        'Worship Committee agenda document for editing order and attendance.',
      mcd:
        'The rare McDonald’s World Cup collector cups are the mascot cup and limited regional team cup.',
      daily:
        'Daily summary about unrelated errands and administrative follow-up.',
    };

    const writeFixture = (
      relative: string,
      frontmatter: string[],
      body: string,
    ) => {
      const absolute = path.join(vaultPath, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(
        absolute,
        ['---', ...frontmatter, '---', body].join('\n'),
        'utf8',
      );
    };

    const insertOwnedPreference = (
      ownerUserId: number,
      content: string,
    ): string => {
      const id = randomUUID();
      const now = new Date().toISOString();
      const sourceId = `preference/p0-${runId}-${ownerUserId}.md`;
      db.prepare(`
        INSERT INTO agent_memory
          (id, kind, content, source, source_id, tags_json, status,
           verified_json, sources_json, trust_tier, owner_user_id,
           auto_injectable, created_at, updated_at)
        VALUES (?, 'preference', ?, 'p0-live-fixture', ?, '[]', 'stable',
                '[]', '[]', 'human', ?, 1, ?, ?)
      `).run(id, content, sourceId, ownerUserId, now, now);
      const row = db.prepare('SELECT rowid FROM agent_memory WHERE id = ?')
        .get(id) as { rowid: number };
      db.prepare(
        `INSERT INTO agent_memory_fts(rowid, content, kind, tags_json)
         VALUES (?, ?, 'preference', '[]')`,
      ).run(row.rowid, content);
      return id;
    };

    const removeMemory = (id: string) => {
      const row = db.prepare(
        'SELECT rowid, content, kind, tags_json FROM agent_memory WHERE id = ?',
      ).get(id) as {
        rowid: number;
        content: string;
        kind: string;
        tags_json: string;
      } | undefined;
      if (!row) return;
      db.prepare(
        `INSERT INTO agent_memory_fts
           (agent_memory_fts, rowid, content, kind, tags_json)
         VALUES ('delete', ?, ?, ?, ?)`,
      ).run(row.rowid, row.content, row.kind, row.tags_json);
      db.prepare('DELETE FROM agent_memory WHERE id = ?').run(id);
    };

    let ownerPreferenceId: string | null = null;
    let otherPreferenceId: string | null = null;
    try {
      const ownerId = Number(db.prepare(
        'INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)',
      ).run(
        'P0 Owner',
        `p0-owner-${runId}@example.com`,
        `p0-owner-${runId}`,
      ).lastInsertRowid);
      const otherId = Number(db.prepare(
        'INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)',
      ).run(
        'P0 Other',
        `p0-other-${runId}@example.com`,
        `p0-other-${runId}`,
      ).lastInsertRowid);
      createdUserIds.push(ownerId, otherId);
      db.prepare(
        'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
      ).run(ownerToken, ownerId, new Date(Date.now() + 600_000).toISOString());
      db.prepare(
        'INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)',
      ).run(otherToken, otherId, new Date(Date.now() + 600_000).toISOString());

      writeFixture(
        fixturePaths.worship,
        ['kind: context', 'injectable: false'],
        fixtureBodies.worship,
      );
      writeFixture(
        fixturePaths.mcd,
        ['kind: fact', 'injectable: true'],
        fixtureBodies.mcd,
      );
      writeFixture(
        fixturePaths.daily,
        ['kind: context', 'injectable: false', 'generated:', '  by: p0-live', '  at: 2026-07-30T00:00:00Z'],
        fixtureBodies.daily,
      );
      await apiJson('/agent-memory/sync', {
        method: 'POST',
        headers: authHeaders(ownerToken),
      });

      const indexed = db.prepare(
        `SELECT id, source_id, auto_injectable
           FROM agent_memory
          WHERE source_id IN (?, ?, ?)`,
      ).all(
        fixturePaths.worship,
        fixturePaths.mcd,
        fixturePaths.daily,
      ) as Array<{
        id: string;
        source_id: string;
        auto_injectable: number;
      }>;
      expect(indexed.find((row) => row.source_id === fixturePaths.worship)?.auto_injectable)
        .toBe(0);
      expect(indexed.find((row) => row.source_id === fixturePaths.mcd)?.auto_injectable)
        .toBe(1);
      expect(indexed.find((row) => row.source_id === fixturePaths.daily)?.auto_injectable)
        .toBe(0);

      ownerPreferenceId = insertOwnedPreference(
        ownerId,
        'P0 direct preference: planning huddles are Tuesday mornings.',
      );
      otherPreferenceId = insertOwnedPreference(
        otherId,
        'P0 direct preference: planning huddles are Friday afternoons.',
      );

      const configs = await apiJson<Array<{
        id: string;
        enabled: boolean;
        sessionSelectable?: boolean;
      }>>('/agent-configs', { headers: authHeaders(ownerToken) });
      const agentId = configs.find((config) =>
        config.enabled && config.sessionSelectable !== false)?.id;
      if (!agentId) throw new Error('No enabled session-selectable agent config');

      const createSession = async (
        token: string,
        label: string,
      ): Promise<string> => {
        const session = await apiJson<{ id: string }>('/agent-sessions', {
          method: 'POST',
          headers: authHeaders(token),
          body: JSON.stringify({
            agentId,
            name: `P0 ${label}`,
            cwd: process.cwd(),
          }),
        });
        createdSessionIds.push(session.id);
        return session.id;
      };

      const unrelatedSession = await createSession(ownerToken, 'unrelated');
      expect((await sendPrompt(unrelatedSession, 'six mins to glob homie')).memoryIds)
        .toEqual([]);

      const worshipSession = await createSession(ownerToken, 'worship');
      expect((
        await sendPrompt(
          worshipSession,
          'Edit the Worship Committee agenda for next week',
        )
      ).memoryIds).toEqual([]);

      const mcdSession = await createSession(ownerToken, 'collector cups');
      const mcdPrompt = 'Which McDonald’s World Cup collector cups are rare?';
      const mcdProvenance = await sendPrompt(mcdSession, mcdPrompt);
      const mcdRow = indexed.find((row) => row.source_id === fixturePaths.mcd);
      expect(mcdProvenance.memoryIds).toContain(mcdRow?.id);
      expect(mcdProvenance.items).toEqual([
        expect.objectContaining({
          memoryId: mcdRow?.id,
          source: 'obsidian-memory',
          sourceId: fixturePaths.mcd,
          lane: expect.stringMatching(/fts|hybrid/),
          score: expect.any(Number),
          reason: expect.stringContaining('threshold'),
        }),
      ]);
      expect(mcdProvenance.items[0].excerptChars).toBeLessThanOrEqual(500);
      expect(mcdProvenance.items[0].estimatedTokens).toBeLessThanOrEqual(125);
      expect(JSON.stringify(mcdProvenance)).not.toContain(fixtureBodies.mcd);

      const ownerSession = await createSession(ownerToken, 'owner A');
      const ownerProvenance = await sendPrompt(
        ownerSession,
        'When are the P0 planning huddles scheduled?',
      );
      expect(ownerProvenance.memoryIds).toContain(ownerPreferenceId);
      expect(ownerProvenance.memoryIds).not.toContain(otherPreferenceId);

      const otherSession = await createSession(otherToken, 'owner B');
      const otherProvenance = await sendPrompt(
        otherSession,
        'When are the P0 planning huddles scheduled?',
      );
      expect(otherProvenance.memoryIds).toContain(otherPreferenceId);
      expect(otherProvenance.memoryIds).not.toContain(ownerPreferenceId);

      await sendPrompt(mcdSession, mcdPrompt);
      const detail = await poll(async () => {
        const response = await apiJson<{
          messages: Array<{ role: string; rawText: string; parts: unknown[] }>;
        }>(`/agent-sessions/${mcdSession}`);
        const inputs = response.messages.filter((message) => message.role === 'input');
        if (inputs.length < 2) {
          throw new Error(`expected two persisted inputs, found ${inputs.length}`);
        }
        return response;
      }, 'persisted original prompts');
      const inputMessages = detail.messages.filter((message) => message.role === 'input');
      expect(inputMessages.map((message) => message.rawText)).toEqual([
        mcdPrompt,
        mcdPrompt,
      ]);
      expect(JSON.stringify(inputMessages)).not.toContain('## Known context');

      const replay = await apiJson<{
        messages: Array<{ rawText: string; parts: unknown[] }>;
      }>(`/agent-sessions/${mcdSession}/messages?limit=20`);
      expect(JSON.stringify(replay)).not.toContain('facts & preferences');

      const searchable = await apiJson<Array<{ sourceId: string }>>(
        `/agent-memory/search?q=${encodeURIComponent('agenda document')}`,
        { headers: authHeaders(ownerToken) },
      );
      expect(searchable.map((row) => row.sourceId)).toContain(
        fixturePaths.worship,
      );
    } finally {
      for (const sessionId of createdSessionIds) {
        await fetch(`${baseUrl}/agent-sessions/${sessionId}`, {
          method: 'DELETE',
          headers: authHeaders(ownerToken),
        }).catch(() => undefined);
      }
      if (ownerPreferenceId) removeMemory(ownerPreferenceId);
      if (otherPreferenceId) removeMemory(otherPreferenceId);
      const fixtureRows = db.prepare(
        `SELECT id FROM agent_memory WHERE source_id IN (?, ?, ?)`,
      ).all(
        fixturePaths.worship,
        fixturePaths.mcd,
        fixturePaths.daily,
      ) as Array<{ id: string }>;
      for (const row of fixtureRows) removeMemory(row.id);
      db.prepare('DELETE FROM sessions WHERE token IN (?, ?)')
        .run(ownerToken, otherToken);
      for (const userId of createdUserIds) {
        try {
          db.prepare('DELETE FROM users WHERE id = ?').run(userId);
        } catch {
          // The disposable sandbox DB is removed after the orchestrated run.
        }
      }
      rmSync(path.join(vaultPath, `P0-${runId}`), {
        recursive: true,
        force: true,
      });
      db.close();
    }
  }, 180_000);
});
