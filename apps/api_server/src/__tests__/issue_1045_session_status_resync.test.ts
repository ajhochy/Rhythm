import { vi, describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// OCU-04 (#1045) — reconcile local session status against the engine's
// authoritative GET /session/status map on engine ready / stream resubscribe.

const { broadcastSpy, broadcastSessionUpdatedSpy, sessionMap, getSessionStatusesSpy } =
  vi.hoisted(() => ({
    broadcastSpy: vi.fn(),
    broadcastSessionUpdatedSpy: vi.fn(),
    sessionMap: new Map<string, string>(),
    getSessionStatusesSpy: vi.fn(),
  }));

vi.mock('../services/ws_gateway', () => ({
  broadcast: (msg: unknown) => broadcastSpy(msg),
  broadcastSessionUpdated: (s: unknown) => broadcastSessionUpdatedSpy(s),
}));

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    subscribeToEvents: vi.fn().mockResolvedValue(null),
    listPermissions: vi.fn().mockResolvedValue([]),
    listQuestions: vi.fn().mockResolvedValue([]),
    getSessionStatuses: (...args: unknown[]) => getSessionStatusesSpy(...args),
  },
  opencodeSessionMap: sessionMap,
}));

import { OpencodeStreamBridge } from '../services/opencode_stream_bridge';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

/** Seed an agent_sessions row directly with an explicit status + sdk id. */
function seedSession(
  repo: AgentSessionsRepository,
  opts: { sdkId?: string; status: string },
): string {
  const s = repo.insert({ agentKind: 'opencode', cwd: '/tmp/x', name: 'test' } as never);
  if (opts.sdkId) repo.setSdkSessionId(s.id, opts.sdkId);
  // Force the status column (insert always starts 'starting').
  (repo as unknown as { updateStatus(id: string, st: string): void }).updateStatus(
    s.id,
    opts.status as never,
  );
  return s.id;
}

describe('OCU-04 (#1045) reconcileSessionStatuses', () => {
  let bridge: OpencodeStreamBridge;
  let repo: AgentSessionsRepository;

  beforeEach(() => {
    setDb(makeDb());
    sessionMap.clear();
    broadcastSpy.mockClear();
    broadcastSessionUpdatedSpy.mockClear();
    getSessionStatusesSpy.mockReset();
    bridge = new OpencodeStreamBridge();
    repo = new AgentSessionsRepository();
  });

  it('corrects a working row the engine reports idle → idle + WS frame', async () => {
    const id = seedSession(repo, { sdkId: 'sdk-1', status: 'working' });
    getSessionStatusesSpy.mockResolvedValue({ 'sdk-1': { type: 'idle' } });

    await bridge.reconcileSessionStatuses();

    expect(repo.findById(id)!.status).toBe('idle');
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'session.status', id, working: false }),
    );
  });

  it('corrects a working row the engine does not know about (absent → idle)', async () => {
    const id = seedSession(repo, { sdkId: 'sdk-unknown', status: 'working' });
    getSessionStatusesSpy.mockResolvedValue({}); // engine knows nothing

    await bridge.reconcileSessionStatuses();

    expect(repo.findById(id)!.status).toBe('idle');
  });

  it('corrects a stuck starting row', async () => {
    const id = seedSession(repo, { sdkId: 'sdk-2', status: 'starting' });
    getSessionStatusesSpy.mockResolvedValue({}); // unknown → idle

    await bridge.reconcileSessionStatuses();

    expect(repo.findById(id)!.status).toBe('idle');
  });

  it('leaves a genuinely busy engine session untouched', async () => {
    const id = seedSession(repo, { sdkId: 'sdk-3', status: 'working' });
    getSessionStatusesSpy.mockResolvedValue({ 'sdk-3': { type: 'busy' } });

    await bridge.reconcileSessionStatuses();

    expect(repo.findById(id)!.status).toBe('working');
    expect(broadcastSpy).not.toHaveBeenCalled();
  });

  it('NEVER clobbers an error row', async () => {
    const id = seedSession(repo, { sdkId: 'sdk-4', status: 'working' });
    repo.setErrorStatus(id, 'boom');
    getSessionStatusesSpy.mockResolvedValue({}); // engine unknown

    await bridge.reconcileSessionStatuses();

    expect(repo.findById(id)!.status).toBe('error');
  });
});
