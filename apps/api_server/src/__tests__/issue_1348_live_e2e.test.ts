/**
 * Live HTTP contract for #1348. Run only against tools/dev/sandbox.sh:
 *
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_E2E_ISOLATED=1 \
 * RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 * RHYTHM_LIVE_DB_PATH=/private/tmp/.../rhythm.db \
 * npx vitest run src/__tests__/issue_1348_live_e2e.test.ts
 */
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const DB_PATH = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const createdIds: string[] = [];

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function createSession(name: string): Promise<string> {
  const response = await api('/agent-sessions', {
    method: 'POST',
    body: JSON.stringify({
      agentId: null,
      cwd: process.cwd(),
      name,
    }),
  });
  const body = (await response.json()) as { id?: string; error?: string };
  if (!response.ok || !body.id) {
    throw new Error(`create session -> ${response.status}: ${JSON.stringify(body)}`);
  }
  createdIds.push(body.id);
  return body.id;
}

beforeAll(async () => {
  const resolvedDbPath = resolve(DB_PATH);
  if (
    process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
    !/^http:\/\/127\.0\.0\.1:(?!4001$|4096$)\d{4,5}$/.test(BASE) ||
    (!resolvedDbPath.startsWith('/private/tmp/') && !resolvedDbPath.startsWith('/tmp/'))
  ) {
    throw new Error('issue #1348 live test requires the isolated dev sandbox');
  }
  const health = await api('/health');
  if (!health.ok) throw new Error(`sandbox server is not reachable at ${BASE}`);
});

afterEach(async () => {
  for (const id of createdIds.splice(0)) {
    await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
  }
});

describeLive('live E2E — #1348 chat roots only', () => {
  it('GET scope=chats returns the parent and its delegated child (grouped under parent client-side)', async () => {
    const suffix = Date.now().toString(36);
    const parentId = await createSession(`1348 parent ${suffix}`);
    const childId = await createSession(`1348 child ${suffix}`);

    const db = new Database(DB_PATH);
    db.prepare(
      `UPDATE agent_sessions
          SET parent_session_id = ?, delegation_depth = 1
        WHERE id = ?`,
    ).run(parentId, childId);
    db.close();

    const response = await api('/agent-sessions?scope=chats');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { sessions: Array<{ id: string }> };
    const ids = body.sessions.map((session) => session.id);
    expect(ids).toContain(parentId);
    expect(ids).toContain(childId);
  });
});
