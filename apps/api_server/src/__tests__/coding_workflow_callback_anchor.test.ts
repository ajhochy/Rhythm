/**
 * G2 S4: the bound workflow manager's completion callback persists its minted
 * native anchor through the typed `onPrepared` hook BEFORE any exposure, even
 * with no Dayflow receiver; an unrelated callback is never attributed to the
 * job. Real completion service + repositories + migrated SQLite; only the engine
 * transport is stubbed, honouring the client contract (call onPrepared once, send
 * only when it returned true).
 */
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';

const sdkRequests: string[] = [];
let prepared: boolean[] = [];
const promptAsync = vi.fn();
vi.mock('../services/opencode_engine', () => ({
  opencodeClient: { promptAsync: (...a: unknown[]) => promptAsync(...a), abortSession: vi.fn() },
  opencodeSessionMap: new Map<string, string>(),
}));

import { AsyncDelegationCompletionService } from '../services/async_delegation_completion_service';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { encodeCoordinatorCallbackMarker } from '../contracts/coordinator_callback_marker';

const NOW = '2026-10-06T12:00:00.000Z';
const OWNER = 7;

function seed(delegationId: string, child: string) {
  const db = getDb();
  db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent) VALUES ('librarian', 'P', 'x', 'c', 1, 1)`).run();
  db.prepare(`INSERT OR IGNORE INTO agent_sessions (id, name, agent_kind, status, cwd, sdk_session_id, category, owner_user_id, project_id)
    VALUES ('root', 'root', 'librarian', 'idle', '/tmp', 'sdk-root', 'chat', ?, 'project-s4')`).run(OWNER);
  db.prepare(`INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, sdk_session_id, category, parent_session_id)
    VALUES (?, ?, 'workflow-orchestrator', 'idle', '/tmp', ?, 'chat', 'root')`).run(child, child, `sdk-${child}`);
  db.prepare(`INSERT INTO agent_async_delegations (id, parent_session_id, child_session_id, target_agent_config_id, status,
    completion_text, completed_at, created_at, updated_at)
    VALUES (?, 'root', ?, 'workflow-orchestrator', 'completed', 'done', ?, ?, ?)`).run(delegationId, child, NOW, NOW, NOW);
}

function workflowJob(delegationId: string) {
  const db = getDb();
  const repo = new AgentBridgeJobsRepository(db);
  const ws = randomUUID();
  db.prepare(`INSERT INTO agent_workstreams (id, owner_user_id, project_id, goal, constraints_text, criteria_text,
    checkpoint_json, state, closed_reason, revision, create_key, payload_hash, created_at, updated_at)
    VALUES (?, ?, 'project-s4', 'g', 'c', 'k',
    '{"version":1,"criteria":[],"references":[],"nextAction":{"kind":"review","scope":"s4"}}',
    'ready', NULL, 3, ?, ?, ?, ?)`).run(ws, OWNER, `create-${ws}`, 'd'.repeat(64), NOW, NOW);
  const created = repo.createNativeOrReplay({
    localUserId: OWNER, workstreamId: ws, projectId: 'project-s4', capturedRevision: 3, hostEpoch: 'epoch',
    commandKey: 'cmd', targetAgentId: 'specialist', targetRevision: 9,
    parent: { runtimeInstance: 'rt', sessionId: 'root', agentId: 'manager', projectionId: null },
    queueDeadlineAt: null, now: NOW,
  } as never).row;
  repo.configureCoordinatorNativeJob({
    localUserId: OWNER, workstreamId: ws, jobId: created.id, now: NOW,
    metadata: {
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 1000, queueDeadlineAt: null },
      workflow: { schemaVersion: 1, kind: 'coding_workflow', delivery: 'accepted',
        prepared: { delegation: { delegationId } }, membership: [] },
    },
  });
  db.prepare(`UPDATE agent_bridge_jobs SET state='running' WHERE id=?`).run(created.id);
  return { id: created.id, metadata: () => JSON.parse((db.prepare('SELECT native_metadata_json AS m FROM agent_bridge_jobs WHERE id=?').get(created.id) as { m: string }).m) };
}

beforeEach(() => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  runMigrations(db);
  setDb(db);
  prepared = [];
  sdkRequests.length = 0;
  promptAsync.mockReset();
  // Honour the production client contract for the typed callback context.
  promptAsync.mockImplementation(async (...args: unknown[]) => {
    const ctx = args[10] as { onPrepared?: (b: { dispatchId: string; sdkUserMessageId: string }) => boolean } | undefined;
    if (ctx?.onPrepared) {
      const ok = ctx.onPrepared({ dispatchId: 'dispatch-cb-1', sdkUserMessageId: 'msg-cb-anchor-1' }) === true;
      prepared.push(ok);
      if (!ok) return false;
    }
    sdkRequests.push(String(args[1]));
    return true;
  });
  vi.spyOn(CoordinatorConversationsRepository.prototype, 'coordinatorDelegationCallbackReason')
    .mockImplementation((i) => encodeCoordinatorCallbackMarker(i.delegationId));
});

describe('G2 S4 workflow callback native anchor', () => {
  it('the bound manager callback persists its anchor before any exposure, with no Dayflow receiver configured', async () => {
    seed('deleg-wf', 'child-wf');
    const job = workflowJob('deleg-wf');
    await (new AsyncDelegationCompletionService() as unknown as { flushParent(id: string): Promise<void> }).flushParent('root');
    expect(prepared).toEqual([true]);
    expect(sdkRequests).toHaveLength(1);
    expect(job.metadata().workflow.callbackAnchors).toEqual([
      { delegationId: 'deleg-wf', dispatchId: 'dispatch-cb-1', sdkUserMessageId: 'msg-cb-anchor-1' },
    ]);
  });

  it('a refused durable anchor holds: zero SDK requests', async () => {
    seed('deleg-wf', 'child-wf');
    const job = workflowJob('deleg-wf');
    // A conflicting anchor already recorded for this delegation: the CAS refuses.
    const meta = job.metadata();
    meta.workflow.callbackAnchors = [{ delegationId: 'deleg-wf', dispatchId: 'other', sdkUserMessageId: 'other' }];
    getDb().prepare('UPDATE agent_bridge_jobs SET native_metadata_json=? WHERE id=?').run(JSON.stringify(meta), job.id);
    await (new AsyncDelegationCompletionService() as unknown as { flushParent(id: string): Promise<void> }).flushParent('root');
    expect(prepared).toEqual([false]);
    expect(sdkRequests).toEqual([]);
  });

  it('a terminal workflow job is not attributed: no anchor hook at all', async () => {
    seed('deleg-wf', 'child-wf');
    const job = workflowJob('deleg-wf');
    getDb().prepare(`UPDATE agent_bridge_jobs SET state='failed', terminal_at=? WHERE id=?`).run(NOW, job.id);
    await (new AsyncDelegationCompletionService() as unknown as { flushParent(id: string): Promise<void> }).flushParent('root');
    expect(prepared).toEqual([]);
    expect(job.metadata().workflow.callbackAnchors).toBeUndefined();
  });

  it('an unrelated callback is not attributed to the workflow job', async () => {
    seed('deleg-wf', 'child-wf');
    seed('deleg-other', 'child-other');
    const job = workflowJob('deleg-wf');
    getDb().prepare(`UPDATE agent_async_delegations SET status='notified' WHERE id='deleg-wf'`).run();
    await (new AsyncDelegationCompletionService() as unknown as { flushParent(id: string): Promise<void> }).flushParent('root');
    expect(prepared).toEqual([]);
    expect(job.metadata().workflow.callbackAnchors).toBeUndefined();
  });
});
