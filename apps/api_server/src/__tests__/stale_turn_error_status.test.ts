/**
 * Regression guard: a session's error must end when the engine accepts a new turn.
 *
 * Only the WebSocket input path cleared `error`, and session.idle never
 * overwrites it (#1045). Turns started through promptAsync — coordinator
 * messages, the prompt API, delegation and approval wakes — left it in place
 * forever. The live coordinator root kept a stale Anthropic failure through
 * hours of successful turns, and session permission authority then refused
 * its approved coding manager's worker: "parent is stopped".
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { OpencodeClientService } from '../services/opencode_client_service';

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession: vi.fn(), stopStream: vi.fn(), dispose: vi.fn() },
}));

let db: Database.Database;

function sessionWithError(sdk: string) {
  db.prepare(`INSERT INTO agent_sessions(id,name,agent_kind,status,status_message,cwd,category,owner_user_id,sdk_session_id)
    VALUES(?,?, 'secretary','error','old turn failed','/tmp','chat',1,?)`).run(`local-${sdk}`, sdk, sdk);
}
const statusOf = (sdk: string) =>
  db.prepare('SELECT status, status_message FROM agent_sessions WHERE sdk_session_id=?').get(sdk) as { status: string; status_message: string | null };

function serviceReturning(response: unknown) {
  const service = new OpencodeClientService();
  (service as unknown as { client: unknown }).client = { session: { promptAsync: async () => response } };
  return service;
}

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  db.prepare(`INSERT INTO users(id,name,email) VALUES(1,'Owner','owner@example.invalid')`).run();
});
afterEach(() => db.close());

describe('stale turn error status', () => {
  it('clears a previous turn error once the engine accepts a new turn (204)', async () => {
    sessionWithError('sdk-204');
    const accepted = await serviceReturning({ data: undefined, error: undefined, response: { status: 204 } })
      .promptAsync('sdk-204', 'next turn');
    expect(accepted).toBe(true);
    expect(statusOf('sdk-204')).toEqual({ status: 'working', status_message: null });
  });

  it('clears it on the legacy data-envelope acceptance too', async () => {
    sessionWithError('sdk-data');
    expect(await serviceReturning({ data: { ok: true } }).promptAsync('sdk-data', 'next turn')).toBe(true);
    expect(statusOf('sdk-data').status).toBe('working');
  });

  it('keeps the error when the new turn is not accepted', async () => {
    sessionWithError('sdk-noop');
    expect(await serviceReturning({}).promptAsync('sdk-noop', 'next turn')).toBe(false);
    expect(statusOf('sdk-noop')).toEqual({ status: 'error', status_message: 'old turn failed' });
  });
});
