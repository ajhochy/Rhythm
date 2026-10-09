/**
 * G2 S5-A: the real OpencodeClientService honours the typed callback
 * `onPrepared` contract S4's completion service relies on. With NO Dayflow
 * receiver it still mints the native anchor, persists the dispatch row, calls
 * `onPrepared` with exactly that row/anchor, and sends only when it returned
 * true. SDK and `fetch` are stubs (request-shape proof, not a live engine).
 */
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { ModelProvenanceRepository } from '../repositories/model_provenance_repository';
import { OpencodeClientService } from '../services/opencode_client_service';

let db: Database.Database;
let previousDb: Database.Database | null;
beforeAll(() => { db = new Database(':memory:'); runMigrations(db); previousDb = setDb(db); });
afterAll(() => { setDb(previousDb); db.close(); });

const SDK = 'sdk-s5-client';
const ROOT = 's5-client-root';
const provenance = new ModelProvenanceRepository();

function service(promptAsync: ReturnType<typeof vi.fn>): OpencodeClientService {
  const svc = new OpencodeClientService();
  (svc as unknown as { client: unknown }).client = { session: { promptAsync } };
  (svc as unknown as { status: string }).status = 'ready';
  (svc as unknown as { server: unknown }).server = { url: 'http://engine.test', close() {} };
  return svc;
}

function send(svc: OpencodeClientService, onPrepared: (b: { dispatchId: string; sdkUserMessageId: string }) => boolean) {
  return svc.promptAsync(SDK, 'callback', undefined, '/safe/s5', undefined, undefined, undefined, {
    sessionId: ROOT, sdkSessionId: SDK, origin: 'delegation_completion', requestedSource: 'agent_config',
    routeAuthed: null, reasonCode: 'c2_goal_callback:dg-s5',
  } as never, undefined, undefined, { kind: 'coordinator_callback_v1', validate: () => true, onPrepared });
}

describe('G2 S5-A client callback onPrepared', () => {
  const previous = process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
  beforeEach(() => {
    process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = '1';
    db.prepare(`INSERT INTO agent_sessions (id, sdk_session_id, agent_kind, cwd, name) VALUES (?, ?, 'build', '/safe/s5', 'root')`).run(ROOT, SDK);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ messageID: 'native-cb-1' }) })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    if (previous === undefined) delete process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS;
    else process.env.RHYTHM_MANAGED_CONTEXT_EXPORTS = previous;
    db.prepare('DELETE FROM agent_turn_dispatches WHERE session_id=?').run(ROOT);
    db.prepare('DELETE FROM agent_sessions WHERE id=?').run(ROOT);
  });

  it('mints the anchor with no Dayflow receiver and calls onPrepared with the durable row before the SDK', async () => {
    const order: string[] = [];
    const promptAsync = vi.fn(async (input: { body: Record<string, unknown> }) => {
      order.push('sdk');
      expect(input.body.messageID).toBe('native-cb-1');
      return { response: { status: 204 } };
    });
    const bindings: Array<{ dispatchId: string; sdkUserMessageId: string }> = [];
    const ok = await send(service(promptAsync), (binding) => {
      order.push('prepared');
      // The exact row is already durable when the hook runs.
      expect(provenance.get(binding.dispatchId)).toMatchObject({ sdkUserMessageId: 'native-cb-1', sessionId: ROOT });
      bindings.push(binding);
      return true;
    });
    expect(ok).toBe(true);
    expect(order).toEqual(['prepared', 'sdk']);
    expect(bindings).toEqual([{ dispatchId: expect.any(String), sdkUserMessageId: 'native-cb-1' }]);
  });

  it('refuses to send when onPrepared returns false or throws', async () => {
    for (const hook of [() => false, () => { throw new Error('storage'); }]) {
      const promptAsync = vi.fn();
      expect(await send(service(promptAsync), hook)).toBe(false);
      expect(promptAsync).not.toHaveBeenCalled();
      expect(provenance.list(ROOT).every((row) => row.outcome === 'rejected')).toBe(true);
    }
  });

  it('refuses when the anchor cannot be minted: the hook never runs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const promptAsync = vi.fn();
    const hook = vi.fn(() => true);
    expect(await send(service(promptAsync), hook)).toBe(false);
    expect(hook).not.toHaveBeenCalled();
    expect(promptAsync).not.toHaveBeenCalled();
  });
});
