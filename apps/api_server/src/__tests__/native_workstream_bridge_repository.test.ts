import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { installAgentWorkstreamsSchema } from '../database/agent_workstreams_schema';
import {
  AgentBridgeJobsRepository,
  type AgentBridgeJobInsert,
  type AgentBridgeJobRow,
} from '../shared_agents/delegation_jobs_repository';
import { installAgentBridgeSchema } from '../shared_agents/bridge_schema';
import type {
  NativeTerminationReceipt,
  NativeWorkstreamJobCreate,
} from '../shared_agents/native_workstream_job_contract';

const NOW = '2026-10-02T12:00:00.000Z';
const LATER = '2026-10-02T12:20:00.000Z';
const OWNER = 701;

type NativeRepository = AgentBridgeJobsRepository & {
  createNativeOrReplay(input: NativeWorkstreamJobCreate): { row: AgentBridgeJobRow; replay: boolean };
  getNativeForWorkstream(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
  }): AgentBridgeJobRow | null;
  listNativeForWorkstream(input: {
    localUserId: number;
    workstreamId: string;
  }): AgentBridgeJobRow[];
  requestNativeCancellation(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    now: string;
  }): AgentBridgeJobRow;
  reconcileNativeUnknown(input: {
    localUserId: number;
    workstreamId: string;
    jobId: string;
    receipt: NativeTerminationReceipt;
  }): AgentBridgeJobRow;
  expireNativeQueueDeadlines(now: string): string[];
};

function createFixture(): { db: Database.Database; repository: NativeRepository } {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  installAgentWorkstreamsSchema(db);
  installAgentBridgeSchema(db);
  return { db, repository: new AgentBridgeJobsRepository(db) as NativeRepository };
}

function insertWorkstream(
  db: Database.Database,
  input: { id?: string; owner?: number; project?: string; revision?: number } = {},
): string {
  const id = input.id ?? randomUUID();
  db.prepare(`INSERT INTO agent_workstreams (
    id, owner_user_id, project_id, goal, constraints_text, criteria_text, checkpoint_json,
    state, closed_reason, revision, create_key, payload_hash, created_at, updated_at
  ) VALUES (?, ?, ?, 'goal bytes', 'constraint bytes', 'criterion bytes',
    '{"version":1,"criteria":[],"references":[],"nextAction":{"kind":"review","scope":"s2a"}}',
    'ready', NULL, ?, ?, ?, ?, ?)`)
    .run(
      id,
      input.owner ?? OWNER,
      input.project ?? 'project-s2a',
      input.revision ?? 3,
      `create-${id}`,
      'd'.repeat(64),
      NOW,
      NOW,
    );
  return id;
}

function nativeInput(
  workstreamId: string,
  overrides: Partial<NativeWorkstreamJobCreate> = {},
): NativeWorkstreamJobCreate {
  return {
    localUserId: OWNER,
    workstreamId,
    projectId: 'project-s2a',
    capturedRevision: 3,
    hostEpoch: 'host-epoch-1',
    commandKey: 'command-1',
    targetAgentId: 'specialist',
    targetRevision: 9,
    parent: {
      runtimeInstance: 'runtime-parent-1',
      sessionId: 'session-parent-1',
      agentId: 'manager',
      projectionId: null,
    },
    queueDeadlineAt: null,
    now: NOW,
    ...overrides,
  };
}

function legacyInput(overrides: Partial<AgentBridgeJobInsert> = {}): AgentBridgeJobInsert {
  return {
    id: randomUUID(),
    direction: 'rhythm_to_hermes',
    idempotencyKey: randomUUID(),
    requestSha256: 'a'.repeat(64),
    localUserId: OWNER,
    hermesProfile: 'default',
    parentRuntime: 'opencode',
    parentRuntimeInstance: 'legacy-runtime',
    parentSessionId: 'shared-parent',
    parentAgentId: 'manager',
    parentProjectionId: null,
    targetAgentId: 'specialist',
    targetRevision: 9,
    targetRuntime: 'hermes',
    depth: 1,
    chainId: 'legacy-chain',
    prompt: 'legacy prompt remains free text',
    context: 'legacy context remains free text',
    cwd: null,
    now: NOW,
    ...overrides,
  };
}

