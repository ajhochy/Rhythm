/** G2 S4: a workflow job's actual usage counts only when it covers every member session. */
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { installAgentBridgeSchema } from '../shared_agents/bridge_schema';

const NOW = '2026-10-02T12:00:00.000Z';
const OWNER = 701;

const member = (session: string, over: Record<string, unknown> = {}) => ({
  nativeSessionId: session, parentNativeSessionId: 'sdk-manager', nativeUserMessageId: `msg-${session}`,
  accountingKind: 'persisted_assistant', assistantMessageId: `a-${session}`, parentMessageId: `msg-${session}`, ...over,
});

function budget(memberSessions: string[], usage: Record<string, unknown>) {
  const db = new Database(':memory:');
  installAgentWorkstreamsSchema(db);
  installAgentBridgeSchema(db);
  const repository = new AgentBridgeJobsRepository(db);
  const ws = randomUUID();
  db.prepare(`INSERT INTO agent_workstreams (id, owner_user_id, project_id, goal, constraints_text, criteria_text,
    checkpoint_json, state, closed_reason, revision, create_key, payload_hash, created_at, updated_at)
    VALUES (?, ?, 'project-s4', 'g', 'c', 'k',
    '{"version":1,"criteria":[],"references":[],"nextAction":{"kind":"review","scope":"s4"}}',
    'ready', NULL, 3, ?, ?, ?, ?)`).run(ws, OWNER, `create-${ws}`, 'd'.repeat(64), NOW, NOW);
  const created = repository.createNativeOrReplay({
    localUserId: OWNER, workstreamId: ws, projectId: 'project-s4', capturedRevision: 3, hostEpoch: 'epoch',
    commandKey: 'cmd', targetAgentId: 'specialist', targetRevision: 9,
    parent: { runtimeInstance: 'rt', sessionId: 'sess', agentId: 'manager', projectionId: null },
    queueDeadlineAt: null, now: NOW,
  } as never).row;
  repository.configureCoordinatorNativeJob({
    localUserId: OWNER, workstreamId: ws, jobId: created.id, now: NOW,
    metadata: {
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 1000, queueDeadlineAt: null },
      workflow: {
        schemaVersion: 1, kind: 'coding_workflow', delivery: 'accepted',
        prepared: { workflowBinding: { managerSdkSessionId: 'sdk-manager' } },
        membership: memberSessions.map((s) => member(s)),
      },
    },
  });
  db.prepare(`UPDATE agent_bridge_jobs SET state='succeeded', native_dispatch_id='d', native_usage_json=?, terminal_at=? WHERE id=?`)
    .run(JSON.stringify({ schemaVersion: 1, status: 'actual', totalTokens: 120, ...usage }), NOW, created.id);
  const state = repository.coordinatorBudgetState({ localUserId: OWNER, workstreamId: ws });
  db.close();
  return { state, id: created.id };
}

describe('G2 S4 workflow usage completeness', () => {
  it('usage that covers manager + every member session is summed', () => {
    const { state } = budget(['sdk-child-1', 'sdk-child-2'], { coveredSessionCount: 3 });
    expect(state).toMatchObject({ actualTokens: 120, unknownJobIds: [], holdReason: null });
  });

  it('usage that skips a member session is null: no partial sum, budget_usage_unknown', () => {
    const { state, id } = budget(['sdk-child-1', 'sdk-child-2'], { coveredSessionCount: 2 });
    expect(state).toMatchObject({ actualTokens: 0, unknownJobIds: [id], holdReason: 'budget_usage_unknown' });
  });

  it('usage with no coverage evidence at all is null for a workflow job', () => {
    const { state } = budget(['sdk-child-1'], {});
    expect(state.actualTokens).toBe(0);
    expect(state.holdReason).toBe('budget_usage_unknown');
  });
});
