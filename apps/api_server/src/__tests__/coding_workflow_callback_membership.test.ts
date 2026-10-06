/**
 * G2 S4: an API-descendant child's durable membership precedes its provider/SDK
 * request, and a deleted known member holds. Real guard + real job repository
 * (SQLite); only the owned-engine reads and the S2 service gate are stubbed.
 */
import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import type { AuthContext } from '../middleware/auth_middleware';
import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import { installAgentBridgeSchema } from '../shared_agents/bridge_schema';
import { AgentBridgeJobsRepository } from '../shared_agents/delegation_jobs_repository';
import { DayflowProviderAdmissionService } from '../services/dayflow_receiving_history_guard';

const NOW = new Date().toISOString();
const OWNER = 7;
const HASH = 'a'.repeat(64);
const auth = { sessionToken: 't', user: { id: OWNER } } as AuthContext;

function fixture(parent: string, options: { gate: 'append_first' | 'append_after'; wireMembership?: boolean; parentExists?: boolean }) {
  const db = new Database(':memory:');
  installAgentWorkstreamsSchema(db);
  installAgentBridgeSchema(db);
  const jobs = new AgentBridgeJobsRepository(db);
  const ws = randomUUID();
  db.prepare(`INSERT INTO agent_workstreams (id, owner_user_id, project_id, goal, constraints_text, criteria_text,
    checkpoint_json, state, closed_reason, revision, create_key, payload_hash, created_at, updated_at)
    VALUES (?, ?, 'project-s4', 'g', 'c', 'k',
    '{"version":1,"criteria":[],"references":[],"nextAction":{"kind":"review","scope":"s4"}}',
    'ready', NULL, 3, ?, ?, ?, ?)`).run(ws, OWNER, `create-${ws}`, 'd'.repeat(64), NOW, NOW);
  const created = jobs.createNativeOrReplay({
    localUserId: OWNER, workstreamId: ws, projectId: 'project-s4', capturedRevision: 3, hostEpoch: 'epoch',
    commandKey: 'cmd', targetAgentId: 'specialist', targetRevision: 9,
    parent: { runtimeInstance: 'rt', sessionId: 'root', agentId: 'manager', projectionId: null },
    queueDeadlineAt: null, now: NOW,
  } as never).row;
  jobs.configureCoordinatorNativeJob({
    localUserId: OWNER, workstreamId: ws, jobId: created.id, now: NOW,
    metadata: {
      policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 1000, queueDeadlineAt: null },
      workflow: { schemaVersion: 1, kind: 'coding_workflow', delivery: 'accepted', prepared: {}, membership: [] },
    },
  });
  db.prepare(`UPDATE agent_bridge_jobs SET state='running' WHERE id=?`).run(created.id);

  const binding = { schemaVersion: 1 as const, jobId: created.id, rootSdkSessionId: 'sdk-root', managerSdkSessionId: 'sdk-manager', expiresAt: NOW };
  const scope = { kind: 'manager_lineage' as const };
  const request = {
    schemaVersion: 1 as const, sdkSessionId: 'sdk-child', userMessageId: 'msg-child-1', requestNonce: 'n'.repeat(32),
    engineGeneration: 'engine-g1', runnerGeneration: 'runner-g1', attempt: 0, purpose: 'answer' as const, inputDigest: HASH,
  };
  const body = { schemaVersion: 2, kind: 'coordinator_workflow_provider', binding, scope, request };
  const frame = {
    schemaVersion: 2, kind: 'coordinator_workflow_provider_frame', binding, scope,
    accounting: { kind: 'persisted_assistant', assistantMessageId: 'asst-1', parentMessageId: 'msg-child-1' },
    nativeLineageDigest: HASH, frame: { schemaVersion: 1, status: 'pending', request },
  };
  const member = {
    nativeSessionId: 'sdk-child', parentNativeSessionId: parent, nativeUserMessageId: 'msg-child-1',
    engineGeneration: 'engine-g1', runnerGeneration: 'runner-g1', purpose: 'answer' as const, attempt: 0,
    requestIdentity: HASH, accountingKind: 'persisted_assistant' as const, assistantMessageId: 'asst-1', parentMessageId: 'msg-child-1',
  };
  const append = () => jobs.appendCoordinatorWorkflowMembership({
    localUserId: OWNER, workstreamId: ws, jobId: created.id, member, now: NOW,
  });
  const gate = {
    admit: async () => {
      if (options.gate === 'append_first') append();
      else setImmediate(append); // the mutation: membership lands after the decision
      return { status: 'allow' as const, reason: 'none' as const, authorityDigest: HASH, current: () => true };
    },
  };
  const guard = new DayflowProviderAdmissionService({
    records: { lookupProviderSession: () => ({ kind: 'none' }), hasSdkHistory: () => false } as never,
    engine: {
      getWorkflowProviderFrame: async () => frame,
      getSession: async (id: string) => id === 'sdk-child' ? { parentID: parent } : options.parentExists === false ? null : { id },
    } as never,
    reader: {} as never, evidence: { enrollmentBeforeBody: true } as never, authority: {} as never, enrollment: {} as never,
    workflow: gate as never,
    ...(options.wireMembership === false ? {} : {
      workflowMembership: {
        hasMember: (jobId: string, session: string, message: string) => {
          const row = jobs.findCoordinatorWorkflowJob(jobId);
          const list = (JSON.parse(row?.native_metadata_json ?? '{}').workflow?.membership ?? []) as Array<Record<string, unknown>>;
          return list.some((m) => m.nativeSessionId === session && m.nativeUserMessageId === message);
        },
      },
    }),
  });
  return { guard, body, db };
}

const decide = async (f: ReturnType<typeof fixture>) => {
  const result = await f.guard.admit(auth, f.body);
  if (!result.ok) throw new Error('admission refused at the wire');
  return result.finalize() as { workflow: { status: string; reason: string } };
};

describe('G2 S4 API-descendant membership precedes the SDK request', () => {
  it('append before the decision: allowed', async () => {
    const f = fixture('sdk-manager', { gate: 'append_first' });
    expect((await decide(f)).workflow).toMatchObject({ status: 'allow', reason: 'none' });
    f.db.close();
  });

  it('membership landing after the decision holds: no dispatch', async () => {
    const f = fixture('sdk-manager', { gate: 'append_after' });
    const verdict = (await decide(f)).workflow;
    expect(verdict.status).toBe('hold');
    f.db.close();
  });

  it('a deleted known member (descendant of a vanished parent) holds without reaching the gate', async () => {
    const f = fixture('sdk-known-member', { gate: 'append_first', parentExists: false });
    expect((await decide(f)).workflow).toMatchObject({ status: 'hold', reason: 'membership_unavailable' });
    expect(f.db.prepare(`SELECT native_metadata_json AS m FROM agent_bridge_jobs WHERE native_execution_kind='coordinator'`).get())
      .toMatchObject({ m: expect.stringContaining('"membership":[]') });
    f.db.close();
  });

  it('a live known member parent is admitted', async () => {
    const f = fixture('sdk-known-member', { gate: 'append_first', parentExists: true });
    expect((await decide(f)).workflow.status).toBe('allow');
    f.db.close();
  });
});
