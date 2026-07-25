/**
 * Acceptance contract for #1135 item 3.
 *
 * Plausible regression caught: a security-audit-disabled profile can be
 * re-enabled by the ordinary designer PATCH, or a reviewer can unlock stale
 * state without acknowledging the exact lock being reviewed. The 409
 * assertions and persisted security-event assertions fail for either bug.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createApp } from '../app';
import { runMigrations } from '../database/migrations';
import { getDb, setDb } from '../database/db';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { startTestServer } from './helpers/real_server';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  return db;
}

describe('issue-1135-c3: audit lock is durable and only a matching reviewed transition can re-enable', () => {
  let baseUrl: string;
  let closeServer: () => Promise<void>;
  let authHeaders: Record<string, string>;

  beforeEach(async () => {
    setDb(makeDb());
    const user = new UsersRepository().create({
      name: 'Security Reviewer',
      email: 'reviewer@example.com',
      role: 'admin',
    });
    const session = await new SessionsRepository().createAsync(user.id);
    authHeaders = {
      Authorization: `Bearer ${session.token}`,
      'Content-Type': 'application/json',
    };
    ({ baseUrl, close: closeServer } = await startTestServer(createApp()));
  });

  afterEach(async () => {
    await closeServer();
  });

  it('persists the lock, rejects generic/stale re-enable, and records the exact reviewed transition', async () => {
    const createRes = await fetch(`${baseUrl}/agent-configs`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        id: 'audit-locked-agent',
        label: 'Audit Locked Agent',
        isAgent: true,
        enabled: true,
        sessionSelectable: true,
      }),
    });
    expect(createRes.status).toBe(201);

    const disabledReason = '2026-07-20 security audit: stale privileged prompt';
    const lockRes = await fetch(
      `${baseUrl}/agent-configs/audit-locked-agent/security-lock`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          reason: disabledReason,
        }),
      },
    );
    expect(lockRes.status).toBe(200);
    const locked = (await lockRes.json()) as {
      enabled: boolean;
      locked: boolean;
      disabledReason: string | null;
      lockedAt: string | null;
      lockedBy: string | null;
    };
    expect(locked).toMatchObject({
      enabled: false,
      locked: true,
      disabledReason,
      lockedBy: 'reviewer@example.com',
    });
    expect(locked.lockedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // A privileged/out-of-band enabled-column edit must not neutralize the
    // independent security lock.
    getDb()
      .prepare(`UPDATE agent_configs SET enabled = 1 WHERE id = ?`)
      .run('audit-locked-agent');

    const genericRes = await fetch(
      `${baseUrl}/agent-configs/audit-locked-agent`,
      {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(genericRes.status).toBe(409);
    expect(await genericRes.json()).toMatchObject({
      error: {
        code: 'CONFLICT',
      },
    });

    const staleReviewRes = await fetch(
      `${baseUrl}/agent-configs/audit-locked-agent/reviewed-reenable`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          expectedLockedAt: '2026-01-01T00:00:00.000Z',
          expectedDisabledReason: disabledReason,
          reviewNote: 'Prompt and permissions were independently reviewed.',
        }),
      },
    );
    expect(staleReviewRes.status).toBe(409);

    const reviewedRes = await fetch(
      `${baseUrl}/agent-configs/audit-locked-agent/reviewed-reenable`,
      {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          expectedLockedAt: locked.lockedAt,
          expectedDisabledReason: disabledReason,
          reviewNote: 'Prompt and permissions were independently reviewed.',
        }),
      },
    );
    expect(reviewedRes.status).toBe(200);
    const reviewed = (await reviewedRes.json()) as {
      enabled: boolean;
      locked: boolean;
      disabledReason: string | null;
      lockedAt: string | null;
    };
    expect(reviewed).toMatchObject({
      enabled: true,
      locked: false,
      disabledReason: null,
      lockedAt: null,
    });

    const eventsRes = await fetch(
      `${baseUrl}/agent-configs/audit-locked-agent/security-events`,
      { headers: authHeaders },
    );
    expect(eventsRes.status).toBe(200);
    const { events } = (await eventsRes.json()) as {
      events: Array<{
        eventType: string;
        actor: string;
        reason: string;
        reviewNote: string | null;
      }>;
    };
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      eventType: 'locked',
      actor: 'reviewer@example.com',
      reason: disabledReason,
    });
    expect(events[1]).toMatchObject({
      eventType: 'reviewed_reenabled',
      actor: 'reviewer@example.com',
      reason: disabledReason,
      reviewNote: 'Prompt and permissions were independently reviewed.',
    });
  });
});
