import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = LIVE ? describe : describe.skip;
const baseUrl = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const dbPath = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const expectedPort = process.env.RHYTHM_SANDBOX_API_PORT ?? '';

describeLive('issue_1178_transcript_sharing_live', () => {
  it('creates, reads, audits, and immediately revokes a sanitized snapshot through real HTTP', async () => {
    if (
      !/^\d{4,5}$/.test(expectedPort) ||
      ['4001', '4096', '4097', '4098'].includes(expectedPort) ||
      baseUrl !== `http://127.0.0.1:${expectedPort}`
    ) {
      throw new Error('RHYTHM_LIVE_URL must use the declared isolated alternate port');
    }
    if (
      process.env.RHYTHM_LIVE_E2E_ISOLATED !== '1' ||
      !dbPath.startsWith('/') ||
      dbPath.includes('/Library/Application Support/Rhythm/')
    ) {
      throw new Error('Live transcript-share test requires an attested isolated database');
    }

    const db = new Database(dbPath);
    const runId = randomUUID();
    const sourceId = randomUUID();
    const ownerToken = randomUUID();
    const recipientToken = randomUUID();
    let ownerId: number | null = null;
    let recipientId: number | null = null;
    let shareId: string | null = null;
    const headers = (token: string) => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
    try {
      ownerId = Number(db.prepare(
        `INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)`,
      ).run('Issue 1178 Owner', `owner-${runId}@example.com`, `owner-${runId}`)
        .lastInsertRowid);
      recipientId = Number(db.prepare(
        `INSERT INTO users (name, email, google_sub) VALUES (?, ?, ?)`,
      ).run('Issue 1178 Recipient', `recipient-${runId}@example.com`,
        `recipient-${runId}`).lastInsertRowid);
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
        .run(ownerToken, ownerId, new Date(Date.now() + 600_000).toISOString());
      db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
        .run(recipientToken, recipientId, new Date(Date.now() + 600_000).toISOString());
      // Recipients must share a workspace with the owner (fail-closed 403).
      const workspaceId = Number(db.prepare(
        `INSERT INTO workspaces (name, join_code, created_by) VALUES (?, ?, ?)`,
      ).run(`Issue 1178 Workspace ${runId}`, `join-${runId}`, ownerId)
        .lastInsertRowid);
      db.prepare(
        'INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)',
      ).run(workspaceId, ownerId);
      db.prepare(
        'INSERT INTO workspace_members (workspace_id, user_id) VALUES (?, ?)',
      ).run(workspaceId, recipientId);
      db.prepare(
        `INSERT INTO agent_sessions
           (id, agent_kind, status, cwd, name, owner_user_id)
         VALUES (?, 'codex', 'idle', '/tmp/issue-1178', 'live source', ?)`,
      ).run(sourceId, ownerId);
      // Snapshots derive from persisted parts; the review may only select
      // derived item ids, so the source transcript must really exist.
      db.prepare(
        `INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, parts_json)
         VALUES (?, 'user', 'approved transcript', 'approved transcript', ?)`,
      ).run(sourceId, JSON.stringify([
        { id: 'safe', type: 'text', text: 'approved transcript' },
        { id: 'secret', type: 'text', text: 'Authorization: Bearer abc.def.ghi' },
      ]));
      db.prepare(
        `INSERT INTO agent_session_messages (session_id, role, raw_text, stripped_text, parts_json)
         VALUES (?, 'output', 'tool result', 'tool result', ?)`,
      ).run(sourceId, JSON.stringify([
        { id: 'tool', type: 'tool', tool: 'read', state: { output: 'private tool result' } },
      ]));

      const createdResponse = await fetch(`${baseUrl}/agent-sessions/${sourceId}/shares`, {
        method: 'POST',
        headers: headers(ownerToken),
        body: JSON.stringify({
          recipientUserIds: [recipientId],
          review: {
            items: [
              { id: 'safe', category: 'message', content: 'approved transcript' },
              { id: 'secret', category: 'message', content: 'Authorization: Bearer abc.def.ghi' },
              { id: 'tool', category: 'tool_output', content: 'private tool result' },
            ],
          },
          explicitlyIncludedItemIds: [],
        }),
      });
      expect(createdResponse.status).toBe(201);
      const created = await createdResponse.json() as { id: string };
      shareId = created.id;

      const stored = db.prepare(
        'SELECT snapshot_json, owner_user_id, recipient_user_ids_json FROM shared_transcripts WHERE id = ?',
      ).get(shareId) as {
        snapshot_json: string;
        owner_user_id: number;
        recipient_user_ids_json: string;
      };
      expect(stored.owner_user_id).toBe(ownerId);
      expect(JSON.parse(stored.recipient_user_ids_json)).toEqual([recipientId]);
      expect(stored.snapshot_json).toContain('approved transcript');
      expect(stored.snapshot_json).not.toMatch(/abc\.def\.ghi|private tool result/);

      const recipientRead = await fetch(`${baseUrl}/shares/${shareId}`, {
        headers: headers(recipientToken),
      });
      expect(recipientRead.status).toBe(200);

      const revoked = await fetch(`${baseUrl}/shares/${shareId}`, {
        method: 'DELETE',
        headers: headers(ownerToken),
      });
      expect(revoked.status).toBe(204);
      const denied = await fetch(`${baseUrl}/shares/${shareId}`, {
        headers: headers(recipientToken),
      });
      expect(denied.status).toBe(404);

      const audit = db.prepare(
        'SELECT action, actor_user_id FROM share_audit_log WHERE share_id = ? ORDER BY timestamp',
      ).all(shareId) as Array<{ action: string; actor_user_id: number }>;
      expect(audit.map((entry) => entry.action)).toEqual(['share', 'view', 'revoke']);
      expect(audit.map((entry) => entry.actor_user_id))
        .toEqual([ownerId, recipientId, ownerId]);
    } finally {
      // Share/audit rows are protected by append-only DB triggers, and user
      // deletion cascades into them — the guard correctly refuses. The
      // sandbox DB is destroyed after the run, so leave protected fixtures
      // in place rather than fighting the trigger.
      const tryDelete = (sql: string, ...args: unknown[]) => {
        try {
          db.prepare(sql).run(...args);
        } catch {
          // blocked by the append-only audit guard — expected
        }
      };
      if (shareId) tryDelete('DELETE FROM shared_transcripts WHERE id = ?', shareId);
      tryDelete('DELETE FROM agent_sessions WHERE id = ?', sourceId);
      tryDelete('DELETE FROM sessions WHERE token IN (?, ?)', ownerToken, recipientToken);
      if (ownerId !== null) tryDelete('DELETE FROM users WHERE id = ?', ownerId);
      if (recipientId !== null) tryDelete('DELETE FROM users WHERE id = ?', recipientId);
      db.close();
    }
  });
});
