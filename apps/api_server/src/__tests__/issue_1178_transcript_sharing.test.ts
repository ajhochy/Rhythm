import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { errorHandler } from '../middleware/error_handler';
import { sharedTranscriptsRouter } from '../routes/shared_transcripts_routes';
import { SharedTranscriptsRepository } from '../repositories/shared_transcripts_repository';

describe('issue #1178 transcript sharing contracts', () => {
  const db = new Database(':memory:');
  const app = express();
  let server: ReturnType<typeof app.listen>;
  let baseUrl = '';
  const users = {
    owner: { id: 0, token: randomUUID() },
    recipient: { id: 0, token: randomUUID() },
    other: { id: 0, token: randomUUID() },
  };

  beforeAll(async () => {
    runMigrations(db);
    setDb(db);
    for (const [role, principal] of Object.entries(users)) {
      principal.id = Number(db.prepare(
        `INSERT INTO users (name, email, google_sub)
         VALUES (?, ?, ?)`,
      ).run(role, `${role}-${randomUUID()}@example.com`, randomUUID()).lastInsertRowid);
      db.prepare(
        `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
      ).run(principal.token, principal.id, new Date(Date.now() + 60_000).toISOString());
    }
    app.use(express.json());
    app.use('/shares', sharedTranscriptsRouter);
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

  function bearer(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }

  function seedShare(overrides: {
    expiresAt?: string;
    revokedAt?: string | null;
    deleteSource?: boolean;
  } = {}): string {
    const id = randomUUID();
    const sourceId = randomUUID();
    db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, owner_user_id)
       VALUES (?, 'codex', 'idle', '/tmp/issue-1178', 'source', ?)`,
    ).run(sourceId, users.owner.id);
    db.prepare(
      `INSERT INTO shared_transcripts
         (id, snapshot_json, owner_user_id, recipient_user_ids_json,
          created_at, expires_at, revoked_at, source_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      JSON.stringify({ items: [{ id: 'safe', category: 'message', content: 'hello' }] }),
      users.owner.id,
      JSON.stringify([users.recipient.id]),
      new Date().toISOString(),
      overrides.expiresAt ?? new Date(Date.now() + 60_000).toISOString(),
      overrides.revokedAt ?? null,
      sourceId,
    );
    if (overrides.deleteSource) {
      db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sourceId);
    }
    return id;
  }

  it('issue-1178-c3: enforces the complete read authorization matrix', async () => {
    const activeId = seedShare();
    for (const principal of [users.owner, users.recipient]) {
      const response = await fetch(`${baseUrl}/shares/${activeId}`, {
        headers: bearer(principal.token),
      });
      expect(response.status).toBe(200);
    }
    const other = await fetch(`${baseUrl}/shares/${activeId}`, {
      headers: bearer(users.other.token),
    });
    expect(other.status).toBe(404);

    for (const id of [
      randomUUID(),
      seedShare({ expiresAt: new Date(Date.now() - 1_000).toISOString() }),
      seedShare({ revokedAt: new Date().toISOString() }),
      seedShare({ deleteSource: true }),
    ]) {
      const response = await fetch(`${baseUrl}/shares/${id}`, {
        headers: bearer(users.recipient.token),
      });
      expect(response.status).toBe(404);
    }
  });

  it('scopes every share-list response to the owner or a named recipient', async () => {
    const id = seedShare();
    for (const principal of [users.owner, users.recipient]) {
      const response = await fetch(`${baseUrl}/shares`, {
        headers: bearer(principal.token),
      });
      expect(response.status).toBe(200);
      const shares = await response.json() as Array<{ id: string }>;
      expect(shares.map((share) => share.id)).toContain(id);
    }
    const otherResponse = await fetch(`${baseUrl}/shares`, {
      headers: bearer(users.other.token),
    });
    const otherShares = await otherResponse.json() as Array<{ id: string }>;
    expect(otherShares.map((share) => share.id)).not.toContain(id);
  });

  it('issue-1178-c2: stored snapshots remain immutable after the source session changes', async () => {
    const sourceId = randomUUID();
    db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, owner_user_id, last_preview)
       VALUES (?, 'codex', 'idle', '/tmp/issue-1178', 'source', ?, 'before')`,
    ).run(sourceId, users.owner.id);
    const repository = new SharedTranscriptsRepository();
    const share = await repository.create({
      snapshot: { items: [{ id: 'preview', category: 'message', content: 'before' }] },
      ownerUserId: users.owner.id,
      recipientUserIds: [users.recipient.id],
      sourceSessionId: sourceId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    db.prepare(
      `UPDATE agent_sessions SET last_preview = 'after' WHERE id = ?`,
    ).run(sourceId);
    expect((await repository.findWithLiveSource(share.id))?.snapshot)
      .toEqual({ items: [{ id: 'preview', category: 'message', content: 'before' }] });
  });

  it('issue-1178-c1/c7: requires reviewed content and contains no external auto-share path', () => {
    const sourceFiles = [
      'controllers/shared_transcripts_controller.ts',
      'repositories/shared_transcripts_repository.ts',
      'routes/shared_transcripts_routes.ts',
      'services/transcript_share_sanitizer.ts',
      'app.ts',
    ];
    const apiSourceRoot = path.resolve(__dirname, '..');
    const combined = sourceFiles.map((file) =>
      readFileSync(path.join(apiSourceRoot, file), 'utf8')).join('\n');
    expect(combined).toContain('review.items is required');
    expect(combined).not.toMatch(/OPENCODE_AUTO_SHARE|opncd\.ai/i);
  });

  it('keeps the additive transcript-share schema present in both database bootstraps', () => {
    const apiSourceRoot = path.resolve(__dirname, '..');
    for (const migrationFile of [
      'database/migrations.ts',
      'database/postgres_bootstrap.ts',
    ]) {
      const source = readFileSync(path.join(apiSourceRoot, migrationFile), 'utf8');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS shared_transcripts');
      expect(source).toContain('CREATE TABLE IF NOT EXISTS share_audit_log');
      expect(source).toContain("action IN ('share', 'view', 'revoke', 'delete')");
    }
  });
});
