/**
 * P5-3 — route tests for version history + rollback.
 *
 *   GET  /agent-skills/:id/versions  → list snapshots (newest first)
 *   POST /agent-skills/:id/rollback  → restore a prior version as new current
 *
 * Uses the same single-db harness as agent_skills_routes.test.ts but keeps the
 * db handle so a revision can be seeded directly via the repo (there is no
 * revise route — revisions are produced by the loop, not the API).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { AgentSkillsRepository } from '../repositories/agent_skills_repository';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { startTestServer } from './helpers/real_server';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

async function setup() {
  const db = makeDb();
  setDb(db);

  const usersRepo = new UsersRepository();
  const sessionsRepo = new SessionsRepository();
  const user = usersRepo.create({ name: 'Test User', email: 'test@example.com' });
  const session = await sessionsRepo.createAsync(user.id);
  const authHeaders: Record<string, string> = {
    Authorization: `Bearer ${session.token}`,
    'Content-Type': 'application/json',
  };

  const { baseUrl, close: closeServer } = await startTestServer(createApp());

  return { baseUrl, closeServer, authHeaders, repo: new AgentSkillsRepository() };
}

describe('agent-skills version routes (P5-3)', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;
  let repo: AgentSkillsRepository;

  beforeEach(async () => {
    ({ baseUrl, closeServer, authHeaders, repo } = await setup());
  });

  afterEach(async () => {
    await closeServer();
  });

  it('GET /:id/versions returns [] for a skill with no history', async () => {
    const s = repo.create({ title: 'No history', confidence: 0.5 });
    const res = await fetch(`${baseUrl}/agent-skills/${s.id}/versions`, { headers: authHeaders });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('GET /:id/versions returns recorded snapshots after a revision', async () => {
    const s = repo.create({ title: 'T', description: 'v1', confidence: 0.5 });
    repo.reviseInPlace(s.id, { description: 'v2', confidence: 0.7 }, 'auto-refined');

    const res = await fetch(`${baseUrl}/agent-skills/${s.id}/versions`, { headers: authHeaders });
    expect(res.status).toBe(200);
    const versions = (await res.json()) as Array<Record<string, unknown>>;
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNo).toBe(1);
    expect(versions[0].description).toBe('v1');
  });

  it('GET /:id/versions 404 for unknown skill', async () => {
    const res = await fetch(`${baseUrl}/agent-skills/nope/versions`, { headers: authHeaders });
    expect(res.status).toBe(404);
  });

  it('POST /:id/rollback restores a prior version and bumps version', async () => {
    const s = repo.create({ title: 'T', description: 'v1', confidence: 0.5 });
    repo.reviseInPlace(s.id, { description: 'v2', confidence: 0.9 }, 'auto-refined'); // now v2

    const res = await fetch(`${baseUrl}/agent-skills/${s.id}/rollback`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ versionNo: 1 }),
    });
    expect(res.status).toBe(200);
    const restored = (await res.json()) as Record<string, unknown>;
    expect(restored.description).toBe('v1');
    expect(restored.version).toBe(3); // non-destructive — version keeps climbing
  });

  it('POST /:id/rollback 400 on a missing/invalid versionNo', async () => {
    const s = repo.create({ title: 'T', description: 'v1', confidence: 0.5 });
    const res = await fetch(`${baseUrl}/agent-skills/${s.id}/rollback`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('POST /:id/rollback 404 for an unknown version number', async () => {
    const s = repo.create({ title: 'T', description: 'v1', confidence: 0.5 });
    const res = await fetch(`${baseUrl}/agent-skills/${s.id}/rollback`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ versionNo: 99 }),
    });
    expect(res.status).toBe(404);
  });

  it('POST /:id/rollback 404 for an unknown skill', async () => {
    const res = await fetch(`${baseUrl}/agent-skills/nope/rollback`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ versionNo: 1 }),
    });
    expect(res.status).toBe(404);
  });
});
