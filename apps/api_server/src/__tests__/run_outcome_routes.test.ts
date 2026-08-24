/**
 * W4-c7 — the feedback API. Accepts exactly success | partial | failure, scopes
 * ownership concretely (not via requireAuth, which is a no-op under
 * AGENT_LOCAL=true), and sits behind the agent-execution registration gate.
 */
import express from 'express';
import Database from 'better-sqlite3';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { recordTerminalOutcome } from '../services/run_outcome_service';
import { runOutcomeRouter } from '../routes/run_outcome_routes';
import { startTestServer } from './helpers/real_server';

let db: Database.Database;
let baseUrl: string;
let closeServer: () => Promise<void>;
let ownerHeaders: Record<string, string>;
let strangerHeaders: Record<string, string>;
let ownerId: number;
let strangerId: number;

function session(id: string, ownerUserId: number | null, parentId: string | null = null): void {
  db.prepare(
    `INSERT INTO agent_sessions (id, agent_kind, cwd, name, owner_user_id, parent_session_id)
     VALUES (?, 'build', '/tmp', ?, ?, ?)`,
  ).run(id, id, ownerUserId, parentId);
}

async function authHeadersFor(name: string, email: string) {
  const user = new UsersRepository().create({ name, email });
  const session = await new SessionsRepository().createAsync(user.id);
  return {
    id: user.id,
    headers: {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    },
  };
}

beforeEach(async () => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  setDb(db);

  const owner = await authHeadersFor('Owner', 'owner@example.com');
  const stranger = await authHeadersFor('Stranger', 'stranger@example.com');
  ownerId = owner.id;
  ownerHeaders = owner.headers;
  strangerId = stranger.id;
  strangerHeaders = stranger.headers;

  ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
});

afterEach(async () => {
  await closeServer();
  db.close();
});

async function seedRun(sessionId = 'root-1', owner: number | null = ownerId) {
  session(sessionId, owner);
  await recordTerminalOutcome({
    sessionId,
    terminalStatus: 'completed',
    evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
  });
}

describe('POST /agent-run-outcomes/:sessionId/feedback', () => {
  it('accepts each of success | partial | failure', async () => {
    await seedRun();
    for (const verdict of ['success', 'partial', 'failure']) {
      const res = await fetch(`${baseUrl}/agent-run-outcomes/root-1/feedback`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ verdict, reason: `because ${verdict}` }),
      });
      expect(res.status, verdict).toBe(201);
      const body = (await res.json()) as { verdict: string; source: string; confidence: number };
      expect(body).toMatchObject({ verdict, source: 'explicit_user', confidence: 1 });
    }

    // Append-only: all three verdicts are on record, the last one authoritative.
    const view = await fetch(`${baseUrl}/agent-run-outcomes/root-1`, {
      headers: ownerHeaders,
    }).then((r) => r.json() as Promise<{ feedback: unknown[]; explicitUserVerdict: string }>);
    expect(view.feedback).toHaveLength(3);
    expect(view.explicitUserVerdict).toBe('failure');
  });

  it('rejects any other verdict with 400 and writes nothing', async () => {
    await seedRun();
    for (const verdict of ['inconclusive', 'SUCCESS', '', null, 42, 'great']) {
      const res = await fetch(`${baseUrl}/agent-run-outcomes/root-1/feedback`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ verdict }),
      });
      expect(res.status, String(verdict)).toBe(400);
    }
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM agent_run_feedback_events`).get(),
    ).toEqual({ n: 0 });
  });

  it('404s a run that has no outcome', async () => {
    session('root-1', ownerId);
    const res = await fetch(`${baseUrl}/agent-run-outcomes/root-1/feedback`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ verdict: 'success' }),
    });
    expect(res.status).toBe(404);
  });

  it('refuses another user’s run — on read and on write', async () => {
    await seedRun();
    const write = await fetch(`${baseUrl}/agent-run-outcomes/root-1/feedback`, {
      method: 'POST',
      headers: strangerHeaders,
      body: JSON.stringify({ verdict: 'success' }),
    });
    expect(write.status).toBe(404);
    const read = await fetch(`${baseUrl}/agent-run-outcomes/root-1`, {
      headers: strangerHeaders,
    });
    expect(read.status).toBe(404);
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM agent_run_feedback_events`).get(),
    ).toEqual({ n: 0 });
  });

  it('scopes a delegated child to its root run', async () => {
    await seedRun('root-1');
    session('child-1', ownerId, 'root-1');
    const res = await fetch(`${baseUrl}/agent-run-outcomes/child-1/feedback`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ verdict: 'partial' }),
    });
    expect(res.status).toBe(201);
    expect(
      db.prepare(`SELECT root_session_id AS r FROM agent_run_feedback_events`).get(),
    ).toEqual({ r: 'root-1' });
  });

  it('scopes ownership by the paired mobile device’s user, not just the session token', async () => {
    await seedRun();
    // The mobile gateway identifies callers by device, not by session token —
    // the same seam run_quality_routes.ts scopes on.
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.mobileDevice = { userId: strangerId } as never;
      next();
    });
    app.use('/agent-run-outcomes', runOutcomeRouter);
    const { baseUrl: deviceUrl, close } = await startTestServer(app);
    try {
      // The session token belongs to the OWNER; the device belongs to a
      // stranger. The device's user is what must decide.
      const res = await fetch(`${deviceUrl}/agent-run-outcomes/root-1/feedback`, {
        method: 'POST',
        headers: ownerHeaders,
        body: JSON.stringify({ verdict: 'success' }),
      });
      expect(res.status).toBe(404);
    } finally {
      await close();
    }
  });
});

