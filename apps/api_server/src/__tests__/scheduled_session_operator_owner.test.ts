/**
 * Regression 2026-10-22: a human replied into the Secretary's scheduled
 * morning-briefing session and rhythm_delegate_async returned
 * "403 caller session is owned by another user". Scheduled runs were stored
 * ownerless (legacy schedules have no created_by_user_id) while their MCP calls
 * authenticate as the local operator, so the strict owner check could never pass.
 *
 * The check stays strict. Scheduled runs are attributed to the same local
 * operator that bearer-less local session creation already uses (sole paired
 * mobile user), at run time and for existing rows.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { env } from '../config/env';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { UsersRepository } from '../repositories/users_repository';
import { initializeMobilePairingSchema } from '../repositories/mobile_devices_repository';
import { localOperatorUserId } from '../services/local_operator';
import { scheduledRunOwnerUserId } from '../services/agentSchedulerService';
import { delegateToAgentAsync } from '../services/agent_delegation_service';

let db: Database.Database;
let operator: number;
let other: number;
const previousAgentLocal = env.agentLocal;

function pairDevice(userId: number, id: string) {
  db.prepare(`INSERT INTO mobile_devices (id, host_id, user_id, name, token_verifier, created_at)
    VALUES (?, 'host', ?, 'phone', 'verifier', '2026-10-22T00:00:00Z')`).run(id, userId);
}

function scheduledSession(id: string, ownerUserId?: number) {
  db.prepare(`INSERT OR IGNORE INTO agent_scheduled_tasks (id, name, prompt) VALUES ('briefing', 'daily-morning-briefing', 'brief')`).run();
  const session = new AgentSessionsRepository().insert({
    agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: `Scheduled ${id}`,
    mcpRole: 'secretary', scheduledTaskId: 'briefing', isSystem: true,
    ...(ownerUserId === undefined ? {} : { ownerUserId }),
  });
  return session.id;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  initializeMobilePairingSchema(db);
  setDb(db);
  const users = new UsersRepository();
  operator = users.create({ name: 'Operator', email: 'operator@example.com' }).id;
  other = users.create({ name: 'Other', email: 'other@example.com' }).id;
  env.agentLocal = true;
});
afterEach(() => { env.agentLocal = previousAgentLocal; });

describe('scheduled runs are attributed to the local operator', () => {
  it('the local operator is the sole paired user, and nobody when that is ambiguous or hosted', () => {
    expect(localOperatorUserId()).toBeNull();
    pairDevice(operator, 'd1');
    pairDevice(operator, 'd2');
    expect(localOperatorUserId()).toBe(operator);
    pairDevice(other, 'd3');
    expect(localOperatorUserId()).toBeNull();
    db.prepare(`DELETE FROM mobile_devices WHERE id = 'd3'`).run();
    env.agentLocal = false;
    expect(localOperatorUserId()).toBeNull();
  });

  it('a recorded schedule creator still wins over the local operator', () => {
    pairDevice(operator, 'd1');
    expect(scheduledRunOwnerUserId({ createdByUserId: other })).toBe(other);
    expect(scheduledRunOwnerUserId({ createdByUserId: null })).toBe(operator);
  });

  it('backfill attributes only ownerless scheduled sessions', () => {
    const ownerless = scheduledSession('ownerless');
    const othersRun = scheduledSession('others', other);
    const repo = new AgentSessionsRepository();
    const interactive = repo.insert({ agentKind: 'claude-code', taskId: null, cwd: '/tmp', name: 'chat' }).id;

    expect(repo.attributeOwnerlessScheduledSessions(operator)).toBe(1);
    expect(repo.findById(ownerless)?.ownerUserId).toBe(operator);
    expect(repo.findById(othersRun)?.ownerUserId).toBe(other);
    expect(repo.findById(interactive)?.ownerUserId).toBeNull();
    expect(repo.attributeOwnerlessScheduledSessions(operator)).toBe(0);
  });

  it('delegation from a scheduled session passes ownership only for its attributed owner', async () => {
    const sessionId = scheduledSession('briefing-chat');
    const call = (authenticatedUserId: number) => delegateToAgentAsync({
      authenticatedUserId, callerSessionId: sessionId, callerAgentConfigId: null,
      targetAgentConfigId: 'workflow-orchestrator', prompt: 'plan it', context: null,
    });
    // The reported failure: ownerless scheduled session, operator bearer.
    await expect(call(operator)).rejects.toThrow(/owned by another user/);

    pairDevice(operator, 'd1');
    new AgentSessionsRepository().attributeOwnerlessScheduledSessions(localOperatorUserId()!);
    // Past the ownership gate (the missing target profile fails next instead).
    await expect(call(operator)).rejects.not.toThrow(/owned by another user/);
    // Another user is still refused.
    await expect(call(other)).rejects.toThrow(/owned by another user/);
  });
});
