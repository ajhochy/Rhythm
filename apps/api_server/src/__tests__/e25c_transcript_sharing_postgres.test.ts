import { afterEach, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { env } from '../config/env';
import * as database from '../database/db';
import { SharedTranscriptsRepository } from '../repositories/shared_transcripts_repository';
const originalClient = env.dbClient;
afterEach(() => { env.dbClient = originalClient; vi.restoreAllMocks(); });
it('E25C-c5: Postgres detached lookup uses explicit marker alternative, not unconditional source join', async () => {
  env.dbClient = 'postgres';
  const row = { id: 'share', source_session_id: 'detached:v1', owner_user_id: 1, recipient_user_ids_json: [2], snapshot_json: { items: [], reviewHash: 'a'.repeat(64) }, created_at: new Date('2026-09-11'), expires_at: new Date('2026-10-01'), revoked_at: null };
  const query = vi.fn(async () => ({ rows: [row] }));
  vi.spyOn(database, 'getPostgresPool').mockReturnValue({ query } as unknown as Pool);
  const found = await new SharedTranscriptsRepository().findWithLiveSource('share');
  expect(found?.sourceSessionId).toBeNull();
  expect(found?.snapshot).toEqual(row.snapshot_json);
  expect(found?.expiresAt).toBe('2026-10-01T00:00:00.000Z');
  expect(query.mock.calls[0]).toEqual([expect.stringMatching(/detached:v1[\s\S]*OR[\s\S]*EXISTS/i), ['share']]);
});

it('E25C-c5: Postgres create preserves detached provenance and authenticated audit in one transaction', async () => {
  env.dbClient = 'postgres';
  const snapshot = { items: [{ id: 'safe', category: 'message' as const, content: 'safe' }], reviewHash: 'a'.repeat(64) };
  const query = vi.fn(async (sql: string, values?: unknown[]) => ({ rows: sql.includes('RETURNING *') ? [{
    id: values![0], snapshot_json: JSON.parse(String(values![1])), owner_user_id: values![2], recipient_user_ids_json: JSON.parse(String(values![3])),
    created_at: new Date(String(values![4])), expires_at: new Date(String(values![5])), source_session_id: values![6], revoked_at: null,
  }] : [] }));
  const release = vi.fn();
  vi.spyOn(database, 'getPostgresPool').mockReturnValue({ connect: async () => ({ query, release }) } as unknown as Pool);
  const result = await new SharedTranscriptsRepository().create({ snapshot, ownerUserId: 1, recipientUserIds: [2], sourceSessionId: 'detached:v1', expiresAt: '2026-10-01T00:00:00.000Z' });
  expect(result).toMatchObject({ snapshot, sourceSessionId: null, ownerUserId: 1, recipientUserIds: [2], expiresAt: '2026-10-01T00:00:00.000Z' });
  expect(query.mock.calls.map(call => call[0])).toEqual(['BEGIN', expect.stringContaining('INSERT INTO shared_transcripts'), expect.stringContaining('INSERT INTO share_audit_log'), 'COMMIT']);
  expect(query.mock.calls[2][1]).toEqual([expect.any(String), result.id, 1, result.createdAt]);
  expect(release).toHaveBeenCalledOnce();
});