/**
 * Security review findings, both of which the suite passed identically before
 * and after the fix — i.e. nothing covered them.
 */
describe('W4 — ledger write-path hardening', () => {
  it('an unowned run is not readable by an identified caller', async () => {
    // owner_user_id is NULL for every session the desktop creates without an
    // authenticated request. Falling open on NULL handed a paired mobile
    // device every such run in the database.
    session('root-unowned', null);
    await recordTerminalOutcome({
      sessionId: 'root-unowned',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });

    const identified = await fetch(`${baseUrl}/agent-run-outcomes/root-unowned`, {
      headers: strangerHeaders,
    });
    expect(identified.status).toBe(404);

    // ...while the SAME caller still reads a run it does own. Without this
    // half the assertion above is satisfied by a route that is simply broken
    // for everyone. (The unauthenticated local-process path cannot be
    // exercised here: requireAuth is active in this harness and 401s before
    // the route runs. It is a no-op only under AGENT_LOCAL=true.)
    session('root-owned-by-stranger', strangerId);
    await recordTerminalOutcome({
      sessionId: 'root-owned-by-stranger',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });
    const owned = await fetch(`${baseUrl}/agent-run-outcomes/root-owned-by-stranger`, {
      headers: strangerHeaders,
    });
    expect(owned.status).toBe(200);
  });

  it('redacts and caps a secret pasted into the feedback actor', async () => {
    session('root-actor', ownerId);
    await recordTerminalOutcome({
      sessionId: 'root-actor',
      terminalStatus: 'completed',
      evidence: { producedArtifact: true, errorCount: 0, approvalDenied: false },
    });

    const secret = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    const posted = await fetch(`${baseUrl}/agent-run-outcomes/root-actor/feedback`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({ verdict: 'success', actor: `dev ${secret} ${'x'.repeat(500)}` }),
    });
    expect(posted.status).toBe(201);

    const stored = db.prepare(`SELECT actor FROM agent_run_feedback_events`).get() as {
      actor: string;
    };
    expect(stored.actor).not.toContain(secret);
    expect(stored.actor).toContain('[redacted]');
    // Bounded, so one POST cannot append ~1MB to an UPDATE/DELETE-blocked table.
    expect(stored.actor.length).toBeLessThanOrEqual(120);
    // Not vacuous — the operator's own words survive.
    expect(stored.actor).toContain('dev');
  });
});