function receipt(row: AgentBridgeJobRow, outcome: NativeTerminationReceipt['outcome']): NativeTerminationReceipt {
  return {
    schema: 'rhythm.native-termination.v1',
    receiptId: 'trusted-receipt-1',
    jobId: row.id,
    hostEpoch: row.host_epoch!,
    outcome,
    observedAt: LATER,
  };
}

function nativeRow(
  repository: NativeRepository,
  workstreamId: string,
  jobId: string,
): AgentBridgeJobRow | null {
  return repository.getNativeForWorkstream({ localUserId: OWNER, workstreamId, jobId });
}

describe('S2-A native workstream bridge repository', () => {
  it('S2A-C03: scopes native command replay without rewriting captured identity', async () => {
    const { db, repository } = createFixture();
    const workstreamId = insertWorkstream(db);
    const input = nativeInput(workstreamId);

    const [first, replay] = await Promise.all([
      Promise.resolve().then(() => repository.createNativeOrReplay(input)),
      Promise.resolve().then(() => repository.createNativeOrReplay({
        ...input,
        hostEpoch: 'host-epoch-2',
        parent: {
          runtimeInstance: 'runtime-parent-2',
          sessionId: 'session-parent-2',
          agentId: 'replacement-manager',
          projectionId: 'projection-rotated',
        },
      })),
    ]);
    expect([first.replay, replay.replay].sort()).toEqual([false, true]);
    expect(first.row.id).toBe(replay.row.id);
    expect(replay.row).toMatchObject({
      host_epoch: 'host-epoch-1',
      parent_runtime_instance: 'runtime-parent-1',
      parent_session_id: 'session-parent-1',
      parent_agent_id: 'manager',
    });
    expect(db.prepare("SELECT count(*) AS n FROM agent_bridge_jobs WHERE direction='rhythm_to_native'").get())
      .toEqual({ n: 1 });
    expect(repository.getNativeForWorkstream({
      localUserId: OWNER,
      workstreamId,
      jobId: first.row.id,
    })?.id).toBe(first.row.id);
    expect(repository.listNativeForWorkstream({ localUserId: OWNER, workstreamId }).map((row) => row.id))
      .toEqual([first.row.id]);
    expect(repository.getNativeForWorkstream({
      localUserId: OWNER + 1,
      workstreamId,
      jobId: first.row.id,
    })).toBeNull();
    expect(repository.get(first.row.id)).toBeNull();

    db.prepare(`UPDATE agent_workstreams
      SET revision=4, state='paused', closed_reason='user_paused', updated_at=? WHERE id=?`)
      .run(LATER, workstreamId);
    const historicalReplay = repository.createNativeOrReplay({
      ...input,
      hostEpoch: 'host-epoch-after-revision',
      parent: {
        runtimeInstance: 'runtime-after-revision',
        sessionId: 'session-after-revision',
        agentId: 'replacement-manager',
        projectionId: null,
      },
      now: LATER,
    });
    expect(historicalReplay).toEqual({ row: first.row, replay: true });

    expect(() => repository.createNativeOrReplay({ ...input, targetRevision: 10 }))
      .toThrowError(/idempotency_conflict/);
    expect(() => repository.createNativeOrReplay({
      ...input,
      commandKey: 'new-command-after-revision',
    })).toThrowError(/workstream_revision_mismatch/);

    const secondWorkstream = insertWorkstream(db);
    expect(repository.createNativeOrReplay(nativeInput(secondWorkstream)).replay).toBe(false);
    const deadlineInput = nativeInput(secondWorkstream, {
      commandKey: 'deadline-replay',
      queueDeadlineAt: '2026-10-02T12:05:00.000Z',
    });
    const deadlineFirst = repository.createNativeOrReplay(deadlineInput);
    expect(repository.expireNativeQueueDeadlines(LATER)).toContain(deadlineFirst.row.id);
    expect(repository.createNativeOrReplay({ ...deadlineInput, now: LATER })).toMatchObject({
      replay: true,
      row: { id: deadlineFirst.row.id, state: 'failed' },
    });
    const otherOwnerWorkstream = insertWorkstream(db, { owner: OWNER + 1 });
    expect(repository.createNativeOrReplay(nativeInput(otherOwnerWorkstream, { localUserId: OWNER + 1 })).replay)
      .toBe(false);

    const countBeforeInvalid = (db.prepare('SELECT count(*) AS n FROM agent_bridge_jobs').get() as { n: number }).n;
    expect(() => repository.createNativeOrReplay({ ...input, commandKey: 'cross-scope', projectId: 'other-project' }))
      .toThrowError(/workstream_scope_mismatch/);
    expect(() => repository.createNativeOrReplay({ ...input, commandKey: 'stale-revision', capturedRevision: 2 }))
      .toThrowError(/workstream_revision_mismatch/);
    expect((db.prepare('SELECT count(*) AS n FROM agent_bridge_jobs').get() as { n: number }).n)
      .toBe(countBeforeInvalid);

    const legacy = legacyInput();
    expect(repository.createOrReplay(legacy).replay).toBe(false);
    expect(repository.createOrReplay(legacy).replay).toBe(true);
    expect(() => repository.createOrReplay({ ...legacy, requestSha256: 'b'.repeat(64) }))
      .toThrowError(/idempotency_conflict/);
    db.close();
  });

  it('S2A-C04: preserves unknown cancellation until trusted reconciliation', () => {
    const { db, repository } = createFixture();
    const workstreamId = insertWorkstream(db);
    const row = repository.createNativeOrReplay(nativeInput(workstreamId)).row;
    db.prepare(`UPDATE agent_bridge_jobs
      SET state='unknown', state_reason='native_status_unknown', updated_at=? WHERE id=?`).run(NOW, row.id);

    const requested = repository.requestNativeCancellation({
      localUserId: OWNER,
      workstreamId,
      jobId: row.id,
      now: NOW,
    });
    expect(requested).toMatchObject({ state: 'unknown', cancel_requested_at: NOW });
    expect(repository.requestNativeCancellation({
      localUserId: OWNER,
      workstreamId,
      jobId: row.id,
      now: LATER,
    }).cancel_requested_at).toBe(NOW);

    expect(repository.reconcileNativeUnknown({
      localUserId: OWNER,
      workstreamId,
      jobId: row.id,
      receipt: receipt(requested, 'uncertain'),
    })).toMatchObject({ state: 'unknown', state_reason: 'native_status_unknown' });
    expect(() => repository.reconcileNativeUnknown({
      localUserId: OWNER + 1,
      workstreamId,
      jobId: row.id,
      receipt: receipt(requested, 'confirmed_terminated_without_execution'),
    })).toThrowError(/native_job_not_found/);
    expect(repository.reconcileNativeUnknown({
      localUserId: OWNER,
      workstreamId,
      jobId: row.id,
      receipt: receipt(requested, 'confirmed_terminated_without_execution'),
    })).toMatchObject({ state: 'failed', state_reason: 'cancelled_after_unknown' });

    const legacy = repository.createOrReplay(legacyInput()).row;
    expect(db.prepare('SELECT state, cancel_requested_at FROM agent_bridge_jobs WHERE id=?').get(legacy.id))
      .toEqual({ state: 'queued', cancel_requested_at: null });
    db.close();
  });

  it('S2A-C05: keeps native queues age-inert unless an explicit deadline expires', () => {
    const { db, repository } = createFixture();
    const workstreamId = insertWorkstream(db);
    const nativeQueued = repository.createNativeOrReplay(nativeInput(workstreamId, {
      commandKey: 'native-no-deadline',
      now: '2026-10-02T11:50:00.000Z',
    })).row;
    const nativeUnknown = repository.createNativeOrReplay(nativeInput(workstreamId, {
      commandKey: 'native-unknown',
      now: '2026-10-02T11:45:00.000Z',
    })).row;
    db.prepare(`UPDATE agent_bridge_jobs SET state='unknown', state_reason='native_status_unknown'
      WHERE id=?`).run(nativeUnknown.id);
    const nativeDeadline = repository.createNativeOrReplay(nativeInput(workstreamId, {
      commandKey: 'native-deadline',
      now: '2026-10-02T11:40:00.000Z',
      queueDeadlineAt: '2026-10-02T11:55:00.000Z',
    })).row;
    const legacy = repository.createOrReplay(legacyInput({ now: '2026-10-02T11:40:00.000Z' })).row;

    expect(repository.sweep(LATER)).toContain('shared-parent');
    expect(repository.get(legacy.id)).toMatchObject({ state: 'failed', state_reason: 'hermes_runtime_timeout' });
    expect(nativeRow(repository, workstreamId, nativeQueued.id)?.state).toBe('queued');
    expect(nativeRow(repository, workstreamId, nativeUnknown.id)?.state).toBe('unknown');
    expect(repository.expireNativeQueueDeadlines(LATER)).toEqual([nativeDeadline.id]);
    expect(nativeRow(repository, workstreamId, nativeDeadline.id)).toMatchObject({
      state: 'failed',
      state_reason: 'native_queue_deadline_exceeded',
    });
    expect(nativeRow(repository, workstreamId, nativeQueued.id)?.state).toBe('queued');
    expect(nativeRow(repository, workstreamId, nativeUnknown.id)?.state).toBe('unknown');
    db.close();
  });

  it('S3-C02: admits only two explicit coordinator workers and leaves the excess intent durably queued', () => {
    const { db, repository } = createFixture();
    const workstreamIds = [insertWorkstream(db), insertWorkstream(db), insertWorkstream(db)];
    const jobs = workstreamIds.map((workstreamId, index) => {
      const row = repository.createNativeOrReplay(nativeInput(workstreamId, {
        commandKey: `coordinator-capacity-${index + 1}`,
      })).row;
      return repository.configureCoordinatorNativeJob({
        localUserId: OWNER,
        workstreamId,
        jobId: row.id,
        metadata: {
          schemaVersion: 1,
          executionKind: 'read_only_managed_worker',
          policy: { maxTurns: 1, maxWallTimeSeconds: 300, maxTokens: 100, queueDeadlineAt: null },
        },
        now: NOW,
      });
    });

    const claims = jobs.map((job, index) => repository.claimCoordinatorForExplicitDispatch({
      localUserId: OWNER,
      workstreamId: workstreamIds[index],
      jobId: job.id,
      hostEpoch: 'host-epoch-1',
      now: NOW,
    }));

    expect(claims.map((claim) => claim.admitted)).toEqual([true, true, false]);
    expect(nativeRow(repository, workstreamIds[0], jobs[0].id)).toMatchObject({
      state: 'claimed', delivery_state: 'delivered', native_execution_kind: 'coordinator',
    });
    expect(nativeRow(repository, workstreamIds[1], jobs[1].id)).toMatchObject({
      state: 'claimed', delivery_state: 'delivered', native_execution_kind: 'coordinator',
    });
    expect(nativeRow(repository, workstreamIds[2], jobs[2].id)).toMatchObject({
      state: 'queued', delivery_state: 'delivered', native_execution_kind: 'coordinator',
    });
    db.close();
  });

  it('S2A-C06: excludes native rows from every legacy completion and mutator path', () => {
    const { db, repository } = createFixture();
    const workstreamId = insertWorkstream(db);
    const nativePending = repository.createNativeOrReplay(nativeInput(workstreamId, {
      commandKey: 'native-terminal-pending',
      parent: { runtimeInstance: 'native-runtime', sessionId: 'shared-parent', agentId: 'manager', projectionId: null },
    })).row;
    db.prepare("UPDATE agent_bridge_jobs SET state='succeeded', terminal_at=?, updated_at=? WHERE id=?")
      .run(NOW, NOW, nativePending.id);
    const nativeWaking = repository.createNativeOrReplay(nativeInput(workstreamId, {
      commandKey: 'native-terminal-waking',
      parent: { runtimeInstance: 'native-runtime', sessionId: 'shared-parent', agentId: 'manager', projectionId: null },
    })).row;
    db.prepare("UPDATE agent_bridge_jobs SET state='failed', state_reason='cancelled_after_unknown', delivery_state='waking', terminal_at=? WHERE id=?")
      .run(NOW, nativeWaking.id);
    const nativeQueued = repository.createNativeOrReplay(nativeInput(workstreamId, {
      commandKey: 'native-queued',
    })).row;

    const legacyPending = repository.createOrReplay(legacyInput({ idempotencyKey: 'legacy-pending' })).row;
    repository.completeFromRunner(legacyPending.id, { status: 'done', result: 'legacy result' }, NOW);
    const legacyWaking = repository.createOrReplay(legacyInput({ idempotencyKey: 'legacy-waking' })).row;
    repository.completeFromRunner(legacyWaking.id, { status: 'error', result: '', error: 'legacy error' }, NOW);
    db.prepare("UPDATE agent_bridge_jobs SET delivery_state='waking' WHERE id=?").run(legacyWaking.id);

    expect(repository.listWakingParentIds()).toEqual(['shared-parent']);
    expect(repository.listForParent({
      localUserId: OWNER,
      parentRuntime: 'opencode',
      parentSessionId: 'shared-parent',
    }).map((row) => row.id).sort()).toEqual([legacyPending.id, legacyWaking.id].sort());
    expect(repository.listWakingForParent('shared-parent').map((row) => row.id)).toEqual([legacyWaking.id]);
    expect(repository.claimCompletedForParent('shared-parent', LATER).map((row) => row.id)).toEqual([legacyPending.id]);
    expect(nativeRow(repository, workstreamId, nativePending.id)?.delivery_state).toBe('pending');

    repository.markDelivered([nativeWaking.id, legacyWaking.id], LATER);
    expect(nativeRow(repository, workstreamId, nativeWaking.id)?.delivery_state).toBe('waking');
    expect(repository.get(legacyWaking.id)?.delivery_state).toBe('delivered');
    repository.releaseDeliveryClaims([nativeWaking.id, legacyPending.id]);
    expect(nativeRow(repository, workstreamId, nativeWaking.id)?.delivery_state).toBe('waking');
    expect(repository.get(legacyPending.id)?.delivery_state).toBe('pending');

    expect(() => repository.setChild(nativeQueued.id, 'forbidden-child')).toThrowError(/native_job_unsupported/);
    expect(() => repository.completeFromRunner(nativeQueued.id, { status: 'done', result: 'forbidden' }))
      .toThrowError(/native_job_unsupported/);
    expect(() => repository.cancel(nativeQueued.id)).toThrowError(/native_job_unsupported/);
    expect(() => repository.readResult(nativePending.id)).toThrowError(/native_job_unsupported/);
    expect(() => repository.report({
      jobId: nativeQueued.id,
      leaseToken: 'forbidden',
      phase: 'failed',
      errorCode: 'engine_error',
      now: LATER,
    })).toThrowError(/native_job_unsupported/);
    expect(nativeRow(repository, workstreamId, nativeQueued.id))
      .toMatchObject({ state: 'queued', child_session_id: null });
    expect(nativeRow(repository, workstreamId, nativePending.id)).toMatchObject({
      state: 'succeeded',
      result_text: null,
      delivery_state: 'pending',
    });
    db.close();
  });
});
