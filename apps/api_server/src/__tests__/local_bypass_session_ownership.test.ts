/**
 * Regression guard for AGENT_LOCAL ownership propagation.
 *
 * The desktop's own loopback requests carry no bearer, so `authenticateIfPresent`
 * left `req.auth` undefined and everything the UI created was stored with
 * owner_user_id NULL. A fresh ordinary chat was then refused downstream as
 * history_ambiguous.
 *
 * Exactly one signed-in user is not ambiguous ownership, so that case is now
 * attributed. Zero signed-in users, or active sessions belonging to more than
 * one user, must keep failing closed rather than guessing an owner.
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { env } from '../config/env';
import { authenticateIfPresent } from '../middleware/auth_middleware';

let db: Database.Database;
let previousAgentLocal: boolean;

async function authOf(headers: Record<string, string> = {}) {
  const req = { header: (name: string) => headers[name] ?? undefined } as unknown as Request;
  const next = vi.fn() as unknown as NextFunction;
  await authenticateIfPresent(req, {} as Response, next);
  return (req as Request & { auth?: { user: { id: number } } }).auth;
}

beforeEach(() => {
  previousAgentLocal = env.agentLocal;
  (env as { agentLocal: boolean }).agentLocal = true;
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  db.prepare(`INSERT INTO users(id,name,email) VALUES(1,'Local Owner','owner@example.invalid')`).run();
  db.prepare(`INSERT INTO users(id,name,email) VALUES(2,'Other','other@example.invalid')`).run();
});

afterEach(() => {
  (env as { agentLocal: boolean }).agentLocal = previousAgentLocal;
  db.close();
});

describe('AGENT_LOCAL no-bearer ownership', () => {
  it('attributes work to the single signed-in local user', async () => {
    db.prepare(`INSERT INTO sessions(token,user_id) VALUES('local-token-not-a-secret',1)`).run();
    expect((await authOf())?.user.id).toBe(1);
  });

  it('stays unauthenticated when nobody is signed in', async () => {
    expect(await authOf()).toBeUndefined();
  });

  it('stays unauthenticated when active sessions span more than one user', async () => {
    db.prepare(`INSERT INTO sessions(token,user_id) VALUES('first-not-a-secret',1)`).run();
    db.prepare(`INSERT INTO sessions(token,user_id) VALUES('second-not-a-secret',2)`).run();
    expect(await authOf()).toBeUndefined();
  });

  it('ignores expired sessions when deciding the sole owner', async () => {
    db.prepare(`INSERT INTO sessions(token,user_id,expires_at) VALUES('stale-not-a-secret',2,'2000-01-01T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO sessions(token,user_id) VALUES('live-not-a-secret',1)`).run();
    expect((await authOf())?.user.id).toBe(1);
  });
});
