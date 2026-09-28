import { randomUUID } from 'node:crypto';
import { Pool, type QueryResult } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import * as database from '../database/db';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';

// Disposable local schema only; never connect to the hosted production database.
describe.skipIf(process.env.RHYTHM_LIVE_PG !== '1')('issue-1547 disposable Postgres credentials', () => {
  const url = process.env.RHYTHM_LIVE_PG_URL ?? '';
  const schema = `issue1547_${randomUUID().replace(/-/g, '')}`;
  const scope = 'https://www.googleapis.com/auth/calendar.readonly';
  let pool: Pool;
  let originalDbClient: typeof env.dbClient;

  const data = (accessToken: string, grant: string, refreshToken: string | null, subject = 'alice') => ({
    ownerId: 1, externalAccountId: subject, email: `${subject}@example.com`, displayName: subject,
    accessToken, refreshToken, scope: grant, tokenType: 'Bearer',
    expiresAt: '2030-01-01T00:00:00.000Z', preserveScopes: true,
  });

  beforeAll(async () => {
    const parsed = new URL(url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.port) {
      throw new Error('issue-1547 Postgres requires an explicit disposable loopback URL with a port');
    }
    pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE integration_accounts (
      id TEXT PRIMARY KEY, owner_id INTEGER, provider TEXT NOT NULL, external_account_id TEXT NOT NULL,
      email TEXT, display_name TEXT, status TEXT NOT NULL DEFAULT 'connected', access_token TEXT,
      refresh_token TEXT, scope TEXT, token_type TEXT, expires_at TEXT, last_synced_at TEXT,
      error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(owner_id, provider))`);
    originalDbClient = env.dbClient;
    (env as { dbClient: typeof env.dbClient }).dbClient = 'postgres';
    vi.spyOn(database, 'getPostgresPool').mockReturnValue(pool);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (originalDbClient) (env as { dbClient: typeof env.dbClient }).dbClient = originalDbClient;
    if (pool) {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  });

  beforeEach(async () => {
    await pool.query('TRUNCATE integration_accounts');
  });

  it('preserves narrow/no-refresh, narrow/with-refresh, disjoint and identity switches; covering grant replaces both rows', async () => {
    const repo = new IntegrationAccountsRepository();
    await repo.upsertGoogleAccountAsync(data('old-access', `openid ${scope}`, 'old-refresh'));
    const before = await repo.findByProviderAsync('google_calendar', 1);
    expect(before?.expiresAt).toBe('2030-01-01T00:00:00.000Z');
    for (const grant of [data('narrow', 'openid', null), data('narrow-2', 'openid', 'new-refresh'),
      data('disjoint', 'email', 'disjoint-refresh'), data('bob', 'openid', 'bob-refresh', 'bob')]) {
      await repo.upsertGoogleAccountAsync(grant);
      for (const provider of ['google_calendar', 'gmail'] as const) {
        expect(await repo.findByProviderAsync(provider, 1)).toMatchObject({
          accessToken: before?.accessToken, refreshToken: before?.refreshToken, scope: before?.scope,
          expiresAt: before?.expiresAt, externalAccountId: before?.externalAccountId, email: before?.email,
        });
      }
    }
    await repo.upsertGoogleAccountAsync(data('covering', `openid ${scope}`, 'bob-refresh', 'bob'));
    for (const provider of ['google_calendar', 'gmail'] as const) {
      expect(await repo.findByProviderAsync(provider, 1)).toMatchObject({
        accessToken: 'covering', refreshToken: 'bob-refresh', scope: [scope, 'openid'].sort().join(' '),
        externalAccountId: 'bob', email: 'bob@example.com', expiresAt: '2030-01-01T00:00:00.000Z',
      });
    }
    await repo.upsertGoogleAccountAsync({ ...data('no-refresh', `openid ${scope} email`, null, 'alice'), expiresAt: '2031-02-03T00:00:00.000Z' });
    for (const provider of ['google_calendar', 'gmail'] as const) {
      expect(await repo.findByProviderAsync(provider, 1)).toMatchObject({
        accessToken: 'no-refresh', refreshToken: null, externalAccountId: 'alice',
        scope: ['email', 'openid', scope].sort().join(' '), expiresAt: '2031-02-03T00:00:00.000Z',
      });
    }
    await repo.markErrorAsync('google_calendar', 1, 'invalid grant');
    await repo.markErrorAsync('gmail', 1, 'invalid grant');
    await repo.upsertGoogleAccountAsync({ ...data('recovered', 'openid', 'recovered-refresh'), expiresAt: '2032-02-03T00:00:00.000Z' });
    for (const provider of ['google_calendar', 'gmail'] as const) {
      expect(await repo.findByProviderAsync(provider, 1)).toMatchObject({
        status: 'connected', errorMessage: null, accessToken: 'recovered', refreshToken: 'recovered-refresh',
        scope: 'openid', externalAccountId: 'alice', expiresAt: '2032-02-03T00:00:00.000Z',
      });
    }
  });

  it('concurrent covering writers publish only exact coherent winner tuples', async () => {
    const repo = new IntegrationAccountsRepository();
    await repo.upsertGoogleAccountAsync(data('seed', `openid ${scope}`, 'seed-refresh'));
    await Promise.all([
      repo.upsertGoogleAccountAsync(data('writer-a', `openid ${scope} email`, 'refresh-a')),
      repo.upsertGoogleAccountAsync(data('writer-b', `openid ${scope} profile`, 'refresh-b')),
    ]);
    for (const provider of ['google_calendar', 'gmail'] as const) {
      const row = await repo.findByProviderAsync(provider, 1);
      expect([
        ['writer-a', 'refresh-a', ['email', 'openid', scope].sort().join(' '), 'alice', '2030-01-01T00:00:00.000Z'],
        ['writer-b', 'refresh-b', ['openid', 'profile', scope].sort().join(' '), 'alice', '2030-01-01T00:00:00.000Z'],
      ]).toContainEqual([
        row?.accessToken, row?.refreshToken, row?.scope, row?.externalAccountId, row?.expiresAt,
      ]);
    }
  });

  it.each(['identity-switch', 'rotated-refresh'] as const)('forced CAS %s retries on exact conflict evidence', async (race) => {
    const repo = new IntegrationAccountsRepository();
    await repo.upsertGoogleAccountAsync(data('seed', `openid ${scope}`, 'seed-refresh'));
    const query = pool.query.bind(pool) as (sql: string, params?: unknown[]) => Promise<QueryResult>;
    let injected = false;
    let conflicts = 0;
    const spy = vi.spyOn(pool, 'query').mockImplementation((async (sql: string, params?: unknown[]) => {
      if (!injected && sql.includes('UPDATE integration_accounts') && sql.includes('IS NOT DISTINCT FROM')) {
        injected = true;
        await query(`UPDATE integration_accounts SET external_account_id = $1, email = $2, access_token = 'competitor', refresh_token = 'competitor-refresh' WHERE owner_id = 1 AND provider = 'google_calendar'`,
          race === 'identity-switch' ? ['bob', 'bob@example.com'] : ['alice', 'alice@example.com']);
      }
      const result = await query(sql, params);
      if (sql.includes('UPDATE integration_accounts') && result.rowCount === 0) conflicts++;
      return result;
    }) as Pool['query']);
    try {
      await repo.upsertGoogleAccountAsync({ ...data('stale-writer', `openid ${scope} email`, race === 'identity-switch' ? null : 'stale-refresh', 'alice'), expiresAt: '2033-01-01T00:00:00.000Z' });
      expect(injected).toBe(true);
      expect(conflicts).toBe(1);
      expect(await repo.findByProviderAsync('google_calendar', 1)).toMatchObject({
        accessToken: 'stale-writer', refreshToken: race === 'identity-switch' ? null : 'stale-refresh',
        externalAccountId: 'alice', email: 'alice@example.com',
        scope: ['email', 'openid', scope].sort().join(' '), expiresAt: '2033-01-01T00:00:00.000Z',
      });
      expect(await repo.findByProviderAsync('gmail', 1)).toMatchObject({
        accessToken: 'stale-writer', refreshToken: race === 'identity-switch' ? 'seed-refresh' : 'stale-refresh',
        externalAccountId: 'alice', scope: ['email', 'openid', scope].sort().join(' '),
      });
    } finally {
      spy.mockRestore();
    }
  });
});
