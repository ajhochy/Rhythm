import { randomUUID } from 'node:crypto';
import express from 'express';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { errorHandler } from '../middleware/error_handler';
import { SharedTranscriptsRepository } from '../repositories/shared_transcripts_repository';
import { transcriptShareCreationRouter } from '../routes/shared_transcripts_routes';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('issue #1375 transcript-share retention contracts', () => {
  const db = new Database(':memory:');
  const app = express();
  const ownerToken = randomUUID();
  let server: ReturnType<typeof app.listen>;
  let baseUrl = '';
  let ownerId = 0;
  let recipientId = 0;

  beforeAll(async () => {
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    ownerId = Number(db.prepare(
      `INSERT INTO users (name, email, google_sub) VALUES ('owner', ?, ?)`,
    ).run(`${randomUUID()}@example.com`, randomUUID()).lastInsertRowid);
    recipientId = Number(db.prepare(
      `INSERT INTO users (name, email, google_sub) VALUES ('recipient', ?, ?)`,
    ).run(`${randomUUID()}@example.com`, randomUUID()).lastInsertRowid);
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .run(ownerToken, ownerId, new Date(Date.now() + 60_000).toISOString());
    const workspaceId = Number(db.prepare(
      `INSERT INTO workspaces (name, join_code, created_by) VALUES ('Retention', ?, ?)`,
    ).run(randomUUID(), ownerId).lastInsertRowid);
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES (?, ?, 'admin'), (?, ?, 'staff')`,
    ).run(workspaceId, ownerId, workspaceId, recipientId);
    app.use(express.json());
    app.use(transcriptShareCreationRouter);
    app.use(errorHandler);
    server = app.listen(0);
    server.maxRequestsPerSocket = 1;
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
  });

  function source(): string {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, owner_user_id)
       VALUES (?, 'codex', 'idle', '/tmp/issue-1375', 'source survives', ?)`,
    ).run(id, ownerId);
    db.prepare(
      `INSERT INTO agent_session_messages
         (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json)
       VALUES (?, 'input', ?, ?, ?, ?)`,
    ).run(
      id,
      'source bytes \u0000 unchanged',
      'source bytes \u0000 unchanged',
      randomUUID(),
      JSON.stringify([{ id: 'safe', type: 'text', text: 'source bytes' }]),
    );
    return id;
  }

  function purgeMethod(repository: SharedTranscriptsRepository) {
    const purge = (repository as unknown as Record<string, unknown>).purgeDueSnapshots;
    expect(purge, 'regression: repository purge entry point is missing').toBeTypeOf('function');
    return purge as (now?: Date) => Promise<number>;
  }

  it('issue-1375-c1: the authenticated create-share route and repository fallback default to 90 days', async () => {
    const sourceSessionId = source();
    const beforeRoute = Date.now();
    const response = await fetch(`${baseUrl}/agent-sessions/${sourceSessionId}/shares`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ownerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipientUserIds: [recipientId],
        review: { items: [{ id: 'safe', category: 'message' }] },
      }),
    });
    const afterRoute = Date.now();
    expect(response.status).toBe(201);
    const routeShare = await response.json() as { id: string; expiresAt: string };
    const routeExpiration = new Date(routeShare.expiresAt).getTime();
    expect(routeExpiration).toBeGreaterThanOrEqual(beforeRoute + 90 * DAY_MS);
    expect(routeExpiration).toBeLessThanOrEqual(afterRoute + 90 * DAY_MS);
    expect(db.prepare('SELECT expires_at FROM shared_transcripts WHERE id = ?').get(routeShare.id))
      .toEqual({ expires_at: routeShare.expiresAt });

    const repository = new SharedTranscriptsRepository();
    const before = Date.now();
    const share = await repository.create({
      snapshot: { items: [{ id: 'safe', category: 'message', content: 'safe' }] },
      ownerUserId: ownerId,
      recipientUserIds: [recipientId],
      sourceSessionId: source(),
    });
    const after = Date.now();
    expect(new Date(share.expiresAt).getTime()).toBeGreaterThanOrEqual(before + 90 * DAY_MS);
    expect(new Date(share.expiresAt).getTime()).toBeLessThanOrEqual(after + 90 * DAY_MS);
  });

  it('issue-1375-c2: purges only shares at least 30 days past expiry or revocation', async () => {
    const repository = new SharedTranscriptsRepository();
    const purge = purgeMethod(repository);
    const now = new Date('2026-08-20T12:00:00.000Z');
    const old = new Date(now.getTime() - 31 * DAY_MS).toISOString();
    const recent = new Date(now.getTime() - 29 * DAY_MS).toISOString();
    const dueExpired = await repository.create({
      snapshot: { items: [{ id: 'expired', category: 'message', content: 'expired bytes' }] },
      ownerUserId: ownerId,
      recipientUserIds: [recipientId],
      sourceSessionId: source(),
      expiresAt: old,
    });
    const dueRevoked = await repository.create({
      snapshot: { items: [{ id: 'revoked', category: 'message', content: 'revoked bytes' }] },
      ownerUserId: ownerId,
      recipientUserIds: [recipientId],
      sourceSessionId: source(),
      expiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
    });
    db.prepare('UPDATE shared_transcripts SET revoked_at = ? WHERE id = ?')
      .run(old, dueRevoked.id);
    const recentExpired = await repository.create({
      snapshot: { items: [{ id: 'recent', category: 'message', content: 'recent bytes' }] },
      ownerUserId: ownerId,
      recipientUserIds: [recipientId],
      sourceSessionId: source(),
      expiresAt: recent,
    });
    const active = await repository.create({
      snapshot: { items: [{ id: 'active', category: 'message', content: 'active bytes' }] },
      ownerUserId: ownerId,
      recipientUserIds: [recipientId],
      sourceSessionId: source(),
      expiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
    });

    expect(await purge.call(repository, now)).toBe(2);
    for (const id of [recentExpired.id, active.id]) {
      expect(db.prepare('SELECT id FROM shared_transcripts WHERE id = ?').get(id))
        .toEqual({ id });
    }
    for (const id of [dueExpired.id, dueRevoked.id]) {
      expect(db.prepare('SELECT id FROM shared_transcripts WHERE id = ?').get(id)).toBeUndefined();
      expect(db.prepare(
        `SELECT action FROM share_audit_log WHERE share_id = ? AND action = 'delete'`,
      ).get(id)).toEqual({ action: 'delete' });
    }
    const auditColumns = db.prepare('PRAGMA table_info(share_audit_log)').all()
      .map((column) => (column as { name: string }).name);
    expect(auditColumns).not.toContain('snapshot_json');
    expect(auditColumns).not.toContain('content');
  });

  it('issue-1375-c2: rolls back the share delete when the delete audit fails', async () => {
    const repository = new SharedTranscriptsRepository();
    const purge = purgeMethod(repository);
    const share = await repository.create({
      snapshot: { items: [{ id: 'rollback', category: 'message', content: 'keep me' }] },
      ownerUserId: ownerId,
      recipientUserIds: [recipientId],
      sourceSessionId: source(),
      expiresAt: new Date(Date.now() - 31 * DAY_MS).toISOString(),
    });
    db.exec(`CREATE TRIGGER fail_issue_1375_delete_audit
      BEFORE INSERT ON share_audit_log
      WHEN NEW.action = 'delete' AND NEW.share_id = '${share.id}'
      BEGIN SELECT RAISE(ABORT, 'induced delete audit failure'); END`);

    await expect(purge.call(repository, new Date())).rejects.toThrow(/induced delete audit failure/);
    expect(db.prepare('SELECT snapshot_json FROM shared_transcripts WHERE id = ?').get(share.id))
      .toBeDefined();
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM share_audit_log WHERE share_id = ? AND action = 'delete'`,
    ).get(share.id)).toEqual({ count: 0 });
    db.exec('DROP TRIGGER fail_issue_1375_delete_audit');
    db.prepare('DELETE FROM shared_transcripts WHERE id = ?').run(share.id);
  });

  it('issue-1375-c3: two purges are idempotent and preserve source bytes', async () => {
    const repository = new SharedTranscriptsRepository();
    const purge = purgeMethod(repository);
    const sourceId = source();
    const share = await repository.create({
      snapshot: { items: [{ id: 'safe', category: 'message', content: 'snapshot bytes' }] },
      ownerUserId: ownerId,
      recipientUserIds: [recipientId],
      sourceSessionId: sourceId,
      expiresAt: new Date(Date.now() - 31 * DAY_MS).toISOString(),
    });
    const beforeSession = db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(sourceId);
    const beforeMessages = db.prepare(
      'SELECT * FROM agent_session_messages WHERE session_id = ? ORDER BY id',
    ).all(sourceId);

    expect(await purge.call(repository, new Date())).toBe(1);
    expect(await purge.call(repository, new Date())).toBe(0);
    expect(db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get(sourceId))
      .toEqual(beforeSession);
    expect(db.prepare(
      'SELECT * FROM agent_session_messages WHERE session_id = ? ORDER BY id',
    ).all(sourceId)).toEqual(beforeMessages);
    expect(db.prepare(
      `SELECT COUNT(*) AS count FROM share_audit_log
       WHERE share_id = ? AND action = 'delete'`,
    ).get(share.id)).toEqual({ count: 1 });
  });
});
