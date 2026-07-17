/**
 * #1039 Cause A — config-time guard: a scheduled task runs its bound profile as
 * a TOP-LEVEL opencode agent (AgentRunner passes `agent: <profileId>`). A profile
 * that is NOT session-selectable is projected `mode: subagent`, which opencode
 * exposes only as a delegation target — resolving it top-level throws
 * "Agent not found" → the old silent "model produced no output".
 *
 * These tests assert the binding is rejected at create/update time with an
 * actionable message, and that a session-selectable profile (or a bare CLI kind)
 * schedules fine.
 *
 * Real in-memory SQLite + real repository + real Express app, matching the
 * pattern in agent_schedules_trigger_now_contract.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { setDb } from '../database/db';
import { UsersRepository } from '../repositories/users_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { startTestServer } from './helpers/real_server';

function makeDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('#1039 — scheduling delegation-only profiles is blocked at config time', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({ name: 'T', email: 't@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

    const configs = new AgentConfigsRepository();
    // Delegation-only specialist (subagent mode).
    configs.insert({
      id: 'theological-researcher',
      label: 'Theological Researcher',
      icon: 'book',
      isAgent: true,
      sessionSelectable: false,
    });
    // A schedulable, session-selectable profile.
    configs.insert({
      id: 'ai-trend-researcher',
      label: 'AI Trend Researcher',
      icon: 'chart',
      isAgent: true,
      sessionSelectable: true,
    });

    const { baseUrl: b, close } = await startTestServer(createApp());
    baseUrl = b;
    closeServer = close;
  });

  afterEach(async () => {
    await closeServer();
  });

  it('rejects creating a scheduled task bound to a non-session-selectable profile', async () => {
    const res = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'theological-research-daily',
        scheduleType: 'daily',
        scheduledTime: '05:00',
        prompt: 'Run the theological scan',
        agentConfigId: 'theological-researcher',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toContain('delegation-only subagent');
    expect(message).toContain('session-selectable');
    expect(message).toContain('Theological Researcher');
  });

  it('allows creating a scheduled task bound to a session-selectable profile', async () => {
    const res = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'ai-trend-research-daily',
        scheduleType: 'daily',
        scheduledTime: '05:00',
        prompt: 'Run the trend scan',
        agentConfigId: 'ai-trend-researcher',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('allows a bare CLI kind (no profile row) — the guard is a no-op', async () => {
    const res = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'generic-run',
        scheduleType: 'daily',
        scheduledTime: '05:00',
        prompt: 'Run',
        agentKind: 'opencode',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('rejects re-binding an existing task to a delegation-only profile via update', async () => {
    const createRes = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'movable',
        scheduleType: 'daily',
        scheduledTime: '05:00',
        prompt: 'Run',
        agentConfigId: 'ai-trend-researcher',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string };

    const updateRes = await fetch(`${baseUrl}/agent-schedules/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ agentConfigId: 'theological-researcher' }),
    });
    expect(updateRes.status).toBe(400);
    const body = (await updateRes.json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    expect(message).toContain('delegation-only subagent');
  });
});

describe('#1088 — schedulable is decoupled from picker visibility (sessionSelectable)', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;
  let configs: AgentConfigsRepository;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({ name: 'T2', email: 't2@example.com' });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };

    configs = new AgentConfigsRepository();
    // Hidden from the picker, but EXPLICITLY made schedulable.
    configs.insert({
      id: 'hidden-schedulable-specialist',
      label: 'Hidden Schedulable Specialist',
      icon: 'book',
      isAgent: true,
      sessionSelectable: false,
      schedulable: true,
    });

    const { baseUrl: b, close } = await startTestServer(createApp());
    baseUrl = b;
    closeServer = close;
  });

  afterEach(async () => {
    await closeServer();
  });

  it('accepts scheduling a hidden profile that is explicitly schedulable', async () => {
    const res = await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'hidden-schedulable-daily',
        scheduleType: 'daily',
        scheduledTime: '05:00',
        prompt: 'Run',
        agentConfigId: 'hidden-schedulable-specialist',
      }),
    });
    expect(res.status).toBe(201);
  });

  it('the profile remains sessionSelectable=false (picker-hidden) after scheduling', async () => {
    await fetch(`${baseUrl}/agent-schedules`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        name: 'hidden-schedulable-daily-2',
        scheduleType: 'daily',
        scheduledTime: '05:00',
        prompt: 'Run',
        agentConfigId: 'hidden-schedulable-specialist',
      }),
    });
    const profile = configs.getById('hidden-schedulable-specialist')!;
    expect(profile.sessionSelectable).toBe(false);
    expect(profile.schedulable).toBe(true);
  });
});
