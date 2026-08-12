import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { createApp } from '../app';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { GoalsRepository } from '../repositories/goals_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

async function json(response: Response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

describe.runIf(process.env.RHYTHM_LIVE_E2E === '1')('issue #1243 goal HTTP behavior', () => {
  let db: Database.Database;
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let ownerId: number;
  let strangerId: number;
  let ownerHeaders: Record<string, string>;
  let strangerHeaders: Record<string, string>;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    setDb(db);
    const users = new UsersRepository();
    ownerId = users.create({ name: 'Owner', email: 'goal-owner@example.test' }).id;
    strangerId = users.create({ name: 'Stranger', email: 'goal-stranger@example.test' }).id;
    const sessions = new SessionsRepository();
    ownerHeaders = {
      Authorization: `Bearer ${(await sessions.createAsync(ownerId)).token}`,
      'Content-Type': 'application/json',
    };
    strangerHeaders = {
      Authorization: `Bearer ${(await sessions.createAsync(strangerId)).token}`,
      'Content-Type': 'application/json',
    };
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => closeServer());

  it('creates, lists, updates, and deletes an owned season goal', async () => {
    const createdResponse = await fetch(`${baseUrl}/goals`, {
      method: 'POST',
      headers: ownerHeaders,
      body: JSON.stringify({
        title: 'Recruit volunteers',
        metricType: 'number',
        startValue: 4,
        currentValue: 10,
        endValue: 16,
        health: 'at_risk',
        startDate: '2026-09-01',
        endDate: '2026-12-24',
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await json(createdResponse) as Record<string, unknown>;
    expect(created).toMatchObject({
      title: 'Recruit volunteers', metricType: 'number', startValue: 4,
      currentValue: 10, endValue: 16, health: 'at_risk', ownerId,
    });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

    const listed = await json(await fetch(`${baseUrl}/goals`, { headers: ownerHeaders }));
    expect(listed).toEqual([created]);

    const patched = await fetch(`${baseUrl}/goals/${created.id}`, {
      method: 'PATCH', headers: ownerHeaders,
      body: JSON.stringify({ currentValue: 13, health: 'on_track' }),
    });
    expect(patched.status).toBe(200);
    expect(await json(patched)).toMatchObject({ id: created.id, currentValue: 13, health: 'on_track' });

    expect((await fetch(`${baseUrl}/goals/${created.id}`, { method: 'DELETE', headers: ownerHeaders })).status).toBe(204);
    expect((await fetch(`${baseUrl}/goals/${created.id}`, { headers: ownerHeaders })).status).toBe(404);
  });

  it('keeps goals private to their owner and validates metric ranges', async () => {
    const goal = new GoalsRepository().create({
      title: 'Owner only', metricType: 'number', startValue: 0,
      currentValue: 1, endValue: 2, health: 'on_track',
      startDate: '2026-01-01', endDate: '2026-12-31', ownerId,
    });
    expect(await json(await fetch(`${baseUrl}/goals`, { headers: strangerHeaders }))).toEqual([]);
    expect((await fetch(`${baseUrl}/goals/${goal.id}`, { headers: strangerHeaders })).status).toBe(404);

    const invalid = await fetch(`${baseUrl}/goals`, {
      method: 'POST', headers: ownerHeaders,
      body: JSON.stringify({
        title: 'Bad goal', metricType: 'number', startValue: 10,
        currentValue: 5, endValue: 10, health: 'unknown',
        startDate: '2026-12-31', endDate: '2026-01-01',
      }),
    });
    expect(invalid.status).toBe(400);
  });

  it('returns persisted range progress on the dashboard and clamps it', async () => {
    const goals = new GoalsRepository();
    const partial = goals.create({
      title: 'Partial', metricType: 'number', startValue: 4,
      currentValue: 10, endValue: 16, health: 'on_track',
      startDate: '2026-01-01', endDate: '2099-12-31', ownerId,
    });
    const complete = goals.create({
      title: 'Complete', metricType: 'percentage', startValue: 0,
      currentValue: 150, endValue: 100, health: 'on_track',
      startDate: '2026-01-01', endDate: '2099-12-31', ownerId,
    });
    const summary = await json(await fetch(`${baseUrl}/dashboard/summary`, { headers: ownerHeaders })) as {
      goals: { activeCount: number; items: Array<{ id: string; progress: number }> };
    };
    expect(summary.goals.activeCount).toBe(2);
    expect(summary.goals.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: partial.id, progress: 0.5 }),
      expect.objectContaining({ id: complete.id, progress: 1 }),
    ]));
  });
});

const live = process.env.RHYTHM_LIVE_E2E === '1' ? describe : describe.skip;

live('issue #1243 live /goals behavior', () => {
  it('creates and observes the same stable goal through the real authenticated API', async () => {
    const baseUrl = process.env.RHYTHM_LIVE_API_URL ?? 'http://127.0.0.1:4098';
    const token = process.env.RHYTHM_LIVE_AUTH_TOKEN;
    expect(token, 'RHYTHM_LIVE_AUTH_TOKEN is required').toBeTruthy();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const createdResponse = await fetch(`${baseUrl}/goals`, {
      method: 'POST', headers,
      body: JSON.stringify({
        title: `Live season goal ${Date.now()}`, metricType: 'number',
        startValue: 0, currentValue: 2, endValue: 4, health: 'on_track',
        startDate: '2026-01-01', endDate: '2099-12-31',
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await json(createdResponse) as { id: string };
    const detail = await fetch(`${baseUrl}/goals/${created.id}`, { headers });
    expect(detail.status).toBe(200);
    expect(await json(detail)).toMatchObject({ id: created.id, currentValue: 2, endValue: 4 });
    await fetch(`${baseUrl}/goals/${created.id}`, { method: 'DELETE', headers });
  });
});
