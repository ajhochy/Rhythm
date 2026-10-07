/** G2 S4: the workflow manager's async delegation and its native job are ONE capacity unit. */
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { installAgentBridgeSchema } from '../shared_agents/bridge_schema';

const NOW = '2026-10-02T12:00:00.000Z';
const OWNER = 701;

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  installAgentWorkstreamsSchema(db);
  installAgentBridgeSchema(db);
  db.exec(`
    CREATE TABLE agent_sessions (id TEXT PRIMARY KEY, owner_user_id INTEGER NOT NULL, project_id TEXT NOT NULL,
      status TEXT NOT NULL, sdk_session_id TEXT, cwd TEXT NOT NULL, parent_session_id TEXT, updated_at TEXT NOT NULL);
    CREATE TABLE agent_async_delegations (id TEXT PRIMARY KEY, parent_session_id TEXT NOT NULL,
      child_session_id TEXT NOT NULL, target_agent_config_id TEXT NOT NULL, status TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  const repository = new AgentBridgeJobsRepository(db);
  let n = 0;
  const workstream = () => {
    const id = randomUUID();
    db.prepare(`INSERT INTO agent_workstreams (id, owner_user_id, project_id, goal, constraints_text, criteria_text,
      checkpoint_json, state, closed_reason, revision, create_key, payload_hash, created_at, updated_at)
      VALUES (?, ?, 'project-s4', 'g', 'c', 'k',
      '{"version":1,"criteria":[],"references":[],"nextAction":{"kind":"review","scope":"s4"}}',
      'ready', NULL, 3, ?, ?, ?, ?)`).run(id, OWNER, `create-${id}`, 'd'.repeat(64), NOW, NOW);
    return id;
  };
  const job = (workstreamId: string, metadata: Record<string, unknown>) => {
    const created = repository.createNativeOrReplay({
      localUserId: OWNER, workstreamId, projectId: 'project-s4', capturedRevision: 3, hostEpoch: 'epoch',
      commandKey: `cmd-${n++}`, targetAgentId: 'specialist', targetRevision: 9,
      parent: { runtimeInstance: 'rt', sessionId: 'sess', agentId: 'manager', projectionId: null },
      queueDeadlineAt: null, now: NOW,
    } as never).row;
    return repository.configureCoordinatorNativeJob({
      localUserId: OWNER, workstreamId, jobId: created.id,
      metadata: { policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null }, ...metadata },
      now: NOW,
    });
  };
  const delegation = (id: string) => {
    db.prepare(`INSERT OR IGNORE INTO agent_sessions VALUES ('p', ?, 'other', 'idle', 'sdk-p', '/x', NULL, ?)`).run(OWNER + 1, NOW);
    db.prepare(`INSERT INTO agent_sessions VALUES (?, ?, 'other', 'idle', ?, '/x', 'p', ?)`).run(`c-${id}`, OWNER + 1, `sdk-${id}`, NOW);
    db.prepare(`INSERT INTO agent_async_delegations VALUES (?, 'p', ?, 'w', 'dispatched', ?, ?)`).run(id, `c-${id}`, NOW, NOW);
  };
  const queueTarget = () => {
    const ws = workstream();
    const target = job(ws, {});
    db.prepare(`UPDATE agent_workstreams SET state='queued', executor_epoch='epoch', last_job_id=? WHERE id=?`).run(target.id, ws);
    return { ws, target };
  };
  const claim = (t: { ws: string; target: { id: string } }) => repository.claimCoordinatorForExplicitDispatch({
    localUserId: OWNER, workstreamId: t.ws, jobId: t.target.id, hostEpoch: 'epoch', expectedRevision: 3, now: NOW,
  }).admitted;
  const workflowJob = (delegationId: string) => {
    const j = job(workstream(), { workflow: { schemaVersion: 1, kind: 'coding_workflow', prepared: { delegation: { delegationId } }, membership: [] } });
    db.prepare(`UPDATE agent_bridge_jobs SET state='running' WHERE id=?`).run(j.id);
    return j;
  };
  return { db, repository, delegation, queueTarget, claim, workflowJob };
}

describe('G2 S4 workflow capacity is counted exactly once', () => {
  it('the workflow manager delegation is not a second occupant, so an unrelated claim is admitted', () => {
    const f = fixture();
    f.delegation('wf-deleg');
    f.workflowJob('wf-deleg');
    expect(f.repository.readCoordinatorLegacyCapacitySnapshot()).toMatchObject({ available: true, totalActive: 0, rows: [] });
    expect(f.claim(f.queueTarget())).toBe(true); // native workflow counted once (1 < 2)
    f.db.close();
  });

  it('unrelated legacy occupancy is still counted alongside the workflow unit', () => {
    const f = fixture();
    f.delegation('wf-deleg');
    f.workflowJob('wf-deleg');
    f.delegation('unrelated');
    const snapshot = f.repository.readCoordinatorLegacyCapacitySnapshot();
    expect(snapshot.totalActive).toBe(1);
    expect(snapshot.rows.map((r) => r.delegationId)).toEqual(['unrelated']);
    expect(f.claim(f.queueTarget())).toBe(false); // workflow(1) + unrelated(1) = at capacity
    f.db.close();
  });

  it('a delegation whose workflow job is terminal is no longer excluded', () => {
    const f = fixture();
    f.delegation('wf-deleg');
    const j = f.workflowJob('wf-deleg');
    f.db.prepare(`UPDATE agent_bridge_jobs SET state='succeeded', terminal_at=? WHERE id=?`).run(NOW, j.id);
    expect(f.repository.readCoordinatorLegacyCapacitySnapshot().totalActive).toBe(1);
    f.db.close();
  });
});
