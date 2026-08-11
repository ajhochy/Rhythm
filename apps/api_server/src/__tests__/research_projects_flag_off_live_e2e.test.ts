/** #1300 default-off process-start regression. Run in a fresh flag-off sandbox. */
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe : describe.skip;
const base = process.env.RHYTHM_LIVE_API_URL ?? 'http://127.0.0.1:4098';
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? process.env.DB_PATH;
let db: Database.Database; let userId: number; let token: string;

describeLive('issue #1300 flag-off live regression', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    if (!dbPath || new URL(base).port !== '4098') throw new Error('isolated :4098 sandbox DB is required');
    const health = await (await fetch(`${base}/health`)).json() as { features: { researchProjectsEnabled: boolean } };
    expect(health.features.researchProjectsEnabled).toBe(false);
    db = new Database(dbPath);
    userId = Number(db.prepare('INSERT INTO users (name,email) VALUES (?,?)').run('Issue 1300 flag off', `issue-1300-off-${randomUUID()}@example.test`).lastInsertRowid);
    token = randomUUID(); db.prepare('INSERT INTO sessions (token,user_id) VALUES (?,?)').run(token, userId);
  });
  afterAll(() => { if (db) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId); db.prepare('DELETE FROM users WHERE id=?').run(userId); db.close(); } });

  it('conceals project routes while legacy /agent-research still completes', async () => {
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    expect((await fetch(`${base}/agent-research/projects`, { headers })).status).toBe(404);
    const created = await fetch(`${base}/agent-research`, {
      method: 'POST', headers, body: JSON.stringify({ query: 'Summarize one authoritative source about local-first software.' }),
    });
    expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    let final: { status: string; report?: string | null; error?: string | null } | undefined;
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      final = await (await fetch(`${base}/agent-research/${id}`, { headers })).json() as typeof final;
      if (final?.status === 'done' || final?.status === 'error') break;
    }
    expect(final?.status, final?.error ?? 'legacy research timed out').toBe('done');
    expect(final?.report?.trim()).toBeTruthy();
  }, 420_000);
});
