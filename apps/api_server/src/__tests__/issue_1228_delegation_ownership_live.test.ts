/**
 * Live behavioral test for issue #1228.
 *
 * Drives both real HTTP delegation routes against the isolated dev sandbox
 * and proves a second authenticated user cannot create any delegation from a
 * known foreign caller-session id. The ownership rejection occurs before the
 * real fork engine boundary, but the sandbox must still provide both services.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { setDb } from '../database/db';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { SessionsRepository } from '../repositories/sessions_repository';
import { UsersRepository } from '../repositories/users_repository';

const runLive =
  process.env.RHYTHM_LIVE_E2E === '1' &&
  process.env.RHYTHM_LIVE_E2E_ISOLATED === '1'
    ? describe
    : describe.skip;

runLive('issue #1228 live delegation ownership', () => {
  it('denies sync and async foreign-session delegation without side effects', async () => {
    const baseUrl = process.env.RHYTHM_LIVE_URL;
    const dbPath =
      process.env.RHYTHM_LIVE_DB_PATH ?? process.env.DB_PATH;
    if (!baseUrl || !dbPath || /:4001(?:\/|$)/.test(baseUrl)) {
      throw new Error(
        'UNVERIFIED: requires isolated RHYTHM_LIVE_URL and RHYTHM_LIVE_DB_PATH',
      );
    }

    const db = new Database(dbPath);
    db.pragma('foreign_keys = ON');
    setDb(db);
    const marker = randomUUID();
    const managerId = `issue-1228-manager-${marker}`;
    const specialistId = `issue-1228-specialist-${marker}`;
    const profiles = new AgentConfigsRepository();
    profiles.insert({
      id: managerId,
      label: managerId,
      icon: 'agent',
      enabled: true,
      isAgent: true,
      isManager: true,
      sessionSelectable: true,
      allowedDelegatesJson: JSON.stringify([specialistId]),
    });
    profiles.insert({
      id: specialistId,
      label: specialistId,
      icon: 'agent',
      enabled: true,
      isAgent: true,
      sessionSelectable: true,
    });

    const users = new UsersRepository();
    const owner = users.create({
      name: `Issue 1228 owner ${marker}`,
      email: `issue-1228-owner-${marker}@example.com`,
    });
    const attacker = users.create({
      name: `Issue 1228 attacker ${marker}`,
      email: `issue-1228-attacker-${marker}@example.com`,
    });
    const attackerAuth = await new SessionsRepository().createAsync(
      attacker.id,
    );
    const caller = new AgentSessionsRepository().insert({
      agentKind: managerId as never,
      taskId: null,
      cwd: '/tmp',
      name: managerId,
      mcpRole: managerId,
      ownerUserId: owner.id,
    });

    const beforeChildren = (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM agent_sessions WHERE parent_session_id = ?',
        )
        .get(caller.id) as { count: number }
    ).count;
    const beforeAsync = (
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM agent_async_delegations WHERE parent_session_id = ?',
        )
        .get(caller.id) as { count: number }
    ).count;
    const headers = {
      Authorization: `Bearer ${attackerAuth.token}`,
      'Content-Type': 'application/json',
    };
    const body = JSON.stringify({
      callerSessionId: caller.id,
      callerAgentConfigId: managerId,
      targetAgentConfigId: specialistId,
      prompt: 'This foreign session must not delegate.',
    });

    for (const path of ['/delegate', '/delegate-async']) {
      const response = await fetch(`${baseUrl}/agent-delegation${path}`, {
        method: 'POST',
        headers,
        body,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: {
          code: 'FORBIDDEN',
          message: expect.stringMatching(/owned by another user/i),
        },
      });
    }

    expect(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM agent_sessions WHERE parent_session_id = ?',
          )
          .get(caller.id) as { count: number }
      ).count,
    ).toBe(beforeChildren);
    expect(
      (
        db
          .prepare(
            'SELECT COUNT(*) AS count FROM agent_async_delegations WHERE parent_session_id = ?',
          )
          .get(caller.id) as { count: number }
      ).count,
    ).toBe(beforeAsync);
  });
});
