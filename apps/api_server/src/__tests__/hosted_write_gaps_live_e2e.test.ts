/**
 * Opt-in real API + engine gate for the hosted-write cleanup contract.
 * Run only against the canonical synthetic dev sandbox on 4198/4197/4199.
 */
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const describeLive = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;
const apiBase = process.env.RHYTHM_LIVE_API_URL;
const engineBase = process.env.RHYTHM_LIVE_ENGINE_URL;
const sandboxDir = process.env.RHYTHM_SANDBOX_DIR;
const dbPath = process.env.DB_PATH;
const ownerToken = 'e02-synthetic-session-not-a-secret';

type Thread = { id: number; title: string };
type Message = { id: number; body: string };
type Rule = { id: string; name: string; enabled: boolean; ownerId: number };

describeLive.sequential('hosted write gaps against the synthetic running sandbox', () => {
  it('enforces creator deletion, cascades thread data, and first-persists a paused owner-scoped rule', async () => {
    assertLiveE2EIsolation();
    expect(apiBase).toBe('http://127.0.0.1:4198');
    expect(engineBase).toBe('http://127.0.0.1:4197');
    expect(sandboxDir).toMatch(/^\/private\/tmp\/rhythm-hosted-write-[^/]+$/);
    expect(dbPath).toBe(path.join(sandboxDir!, 'rhythm.db'));
    expect(realpathSync(dbPath!)).toBe(path.join(realpathSync(sandboxDir!), 'rhythm.db'));

    const health = await fetch(`${apiBase}/health`);
    expect(health.status).toBe(200);
    expect((await health.json() as { status: string }).status).toBe('ok');
    const engineHealth = await fetch(`${apiBase}/opencode/health`);
    expect(engineHealth.status).toBe(200);
    expect((await engineHealth.json() as { status: string }).status).toBe('ready');

    const db = new Database(dbPath!);
    const marker = `MEGA-SANDBOX-HOSTED-WRITE-${randomUUID()}`;
    const memberToken = `synthetic-member-${randomUUID()}`;
    const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };
    const memberHeaders = { Authorization: `Bearer ${memberToken}` };
    const api = (route: string, init: RequestInit = {}, member = false) => fetch(`${apiBase}${route}`, {
      ...init,
      headers: {
        ...(member ? memberHeaders : ownerHeaders),
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    let threadId: number | undefined;
    let ruleId: string | undefined;
    try {
      expect(db.prepare('SELECT id, email FROM users WHERE id = 1').get()).toEqual({ id: 1, email: 'admin@example.invalid' });
      expect(db.prepare('SELECT id, email FROM users WHERE id = 2').get()).toEqual({ id: 2, email: 'member@example.invalid' });
      db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, 2)').run(memberToken);

      const createThread = await api('/message-threads', {
        method: 'POST', body: JSON.stringify({ participantIds: [2], threadType: 'group', title: `${marker}-thread` }),
      });
      expect(createThread.status).toBe(201);
      const thread = await createThread.json() as Thread;
      threadId = thread.id;
      expect(thread.title).toBe(`${marker}-thread`);
      expect((await (await api('/message-threads')).json() as Thread[]).map((row) => row.id)).toContain(threadId);
      expect((await (await api('/message-threads', {}, true)).json() as Thread[]).map((row) => row.id)).toContain(threadId);

      // Both sender and recipient are synthetic sandbox users. This proves the
      // message FK itself cascades, in addition to participant/read metadata.
      const send = await api(`/message-threads/${threadId}/messages`, {
        method: 'POST', body: JSON.stringify({ body: `${marker}-message` }),
      });
      expect(send.status).toBe(201);
      const message = await send.json() as Message;
      expect((await (await api(`/message-threads/${threadId}/messages`, {}, true)).json() as Message[])
        .map((row) => row.id)).toContain(message.id);
      expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE thread_id = ?').get(threadId)).toEqual({ count: 1 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM thread_participants WHERE thread_id = ?').get(threadId)).toEqual({ count: 2 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM thread_reads WHERE thread_id = ?').get(threadId)).toEqual({ count: 2 });

      expect((await api(`/message-threads/${threadId}`, { method: 'DELETE' }, true)).status).toBe(404);
      expect((await (await api('/message-threads', {}, true)).json() as Thread[]).map((row) => row.id)).toContain(threadId);
      expect((await api(`/message-threads/${threadId}`, { method: 'DELETE' })).status).toBe(204);
      expect((await (await api('/message-threads')).json() as Thread[]).map((row) => row.id)).not.toContain(threadId);
      expect((await (await api('/message-threads', {}, true)).json() as Thread[]).map((row) => row.id)).not.toContain(threadId);
      expect((await api(`/message-threads/${threadId}/messages`)).status).toBe(404);
      for (const table of ['message_threads', 'messages', 'thread_participants', 'thread_reads']) {
        const column = table === 'message_threads' ? 'id' : 'thread_id';
        expect(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(threadId)).toEqual({ count: 0 });
      }
      threadId = undefined;

      const createRule = await api('/automation-rules', {
        method: 'POST', body: JSON.stringify({
          name: `${marker}-paused-rule`, source: 'rhythm', triggerKey: 'rhythm.task_due',
          actionType: 'create_task', enabled: false,
        }),
      });
      expect(createRule.status).toBe(201);
      const rule = await createRule.json() as Rule;
      ruleId = rule.id;
      expect(rule).toMatchObject({ name: `${marker}-paused-rule`, enabled: false, ownerId: 1 });
      expect(db.prepare('SELECT enabled FROM automation_rules WHERE id = ?').get(ruleId)).toEqual({ enabled: 0 });
      const ownRule = await api(`/automation-rules/${ruleId}`);
      expect(ownRule.status).toBe(200);
      expect((await ownRule.json() as Rule).enabled).toBe(false);
      expect((await api(`/automation-rules/${ruleId}`, {}, true)).status).toBe(404);
      expect((await api(`/automation-rules/${ruleId}`, { method: 'DELETE' }, true)).status).toBe(404);
      expect((await api(`/automation-rules/${ruleId}`)).status).toBe(200);
      expect((await api(`/automation-rules/${ruleId}`, { method: 'DELETE' })).status).toBe(204);
      expect((await api(`/automation-rules/${ruleId}`)).status).toBe(404);
      expect(db.prepare('SELECT COUNT(*) AS count FROM automation_rules WHERE id = ?').get(ruleId)).toEqual({ count: 0 });
      ruleId = undefined;
    } finally {
      if (threadId !== undefined) await api(`/message-threads/${threadId}`, { method: 'DELETE' }).catch(() => undefined);
      if (ruleId !== undefined) await api(`/automation-rules/${ruleId}`, { method: 'DELETE' }).catch(() => undefined);
      db.prepare('DELETE FROM sessions WHERE token = ? AND user_id = 2').run(memberToken);
      db.close();
    }
  }, 30_000);
});
