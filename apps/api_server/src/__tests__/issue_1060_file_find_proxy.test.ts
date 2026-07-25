import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync, realpathSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { startTestServer } from './helpers/real_server';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// OCU-19 (#1060) — proxy engine find/file endpoints scoped to the session dir,
// with a path-traversal guard and a content cap.

const findText = vi.fn().mockResolvedValue([{ path: 'a.ts' }]);
const findFiles = vi.fn().mockResolvedValue(['a.ts', 'b.ts']);
const listFiles = vi.fn().mockResolvedValue([{ name: 'a.ts' }]);
const readFileContent = vi.fn().mockResolvedValue({ content: 'hello', type: 'text' });
const fileStatus = vi.fn().mockResolvedValue([{ path: 'a.ts', status: 'modified' }]);

vi.mock('../services/opencode_engine', () => ({
  opencodeClient: {
    isReady: true,
    statusMessage: 'ready',
    findText: (...a: unknown[]) => findText(...a),
    findFiles: (...a: unknown[]) => findFiles(...a),
    listFiles: (...a: unknown[]) => listFiles(...a),
    readFileContent: (...a: unknown[]) => readFileContent(...a),
    fileStatus: (...a: unknown[]) => fileStatus(...a),
  },
  opencodeSessionMap: new Map(),
}));

vi.mock('../services/opencode_stream_bridge', () => ({
  streamBridge: { streamSession: vi.fn(), stopStream: vi.fn(), clearErrorStatus: vi.fn(), dispose: vi.fn() },
}));

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('OCU-19 (#1060) file/find proxy', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let headers: Record<string, string>;
  let sessionId: string;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({ name: 'T', email: 't@e.com' });
    const s = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };
    const repo = new AgentSessionsRepository();
    const row = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/repo', name: 'S' } as never);
    sessionId = row.id;
    const { createApp } = await import('../app');
    ({ baseUrl, close } = await startTestServer(createApp()));
  });
  afterEach(async () => {
    await close();
    vi.clearAllMocks();
  });

  it('find-text proxies with the session dir', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${sessionId}/files/find-text?pattern=foo`, { headers });
    expect(res.status).toBe(200);
    expect(findText).toHaveBeenCalledWith('/repo', 'foo');
  });

  it('find-files passes limit + type', async () => {
    const res = await fetch(
      `${baseUrl}/agent-sessions/${sessionId}/files/find-files?query=a&limit=50&type=file`,
      { headers },
    );
    expect(res.status).toBe(200);
    expect(findFiles).toHaveBeenCalledWith('/repo', 'a', { limit: 50, type: 'file' });
  });

  it('list + content + status proxy through', async () => {
    expect((await fetch(`${baseUrl}/agent-sessions/${sessionId}/files/list?path=src`, { headers })).status).toBe(200);
    expect(listFiles).toHaveBeenCalledWith('/repo', 'src');
    expect((await fetch(`${baseUrl}/agent-sessions/${sessionId}/files/content?path=src/a.ts`, { headers })).status).toBe(200);
    expect(readFileContent).toHaveBeenCalledWith('/repo', 'src/a.ts');
    expect((await fetch(`${baseUrl}/agent-sessions/${sessionId}/files/status`, { headers })).status).toBe(200);
    expect(fileStatus).toHaveBeenCalledWith('/repo');
  });

  it('rejects a path escaping the session dir with 400', async () => {
    const res = await fetch(
      `${baseUrl}/agent-sessions/${sessionId}/files/content?path=${encodeURIComponent('../../etc/passwd')}`,
      { headers },
    );
    expect(res.status).toBe(400);
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it('unknown session returns 404', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/does-not-exist/files/status`, { headers });
    expect(res.status).toBe(404);
  });

  it('caps oversized content with 413', async () => {
    readFileContent.mockResolvedValueOnce({ content: 'x'.repeat(3 * 1024 * 1024), type: 'text' });
    const res = await fetch(`${baseUrl}/agent-sessions/${sessionId}/files/content?path=big.txt`, { headers });
    expect(res.status).toBe(413);
  });
});

// #1133 — resolveSessionDir must canonicalize with realpath before deciding
// containment, so a symlink living inside the session dir can't be used to
// read/list a file outside it. Needs a real directory on disk (the '/repo'
// fixture above is a fake, nonexistent path and can't host a real symlink).
describe('resolveSessionDir symlink escape (#1133)', () => {
  let baseUrl: string;
  let close: () => Promise<void>;
  let headers: Record<string, string>;
  let sessionId: string;
  let sessionDir: string;
  let outside: string;

  beforeEach(async () => {
    setDb(makeDb());
    sessionDir = realpathSync(mkdtempSync(join(tmpdir(), 'file-proxy-session-')));
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'file-proxy-outside-')));
    writeFileSync(join(outside, 'secret.txt'), 'secret data');
    symlinkSync(outside, join(sessionDir, 'escape'));

    const user = new UsersRepository().create({ name: 'T2', email: 't2@e.com' });
    const s = await new SessionsRepository().createAsync(user.id);
    headers = { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };
    const repo = new AgentSessionsRepository();
    const row = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: sessionDir, name: 'S2' } as never);
    sessionId = row.id;
    const { createApp } = await import('../app');
    ({ baseUrl, close } = await startTestServer(createApp()));
  });
  afterEach(async () => {
    await close();
    vi.clearAllMocks();
    rmSync(sessionDir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('rejects reading through an in-root symlink pointing outside the session dir', async () => {
    const res = await fetch(
      `${baseUrl}/agent-sessions/${sessionId}/files/content?path=${encodeURIComponent('escape/secret.txt')}`,
      { headers },
    );
    expect(res.status).toBe(400);
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it('rejects listing through an in-root symlink pointing outside the session dir', async () => {
    const res = await fetch(
      `${baseUrl}/agent-sessions/${sessionId}/files/list?path=${encodeURIComponent('escape')}`,
      { headers },
    );
    expect(res.status).toBe(400);
    expect(listFiles).not.toHaveBeenCalled();
  });

  it('still allows a legitimate real subdirectory (no false lockout)', async () => {
    mkdirSync(join(sessionDir, 'sub'), { recursive: true });
    const res = await fetch(
      `${baseUrl}/agent-sessions/${sessionId}/files/list?path=${encodeURIComponent('sub')}`,
      { headers },
    );
    expect(res.status).toBe(200);
    expect(listFiles).toHaveBeenCalledWith(sessionDir, 'sub');
  });
});
