/**
 * ROUTE CONTRACT TEST — Issue #862: GET /agent-sessions/:id/memory-provenance.
 *
 * Proves the "Memories used in this reply" endpoint is wired through the
 * real Express app and returns the shape the desktop app needs to
 * distinguish "no data recorded yet" from "this reply used no memories".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { AddressInfo } from 'node:net';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { AgentSessionMemoryProvenanceRepository } from '../repositories/agent_session_memory_provenance_repository';

let baseUrl: string;
let closeServer: () => Promise<void>;
let authHeaders: Record<string, string>;
let sessionIdWithProvenance: string;
let sessionIdWithEmptyProvenance: string;
let sessionIdWithNoProvenance: string;

beforeAll(async () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);

  const user = new UsersRepository().create({ name: 'Test', email: 'provenance-route@example.com' });
  const authSession = await new SessionsRepository().createAsync(user.id);
  authHeaders = { Authorization: `Bearer ${authSession.token}` };

  const sessionsRepo = new AgentSessionsRepository();
  const provenanceRepo = new AgentSessionMemoryProvenanceRepository();

  const s1 = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'Session with memories' });
  provenanceRepo.record(s1.id, ['mem-1', 'mem-2'], ['memory/fact/one.md', 'memory/fact/two.md']);
  sessionIdWithProvenance = s1.id;

  const s2 = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'Session with no memories used' });
  provenanceRepo.record(s2.id, [], []);
  sessionIdWithEmptyProvenance = s2.id;

  const s3 = sessionsRepo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'Session never recorded' });
  sessionIdWithNoProvenance = s3.id;

  const server = createApp().listen(0, '127.0.0.1');
  server.maxRequestsPerSocket = 1;
  await new Promise<void>((r) => server.once('listening', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  closeServer = () =>
    new Promise<void>((res, rej) => {
      server.closeAllConnections();
      server.close((e) => (e ? rej(e) : res()));
    });
});

afterAll(async () => {
  await closeServer();
});

describe('GET /agent-sessions/:id/memory-provenance (#862)', () => {
  it('returns the recorded memory ids + note paths for a turn that used memories', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${sessionIdWithProvenance}/memory-provenance`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recorded: boolean; memoryIds: string[]; notePaths: string[] };
    expect(body.recorded).toBe(true);
    expect(body.memoryIds).toEqual(['mem-1', 'mem-2']);
    expect(body.notePaths).toEqual(['memory/fact/one.md', 'memory/fact/two.md']);
  });

  it('returns an explicit empty list (not absent) when the turn used no memories', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${sessionIdWithEmptyProvenance}/memory-provenance`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recorded: boolean; memoryIds: string[] };
    expect(body.recorded).toBe(true);
    expect(body.memoryIds).toEqual([]);
  });

  it('returns recorded=false when no turn has been recorded for the session (distinct from empty)', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/${sessionIdWithNoProvenance}/memory-provenance`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recorded: boolean; memoryIds: string[] };
    expect(body.recorded).toBe(false);
    expect(body.memoryIds).toEqual([]);
  });

  it('returns 404 for an unknown session id', async () => {
    const res = await fetch(`${baseUrl}/agent-sessions/00000000-0000-0000-0000-000000000000/memory-provenance`, {
      headers: authHeaders,
    });
    expect(res.status).toBe(404);
  });
});
