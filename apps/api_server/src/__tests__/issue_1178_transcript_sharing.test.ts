import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { errorHandler } from '../middleware/error_handler';
import {
  sharedTranscriptsRouter,
  transcriptShareCreationRouter,
} from '../routes/shared_transcripts_routes';
import { SharedTranscriptsRepository } from '../repositories/shared_transcripts_repository';
import { transcriptShareReviewHash } from '../services/transcript_share_sanitizer';

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
    db.pragma('foreign_keys = ON');
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
    const sameWorkspaceId = Number(db.prepare(
      `INSERT INTO workspaces (name, join_code, created_by)
       VALUES ('Same org', ?, ?)`,
    ).run(randomUUID(), users.owner.id).lastInsertRowid);
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES (?, ?, 'admin'), (?, ?, 'staff')`,
    ).run(
      sameWorkspaceId, users.owner.id,
      sameWorkspaceId, users.recipient.id,
    );
    const otherWorkspaceId = Number(db.prepare(
      `INSERT INTO workspaces (name, join_code, created_by)
       VALUES ('Other org', ?, ?)`,
    ).run(randomUUID(), users.other.id).lastInsertRowid);
    db.prepare(
      `INSERT INTO workspace_members (workspace_id, user_id, role)
       VALUES (?, ?, 'admin')`,
    ).run(otherWorkspaceId, users.other.id);
    app.use(express.json());
    app.use(transcriptShareCreationRouter);
    app.use('/shares', sharedTranscriptsRouter);
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
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

  function seedStructuredSource(): string {
    const sourceId = randomUUID();
    db.prepare(
      `INSERT INTO agent_sessions
         (id, agent_kind, status, cwd, name, owner_user_id)
       VALUES (?, 'codex', 'idle', '/tmp/issue-1178', 'source', ?)`,
    ).run(sourceId, users.owner.id);
    db.prepare(
      `INSERT INTO agent_session_messages
         (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json)
       VALUES (?, 'system', 'hidden', 'hidden', ?, ?),
              (?, 'input', 'hello', 'hello', ?, ?)`,
    ).run(
      sourceId, randomUUID(), JSON.stringify([
        { id: 'system-part', type: 'text', text: 'hidden instruction' },
      ]),
      sourceId, randomUUID(), JSON.stringify([
        { id: 'user-part', type: 'text', text: 'hello from source' },
      ]),
    );
    return sourceId;
  }

  it('E25C-c1: detached publication is consumable without a source and remains revocable', async () => {
    const sourceId = seedStructuredSource();
    const prepared = await (await fetch(`${baseUrl}/agent-sessions/${sourceId}/shares/review`, { headers: bearer(users.owner.token) })).json() as { reviewHash: string; snapshot: unknown };
    const requestStartedAt = Date.now();
    const response = await fetch(`${baseUrl}/shares`, {
      method: 'POST', headers: { ...bearer(users.owner.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ review: prepared.snapshot, reviewHash: prepared.reviewHash, explicitlyIncludedItemIds: [], recipientUserIds: [users.recipient.id] }),
    });
    const requestFinishedAt = Date.now();
    expect(response.status).toBe(201);
    const share = await response.json() as { id: string; sourceSessionId: unknown; expiresAt: string; snapshot: unknown; ownerUserId: number };
    expect(share.sourceSessionId).toBeNull();
    expect(share.ownerUserId).toBe(users.owner.id);
    expect(Date.parse(share.expiresAt)).toBeGreaterThanOrEqual(
      requestStartedAt + SharedTranscriptsRepository.defaultExpirationMs,
    );
    expect(Date.parse(share.expiresAt)).toBeLessThanOrEqual(
      requestFinishedAt + SharedTranscriptsRepository.defaultExpirationMs,
    );
    db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(sourceId);
    const read = await fetch(`${baseUrl}/shares/${share.id}`, { headers: bearer(users.recipient.token) });
    expect(read.status).toBe(200);
    expect((await read.json() as { snapshot: unknown }).snapshot).toMatchObject(prepared.snapshot as object);
    const listed = await (await fetch(`${baseUrl}/shares`, { headers: bearer(users.recipient.token) })).json() as Array<{ id: string }>;
    expect(listed.map(value => value.id)).toContain(share.id);
    expect(() => db.prepare('UPDATE shared_transcripts SET snapshot_json = ? WHERE id = ?').run('{"items":[]}', share.id)).toThrow(/immutable/i);
    expect((await fetch(`${baseUrl}/shares/${share.id}`, { headers: bearer(users.other.token) })).status).toBe(404);
    expect((await fetch(`${baseUrl}/shares/${share.id}`, { method: 'DELETE', headers: bearer(users.recipient.token) })).status).toBe(404);
    expect((await fetch(`${baseUrl}/shares/${share.id}`, { method: 'DELETE', headers: bearer(users.owner.token) })).status).toBe(204);
    expect((await fetch(`${baseUrl}/shares/${share.id}`, { headers: bearer(users.recipient.token) })).status).toBe(404);
    expect(db.prepare('SELECT actor_user_id, action FROM share_audit_log WHERE share_id = ? ORDER BY timestamp').all(share.id)).toEqual([
      { actor_user_id: users.owner.id, action: 'share' }, { actor_user_id: users.recipient.id, action: 'view' }, { actor_user_id: users.owner.id, action: 'revoke' },
    ]);
  });

  it('uses the approved 90-day cap for explicit detached-share expiry', async () => {
    const sourceId = seedStructuredSource();
    const prepared = await (await fetch(
      `${baseUrl}/agent-sessions/${sourceId}/shares/review`,
      { headers: bearer(users.owner.token) },
    )).json() as { reviewHash: string; snapshot: unknown };
    const body = {
      review: prepared.snapshot,
      reviewHash: prepared.reviewHash,
      explicitlyIncludedItemIds: [],
      recipientUserIds: [users.recipient.id],
    };
    const post = (expiresAt: string) => fetch(`${baseUrl}/shares`, {
      method: 'POST',
      headers: {
        ...bearer(users.owner.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, expiresAt }),
    });

    expect((await post(new Date(Date.now() + 60 * 86400000).toISOString())).status)
      .toBe(201);
    const overCap = await post(
      new Date(Date.now() + 91 * 86400000).toISOString(),
    );
    expect(overCap.status).toBe(400);
    expect(await overCap.text()).toMatch(/90 days/i);
  });

  it('E25C-c2: production rejects malformed publication without mutations and sanitizes forged categories', async () => {
    const body = { reviewHash: 'a'.repeat(64), review: { items: [{ id: 'safe', category: 'message', content: { type: 'text', text: 'hello' } }] }, explicitlyIncludedItemIds: [], recipientUserIds: [users.recipient.id] };
    const post = (value: unknown, token: string = users.owner.token) => fetch(`${baseUrl}/shares`, { method: 'POST', headers: { ...bearer(token), 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const before = db.prepare('SELECT count(*) AS n FROM shared_transcripts').get();
    expect((await post(body, 'invalid')).status).toBe(401);
    for (const patch of [
      { recipientUserIds: [] }, { recipientUserIds: [users.recipient.id, users.recipient.id] },
      { recipientUserIds: [999999] }, { reviewHash: 'bad' }, { ownerUserId: users.other.id },
      { review: { items: [{ id: 'a', category: 'unknown', content: 'x' }] } },
      { review: { items: [body.review.items[0], body.review.items[0]] } },
      { explicitlyIncludedItemIds: ['missing'] }, { explicitlyIncludedItemIds: ['safe', 'safe'] },
      { expiresAt: new Date(Date.now() + 91 * 86400000).toISOString() },
    ]) expect((await post({ ...body, ...patch })).status).toBe(400);
    expect((await post({ ...body, recipientUserIds: [users.other.id] })).status).toBe(403);
    expect(db.prepare('SELECT count(*) AS n FROM shared_transcripts').get()).toEqual(before);
    const result = await post({ ...body, review: { items: [
      ...body.review.items,
      { id: 'forged', category: 'message', content: { type: 'tool', tool: 'gmail_read', output: 'EXCLUDED_RAW_EMAIL' } },
      { id: 'secret', category: 'message', content: { type: 'text', text: 'password=raw-secret /Users/private/secret.txt' } },
    ] }, explicitlyIncludedItemIds: ['secret'] });
    expect(result.status).toBe(201);
    const share = await result.json() as { id: string };
    const consumed = await (await fetch(`${baseUrl}/shares/${share.id}`, { headers: bearer(users.recipient.token) })).json() as { snapshot: { items: unknown[]; reviewHash: string } };
    expect(consumed.snapshot.items).toEqual([body.review.items[0], { id: 'secret', category: 'message', content: { type: 'text', text: '[REDACTED] [REDACTED]' } }]);
    expect(consumed.snapshot.reviewHash).toBe(body.reviewHash);
  });

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

  it('derives classifications and content from source parts, ignoring caller misclassification', async () => {
    const sourceId = seedStructuredSource();
    const prepared = await fetch(`${baseUrl}/agent-sessions/${sourceId}/shares/review`, {
      headers: bearer(users.owner.token),
    });
    expect(prepared.status).toBe(200);
    const { reviewHash } = await prepared.json() as { reviewHash: string };
    const response = await fetch(`${baseUrl}/agent-sessions/${sourceId}/shares`, {
      method: 'POST',
      headers: {
        ...bearer(users.owner.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reviewHash,
        recipientUserIds: [users.recipient.id],
        review: {
          items: [
            {
              id: 'system-part',
              category: 'message',
              content: 'attacker replacement',
            },
            {
              id: 'user-part',
              category: 'system_prompt',
              content: 'attacker replacement',
            },
          ],
        },
      }),
    });
    expect(response.status).toBe(201);
    const share = await response.json() as { id: string };
    const stored = db.prepare(
      'SELECT snapshot_json FROM shared_transcripts WHERE id = ?',
    ).get(share.id) as { snapshot_json: string };
    expect(JSON.parse(stored.snapshot_json)).toEqual({
      items: [{
        id: 'user-part',
        category: 'message',
        content: { id: 'user-part', type: 'text', text: 'hello from source' },
      }],
    });
  });

  it('fails closed with 403 for recipients outside the source owner workspace', async () => {
    const sourceId = seedStructuredSource();
    const response = await fetch(`${baseUrl}/agent-sessions/${sourceId}/shares`, {
      method: 'POST',
      headers: {
        ...bearer(users.owner.token),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipientUserIds: [users.other.id],
        review: {
          items: [{ id: 'user-part', category: 'message', content: 'hello' }],
        },
      }),
    });
    expect(response.status).toBe(403);
  });

  it('E25B-c1: review is owner/admin-only and hashes the entire canonical review deterministically', async () => {
    const sourceId = seedStructuredSource();
    const url = `${baseUrl}/agent-sessions/${sourceId}/shares/review`;
    expect((await fetch(url)).status).toBe(401);
    for (const user of [users.recipient, users.other]) {
      expect((await fetch(url, { headers: bearer(user.token) })).status).toBe(404);
    }
    const first = await fetch(url, { headers: bearer(users.owner.token) });
    expect(first.status).toBe(200);
    const body = await first.json() as { review: { items: unknown[] }; reviewHash: string };
    expect(body.review.items).toHaveLength(2);
    expect(body.reviewHash).toMatch(/^[a-f0-9]{64}$/);
    expect(await (await fetch(url, { headers: bearer(users.owner.token) })).json()).toEqual(body);
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(users.other.id);
    try {
      expect(await (await fetch(url, { headers: bearer(users.other.token) })).json()).toEqual(body);
    } finally { db.prepare("UPDATE users SET role = 'staff' WHERE id = ?").run(users.other.id); }
  });

  it('E25B-c2: missing/malformed hashes cannot silently publish', async () => {
    const sourceId = seedStructuredSource();
    for (const reviewHash of [undefined, '', 'not-a-hash', 42]) {
      const response = await fetch(`${baseUrl}/agent-sessions/${sourceId}/shares`, {
        method: 'POST', headers: { ...bearer(users.owner.token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewHash, recipientUserIds: [users.recipient.id], review: { items: [] } }),
      });
      expect(response.status).toBe(400);
    }
    expect(db.prepare('SELECT count(*) AS n FROM shared_transcripts WHERE source_session_id = ?').get(sourceId)).toEqual({ n: 0 });
  });

  it('E25B-c1: hash canonicalizes nested keys but binds every category/content/item and array order', () => {
    const review = { items: [{ id: 'one', category: 'message' as const, content: { b: 2, a: { y: 4, x: 3 } } }] };
    const hash = transcriptShareReviewHash(review);
    expect(transcriptShareReviewHash({ items: [{ content: { a: { x: 3, y: 4 }, b: 2 }, category: 'message', id: 'one' }] })).toBe(hash);
    for (const changed of [
      { items: [{ ...review.items[0], id: 'two' }] },
      { items: [{ ...review.items[0], category: 'tool_output' as const }] },
      { items: [{ ...review.items[0], content: { b: 9, a: { y: 4, x: 3 } } }] },
      { items: [...review.items, { id: 'added', category: 'message' as const, content: 'new content' }] },
    ]) expect(transcriptShareReviewHash(changed)).not.toBe(hash);
    const ordered = { items: [review.items[0], { id: 'two', category: 'message' as const, content: [1, 2] }] };
    expect(transcriptShareReviewHash(ordered)).not.toBe(transcriptShareReviewHash({ items: [...ordered.items].reverse() }));
  });

  it('E25B-c3: changes to unselected items invalidate review; fresh subset excludes all unselected content', async () => {
    const sourceId = seedStructuredSource(); const url = `${baseUrl}/agent-sessions/${sourceId}/shares`;
    const get = async () => (await (await fetch(`${url}/review`, { headers: bearer(users.owner.token) })).json()) as { reviewHash: string; snapshot: unknown; inclusiveSnapshot: unknown };
    const a = await get();
    expect(a.snapshot).toEqual({ items: [{ id: 'user-part', category: 'message', content: { id: 'user-part', type: 'text', text: 'hello from source' } }] });
    const post = (reviewHash: string, id = 'user-part') => fetch(url, { method: 'POST', headers: { ...bearer(users.owner.token), 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewHash, recipientUserIds: [users.recipient.id], review: { items: [{ id, category: 'message', content: 'ignored client text' }] } }) });
    db.prepare("UPDATE agent_session_messages SET parts_json = ? WHERE session_id = ? AND role = 'system'").run(JSON.stringify([{ id: 'system-part', type: 'text', text: 'unselected revision B' }]), sourceId);
    expect((await post(a.reviewHash)).status).toBe(409);
    const b = await get();
    expect((await post(b.reviewHash, 'unknown-item')).status).toBe(400);
    const response = await post(b.reviewHash); expect(response.status).toBe(201);
    const share = await response.json() as { id: string };
    const read = await fetch(`${baseUrl}/shares/${share.id}`, { headers: bearer(users.recipient.token) });
    expect((await read.json() as { snapshot: unknown }).snapshot).toEqual(a.snapshot);
  });

  it('E25B-c3: changed source rejects old review; fresh exact selection is immutable on recipient read', async () => {
    const sourceId = seedStructuredSource();
    const url = `${baseUrl}/agent-sessions/${sourceId}/shares`;
    const prepare = async () => {
      const response = await fetch(`${url}/review`, { headers: bearer(users.owner.token) });
      expect(response.status).toBe(200);
      return response.json() as Promise<{ reviewHash: string; review: { items: Array<{ id: string; category: string; content: unknown }> } }>;
    };
    const a = await prepare();
    // Same part ID, changed content: ID-only publication is the regression.
    db.prepare("UPDATE agent_session_messages SET parts_json = ? WHERE session_id = ? AND role = 'input'")
      .run(JSON.stringify([{ id: 'user-part', type: 'text', text: 'revision B' }]), sourceId);
    const post = (reviewHash: string) => fetch(url, {
      method: 'POST', headers: { ...bearer(users.owner.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewHash, review: a.review, recipientUserIds: [users.recipient.id], explicitlyIncludedItemIds: ['system-part'] }),
    });
    const stale = await post(a.reviewHash);
    expect(stale.status).toBe(409);
    expect(await stale.text()).not.toContain('revision B');
    expect(db.prepare('SELECT count(*) AS n FROM shared_transcripts WHERE source_session_id = ?').get(sourceId)).toEqual({ n: 0 });
    const b = await prepare();
    expect(b.reviewHash).not.toBe(a.reviewHash);
    const created = await post(b.reviewHash);
    expect(created.status).toBe(201);
    const share = await created.json() as { id: string; snapshot: unknown };
    expect(share.snapshot).toEqual(b.review);
    db.prepare("UPDATE agent_session_messages SET parts_json = '[]', raw_text = 'revision C' WHERE session_id = ?").run(sourceId);
    const read = await fetch(`${baseUrl}/shares/${share.id}`, { headers: bearer(users.recipient.token) });
    expect(read.status).toBe(200);
    expect((await read.json() as { snapshot: unknown }).snapshot).toEqual(b.review);
  });

  it('enforces snapshot immutability and audit retention through direct SQL', async () => {
    const sourceId = seedStructuredSource();
    const repository = new SharedTranscriptsRepository();
    const share = await repository.create({
      snapshot: { items: [{ id: 'safe', category: 'message', content: 'before' }] },
      ownerUserId: users.owner.id,
      recipientUserIds: [users.recipient.id],
      sourceSessionId: sourceId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(() => db.prepare(
      `UPDATE shared_transcripts SET snapshot_json = ? WHERE id = ?`,
    ).run('{"items":[]}', share.id)).toThrow(/immutable/i);
    expect(() => db.prepare(
      'DELETE FROM share_audit_log WHERE share_id = ?',
    ).run(share.id)).toThrow(/append-only/i);

    db.prepare('DELETE FROM shared_transcripts WHERE id = ?').run(share.id);
    const auditCount = db.prepare(
      'SELECT COUNT(*) AS count FROM share_audit_log WHERE share_id = ?',
    ).get(share.id) as { count: number };
    expect(auditCount.count).toBe(1);
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
