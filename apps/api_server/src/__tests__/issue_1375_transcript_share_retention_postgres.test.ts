import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import * as database from '../database/db';
import { SharedTranscriptsRepository } from '../repositories/shared_transcripts_repository';

const DAY_MS = 24 * 60 * 60 * 1000;
const liveDescribe = process.env.RHYTHM_LIVE_POSTGRES_RETENTION === '1'
  ? describe
  : describe.skip;

liveDescribe('issue #1375 disposable Postgres retention contract', () => {
  const schema = `issue_1375_${randomUUID().replaceAll('-', '_')}`;
  let adminPool: Pool;
  let pool: Pool;
  let originalDbClient: typeof env.dbClient;

  beforeAll(async () => {
    const connectionString = process.env.RHYTHM_LIVE_POSTGRES_URL;
    if (!connectionString) throw new Error('RHYTHM_LIVE_POSTGRES_URL is required');
    adminPool = new Pool({ connectionString, max: 1 });
    pool = new Pool({ connectionString, max: 1, options: `-c search_path=${schema}` });
    await adminPool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`
      CREATE TABLE users (id INTEGER PRIMARY KEY);
      CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, raw_bytes BYTEA NOT NULL);
      CREATE TABLE agent_session_messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, raw_bytes BYTEA NOT NULL);
      CREATE TABLE shared_transcripts (
        id TEXT PRIMARY KEY,
        snapshot_json JSONB NOT NULL,
        owner_user_id INTEGER NOT NULL,
        recipient_user_ids_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        source_session_id TEXT NOT NULL
      );
      CREATE TABLE share_audit_log (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL,
        actor_user_id INTEGER NOT NULL,
        action TEXT NOT NULL,
        timestamp TIMESTAMPTZ NOT NULL
      );
      INSERT INTO users (id) VALUES (1);
    `);
    originalDbClient = env.dbClient;
    (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = 'postgres';
    vi.spyOn(database, 'getPostgresPool').mockReturnValue(pool);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    (env as { dbClient: 'sqlite' | 'postgres' }).dbClient = originalDbClient;
    await pool.end();
    await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await adminPool.end();
  });

  async function seed(input: {
    expiresAt: Date | null;
    revokedAt?: Date | null;
    marker: string;
  }): Promise<{ id: string; sourceId: string; messageId: string }> {
    const id = randomUUID();
    const sourceId = randomUUID();
    const messageId = randomUUID();
    const bytes = Buffer.from(`source-${input.marker}\0bytes`);
    await pool.query('INSERT INTO agent_sessions (id, raw_bytes) VALUES ($1, $2)', [sourceId, bytes]);
    await pool.query(
      'INSERT INTO agent_session_messages (id, session_id, raw_bytes) VALUES ($1, $2, $3)',
      [messageId, sourceId, bytes],
    );
    await pool.query(
      `INSERT INTO shared_transcripts
         (id, snapshot_json, owner_user_id, recipient_user_ids_json, created_at,
          expires_at, revoked_at, source_session_id)
       VALUES ($1, $2::jsonb, 1, '[]'::jsonb, NOW(), $3, $4, $5)`,
      [id, JSON.stringify({ items: [{ content: `snapshot-${input.marker}` }] }),
        input.expiresAt, input.revokedAt ?? null, sourceId],
    );
    return { id, sourceId, messageId };
  }

  it('uses BEGIN/FOR UPDATE, audits before delete, preserves sources, and is idempotent', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const old = new Date(now.getTime() - 31 * DAY_MS);
    const recent = new Date(now.getTime() - 29 * DAY_MS);
    const dueExpired = await seed({ expiresAt: old, marker: 'expired' });
    const dueRevoked = await seed({
      expiresAt: new Date(now.getTime() + DAY_MS),
      revokedAt: old,
      marker: 'revoked',
    });
    const recentExpired = await seed({ expiresAt: recent, marker: 'recent' });
    const nullNull = await seed({ expiresAt: null, revokedAt: null, marker: 'null-null' });
    const sourceRowsBefore = await pool.query(
      'SELECT id, raw_bytes FROM agent_sessions ORDER BY id',
    );
    const messageRowsBefore = await pool.query(
      'SELECT id, session_id, raw_bytes FROM agent_session_messages ORDER BY id',
    );

    const repository = new SharedTranscriptsRepository();
    expect(await repository.purgeDueSnapshots(now)).toBe(2);
    expect(await repository.purgeDueSnapshots(now)).toBe(0);
    expect((await pool.query('SELECT id FROM shared_transcripts ORDER BY id')).rows)
      .toEqual([recentExpired.id, nullNull.id].sort().map((id) => ({ id })));
    expect((await pool.query('SELECT id, raw_bytes FROM agent_sessions ORDER BY id')).rows)
      .toEqual(sourceRowsBefore.rows);
    expect((await pool.query(
      'SELECT id, session_id, raw_bytes FROM agent_session_messages ORDER BY id',
    )).rows).toEqual(messageRowsBefore.rows);
    expect((await pool.query(
      `SELECT share_id, action FROM share_audit_log
       WHERE action = 'delete' ORDER BY share_id`,
    )).rows).toEqual([dueExpired.id, dueRevoked.id].sort().map((shareId) => ({
      share_id: shareId,
      action: 'delete',
    })));
    expect((await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'share_audit_log'
       ORDER BY column_name`,
      [schema],
    )).rows.map((row) => row.column_name)).toEqual([
      'action', 'actor_user_id', 'id', 'share_id', 'timestamp',
    ]);
  });

  it('rolls back every audit and delete when an audit insert fails', async () => {
    const now = new Date('2026-08-20T12:00:00.000Z');
    const first = await seed({
      expiresAt: new Date(now.getTime() - 31 * DAY_MS),
      marker: 'rollback-first',
    });
    const failing = await seed({
      expiresAt: new Date(now.getTime() - 31 * DAY_MS),
      marker: 'rollback-failing',
    });
    await pool.query(`
      CREATE FUNCTION fail_issue_1375_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.share_id = '${failing.id}' THEN
          RAISE EXCEPTION 'induced delete audit failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER fail_issue_1375_audit
        BEFORE INSERT ON share_audit_log
        FOR EACH ROW WHEN (NEW.action = 'delete')
        EXECUTE FUNCTION fail_issue_1375_audit();
    `);

    await expect(new SharedTranscriptsRepository().purgeDueSnapshots(now))
      .rejects.toThrow(/induced delete audit failure/);
    expect((await pool.query(
      'SELECT id FROM shared_transcripts WHERE id = ANY($1::text[]) ORDER BY id',
      [[first.id, failing.id]],
    )).rows).toEqual([first.id, failing.id].sort().map((id) => ({ id })));
    expect((await pool.query(
      `SELECT COUNT(*)::int AS count FROM share_audit_log
       WHERE share_id = ANY($1::text[]) AND action = 'delete'`,
      [[first.id, failing.id]],
    )).rows).toEqual([{ count: 0 }]);
  });
});
