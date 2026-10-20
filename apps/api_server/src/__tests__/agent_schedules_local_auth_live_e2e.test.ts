/** Real sandbox API + engine gate for local schedule owner attribution. */
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

describe.runIf(process.env.RHYTHM_LIVE_E2E === '1')('real sandbox local schedule auth', () => {
  it('attributes a disabled schedule to its verified Bearer user and rejects an invalid token', async () => {
    assertLiveE2EIsolation();
    const fixtureRoot = realpathSync(process.env.RHYTHM_APPROVED_FIXTURE_ROOT ?? '');
    const sourceDb = realpathSync(process.env.RHYTHM_LIVE_DB_PATH ?? '');
    const sourceConfig = realpathSync(process.env.RHYTHM_SANDBOX_OPENCODE_CONFIG ?? '');
    const sandboxDir = resolve(process.env.RHYTHM_SANDBOX_DIR ?? '');
    const dbPath = resolve(process.env.DB_PATH ?? '');
    const api = process.env.RHYTHM_LIVE_URL ?? '';
    const engine = process.env.RHYTHM_LIVE_ENGINE_URL ?? '';
    expect(fixtureRoot).toMatch(/^\/private\/tmp\/rhythm-[^/]+/);
    expect(sourceDb).toBe(join(fixtureRoot, 'rhythm.db'));
    expect(sourceConfig.startsWith(`${fixtureRoot}/`)).toBe(true);
    expect(statSync(sourceDb).mode & 0o222).toBe(0);
    expect(statSync(sourceConfig).mode & 0o222).toBe(0);
    expect(sandboxDir).toMatch(/^\/private\/tmp\/rhythm-[^/]+/);
    expect(dbPath).toBe(join(sandboxDir, 'rhythm.db'));
    expect(api).toBe('http://127.0.0.1:4098');
    expect(engine).toBe('http://127.0.0.1:4097');
    const health = await fetch(`${engine}/global/health`, { signal: AbortSignal.timeout(10_000) });
    expect(health.status).toBe(200);
    expect((await health.json() as { healthy: boolean }).healthy).toBe(true);

    const db = new Database(dbPath);
    const runId = randomUUID();
    const name = `[smoke] local schedule owner ${runId}`;
    const token = `synthetic-schedule-${runId}`;
    let userId: number | null = null;
    let scheduleId: string | null = null;
    try {
      userId = Number(db.prepare(
        'INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)',
      ).run('Synthetic schedule owner', `schedule-${runId}@example.invalid`, `schedule-${runId}`).lastInsertRowid);
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
        .run(token, userId, new Date(Date.now() + 10 * 60_000).toISOString());
      const identity = await fetch(`${api}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000),
      });
      expect(identity.status).toBe(200);
      expect(JSON.stringify(await identity.json())).toContain(`"id":${userId}`);

      const payload = JSON.stringify({
        name, scheduleType: 'daily', scheduledTime: '09:00',
        prompt: 'Disabled synthetic fixture; never execute', enabled: false,
        createdByUserId: userId + 10000,
      });
      const invalid = await fetch(`${api}/agent-schedules`, {
        method: 'POST', headers: { Authorization: 'Bearer invalid-synthetic-token', 'Content-Type': 'application/json' },
        body: payload, signal: AbortSignal.timeout(10_000),
      });
      expect(invalid.status).toBe(401);
      const createdResponse = await fetch(`${api}/agent-schedules`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: payload, signal: AbortSignal.timeout(10_000),
      });
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as { id: string; enabled: boolean; createdByUserId: number | null };
      scheduleId = created.id;
      expect(created.enabled).toBe(false);
      expect(created.createdByUserId).toBe(userId);
      expect((db.prepare('SELECT created_by_user_id, enabled FROM agent_scheduled_tasks WHERE id = ?')
        .get(scheduleId) as { created_by_user_id: number | null; enabled: number }))
        .toEqual({ created_by_user_id: userId, enabled: 0 });
    } finally {
      if (scheduleId) db.prepare('DELETE FROM agent_scheduled_tasks WHERE id = ? AND name = ?').run(scheduleId, name);
      // A failed POST can still leave a row; the unique smoke name owns it.
      db.prepare('DELETE FROM agent_scheduled_tasks WHERE name = ?').run(name);
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      if (userId !== null) db.prepare('DELETE FROM users WHERE id = ? AND email = ?')
        .run(userId, `schedule-${runId}@example.invalid`);
      db.close();
    }
  }, 30_000);
});
