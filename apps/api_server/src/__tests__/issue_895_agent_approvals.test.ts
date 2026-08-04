/**
 * #895 — /agent-approvals CRUD + auto-approve behavior
 *
 * Criteria covered:
 *   - POST /agent-approvals creates a pending approval
 *   - GET /agent-approvals defaults to pending only
 *   - GET /agent-approvals?status=all returns every status
 *   - PATCH /agent-approvals/:id approves with an actor + decidedAt
 *   - PATCH /agent-approvals/:id rejects
 *   - PATCH on an already-decided approval 404s (no double-decide)
 *   - a profile with auto_approve_actions=1 creates an already-approved row
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { startTestServer } from './helpers/real_server';
import { runMigrations } from '../database/migrations';
import { setDb, getDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import {
  installHumanApprovalTestCredentials,
  signHumanApprovalDecision,
  type HumanApprovalTestCredentials,
} from './helpers/human_approval_test_credentials';

interface PendingApproval {
  id: string;
  decisionNonce: string;
  payloadDigest: string | null;
}

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('#895 — /agent-approvals', () => {
  let baseUrl: string;
  let authHeader: Record<string, string>;
  let closeServer: () => Promise<void>;
  let approvalCredentials: HumanApprovalTestCredentials;

  beforeEach(async () => {
    setDb(makeDb());

    const usersRepo = new UsersRepository();
    const sessionsRepo = new SessionsRepository();
    const user = usersRepo.create({ name: 'Test', email: 'test@example.com' });
    const session = await sessionsRepo.createAsync(user.id);
    approvalCredentials = installHumanApprovalTestCredentials();
    authHeader = {
      Authorization: `Bearer ${session.token}`,
      ...approvalCredentials.capabilityHeader,
    };

    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('creates a pending approval and requires action', async () => {
    const missing = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(400);

    const res = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Schedule Jane Doe', preview: 'Add to Worship Leader slot' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('pending');
    expect(body.action).toBe('Schedule Jane Doe');
    expect(body.decidedAt).toBeNull();
  });

  it('GET defaults to pending only; ?status=all returns every row', async () => {
    const created = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Send reminder email' }),
    }).then((r) => r.json()) as PendingApproval;

    await fetch(`${baseUrl}/agent-approvals/${created.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        signature: signHumanApprovalDecision(
          approvalCredentials,
          created,
          'approved',
        ),
      }),
    });

    const pendingOnly = await fetch(`${baseUrl}/agent-approvals`, { headers: authHeader });
    expect(await pendingOnly.json()).toEqual([]);

    const all = await fetch(`${baseUrl}/agent-approvals?status=all`, { headers: authHeader });
    const allBody = (await all.json()) as Record<string, unknown>[];
    expect(allBody).toHaveLength(1);
    expect(allBody[0].status).toBe('approved');
    expect(allBody[0].actor).toBe('user:1');
    expect(typeof allBody[0].decidedAt).toBe('string');
  });

  it('rejects an approval and logs the actor', async () => {
    const created = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Update PCO plan item' }),
    }).then((r) => r.json()) as PendingApproval;

    const res = await fetch(`${baseUrl}/agent-approvals/${created.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        signature: signHumanApprovalDecision(
          approvalCredentials,
          created,
          'rejected',
        ),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('rejected');
  });

  it('404s when deciding an approval that is already decided', async () => {
    const created = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Send email' }),
    }).then((r) => r.json()) as PendingApproval;

    await fetch(`${baseUrl}/agent-approvals/${created.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'approved',
        signature: signHumanApprovalDecision(
          approvalCredentials,
          created,
          'approved',
        ),
      }),
    });

    const second = await fetch(`${baseUrl}/agent-approvals/${created.id}`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'rejected',
        signature: signHumanApprovalDecision(
          approvalCredentials,
          created,
          'rejected',
        ),
      }),
    });
    expect(second.status).toBe(404);
  });

  it('auto-approves for a profile with auto_approve_actions=1', async () => {
    getDb()
      .prepare(
        `INSERT INTO agent_configs (id, label, icon, command, is_agent, enabled, auto_approve_actions) VALUES (?, ?, ?, ?, 1, 1, 1)`,
      )
      .run('dev-profile', 'Dev Profile', 'terminal', '');

    const res = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'Send test email', agentConfigId: 'dev-profile' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('approved');
    expect(body.actor).toBe('auto-approved');
  });

  // Config Doctor Track B — auto_approve_actions must be settable end-to-end
  // through the REST API (no raw SQL), and must still record the
  // 'auto-approved' actor for audit visibility once flipped this way.
  it('exposes autoApproveActions on GET/PATCH /agent-configs and auto-approves once set', async () => {
    getDb()
      .prepare(
        `INSERT INTO agent_configs (id, label, icon, command, is_agent, enabled) VALUES (?, ?, ?, ?, 1, 1)`,
      )
      .run('librarian-like', 'Librarian Like', 'terminal', '');

    const getBefore = await fetch(`${baseUrl}/agent-configs/librarian-like`, {
      headers: authHeader,
    });
    expect(getBefore.status).toBe(200);
    expect(((await getBefore.json()) as Record<string, unknown>).autoApproveActions).toBe(false);

    const patchRes = await fetch(`${baseUrl}/agent-configs/librarian-like`, {
      method: 'PATCH',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoApproveActions: true }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as Record<string, unknown>;
    expect(patched.autoApproveActions).toBe(true);

    const getAfter = await fetch(`${baseUrl}/agent-configs/librarian-like`, {
      headers: authHeader,
    });
    expect(((await getAfter.json()) as Record<string, unknown>).autoApproveActions).toBe(true);

    const approvalRes = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rhythm_remember_memory',
        agentConfigId: 'librarian-like',
      }),
    });
    expect(approvalRes.status).toBe(201);
    const approvalBody = (await approvalRes.json()) as Record<string, unknown>;
    expect(approvalBody.status).toBe('approved');
    expect(approvalBody.actor).toBe('auto-approved');
  });

  // Config Doctor Track B follow-up (2026-08-03 live run) — a calling agent
  // has no reliable way to know its own agent_configs.id, and the scheduled
  // Memory Consolidation prompt never told the model to pass one. Auto-
  // approve must still fire when only sessionId is given, by resolving the
  // profile server-side from agent_sessions.agent_kind — never by trusting a
  // model-supplied agentConfigId, which would also be a privilege-escalation
  // risk.
  it('auto-approves from sessionId alone when agentConfigId is not supplied', async () => {
    getDb()
      .prepare(
        `INSERT INTO agent_configs (id, label, icon, command, is_agent, enabled, auto_approve_actions) VALUES (?, ?, ?, ?, 1, 1, 1)`,
      )
      .run('librarian', 'Librarian', 'terminal', '');

    getDb()
      .prepare(
        `INSERT INTO agent_sessions (id, agent_kind, status, cwd, name) VALUES (?, ?, 'idle', ?, ?)`,
      )
      .run('sess-librarian-1', 'librarian', '/tmp', 'Memory Consolidation');

    const approvalRes = await fetch(`${baseUrl}/agent-approvals`, {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rhythm_remember_memory',
        sessionId: 'sess-librarian-1',
      }),
    });
    expect(approvalRes.status).toBe(201);
    const approvalBody = (await approvalRes.json()) as Record<string, unknown>;
    expect(approvalBody.status).toBe('approved');
    expect(approvalBody.actor).toBe('auto-approved');
  });
});
