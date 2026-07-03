/**
 * CONTRACT TEST for issue #865 — GET /agents/run-quality.
 *
 * Covers:
 *  - issue-865-r1: returns 200 with a rollup shape (agents[]) over the local
 *    agent server (AGENT_LOCAL bypass — no bearer token required).
 *  - issue-865-r2: an agent's rollup entry includes completion/escalation
 *    counts, token waste, and user corrections fields.
 *  - issue-865-r3: windowDays query param is honored (a session older than
 *    the requested window is excluded).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { startTestServer } from './helpers/real_server';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('issue-865: GET /agents/run-quality', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv('AGENT_LOCAL', 'true');

    const { setDb } = await import('../database/db');
    const { runMigrations } = await import('../database/migrations');
    const { createApp } = await import('../app');

    db = makeDb();
    runMigrations(db);
    setDb(db);

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('issue-865-r1: returns 200 with an empty rollup on a fresh DB (no runs yet)', async () => {
    const res = await fetch(`${baseUrl}/agents/run-quality`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: unknown[]; windowDays: number };
    expect(Array.isArray(body.agents)).toBe(true);
    expect(body.agents).toHaveLength(0);
    expect(body.windowDays).toBe(30);
  });

  it('issue-865-r2: reports completion/escalation/waste/corrections fields for a seeded agent', async () => {
    const now = new Date().toISOString();
    const insertSession = (id: string, status: string, statusMessage: string | null) => {
      db.prepare(
        `INSERT INTO agent_sessions
           (id, task_id, task_title, agent_kind, status, status_message, cwd, name, created_at, updated_at)
         VALUES (?, NULL, NULL, 'claude-code', ?, ?, '/tmp', 'seed', ?, ?)`,
      ).run(id, status, statusMessage, now, now);
    };
    for (let i = 0; i < 5; i++) insertSession(`ok-${i}`, 'closed', null);
    insertSession('bad-1', 'error', 'boom');

    const res = await fetch(`${baseUrl}/agents/run-quality`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      agents: Array<{
        agentKind: string;
        completedRuns: number;
        escalatedRuns: number;
        wastedTokens: number;
        totalUserCorrections: number;
        notEnoughData: boolean;
      }>;
    };
    expect(body.agents).toHaveLength(1);
    const agent = body.agents[0];
    expect(agent.agentKind).toBe('claude-code');
    expect(agent.completedRuns).toBe(5);
    expect(agent.escalatedRuns).toBe(1);
    expect(agent.notEnoughData).toBe(false);
    expect(typeof agent.wastedTokens).toBe('number');
    expect(typeof agent.totalUserCorrections).toBe('number');
  });

  it('issue-865-r3: windowDays query param excludes older sessions', async () => {
    const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO agent_sessions
         (id, task_id, task_title, agent_kind, status, cwd, name, created_at, updated_at)
       VALUES ('old-1', NULL, NULL, 'claude-code', 'closed', '/tmp', 'seed', ?, ?)`,
    ).run(old, old);

    const res = await fetch(`${baseUrl}/agents/run-quality?windowDays=30`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agents: unknown[] };
    expect(body.agents).toHaveLength(0);
  });
});
