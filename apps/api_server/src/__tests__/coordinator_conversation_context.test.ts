import { describe, expect, it } from 'vitest';

import type {
  CoordinatorContextRead,
  CoordinatorConversation,
  CoordinatorConversationContextAdapters,
  CoordinatorDayflowDependencyManifest,
  CoordinatorManualActivityReference,
} from '../contracts/coordinator_conversation_contract';
import {
  CoordinatorConversationContextAssembler,
  losAngelesDay,
  losAngelesDayWindow,
} from '../services/coordinator_conversation_context';

const observedAt = '2026-10-05T12:00:00.000Z';
const conversation: CoordinatorConversation = {
  schemaVersion: 4,
  id: 'conversation-1',
  sessionId: 'chat-1',
  ownerUserId: 7,
  projectId: 'project-a',
  controlRevision: 1,
  primaryOwnerRoot: false,
  goals: [],
  commandDedupe: [],
  continuations: [],
  createdAt: observedAt,
  updatedAt: observedAt,
};

function available<T>(items: T[], sourceVersion = 'snapshot-1'): CoordinatorContextRead<T> {
  return {
    availability: 'available',
    reason: null,
    complete: true,
    authoritative: true,
    observedAt,
    sourceVersion,
    items,
  };
}

function dayflowReference(overrides: Partial<CoordinatorManualActivityReference> = {}): CoordinatorManualActivityReference {
  return {
    sourceId: 'dayflow-ref-1', expectedVersion: 'v1', observedAt: '2026-10-05T06:30:00.000Z', state: 'active',
    namespace: 'dayflow', sourceInstance: 'instance-a', sourceRevision: 'revision-1', sourceHash: 'a'.repeat(64),
    canonicalId: 'dayflow-ref-1', canonicalVersion: 'v1', consentGeneration: 'consent-1',
    configurationGeneration: 'config-1', expiresAt: '2026-10-05T13:00:00.000Z', eligibility: 'active',
    ...overrides,
  };
}

function dayflowAvailable(items: CoordinatorManualActivityReference[]): CoordinatorContextRead<CoordinatorManualActivityReference> {
  const manifest: CoordinatorDayflowDependencyManifest = {
    schemaVersion: 1,
    namespace: 'dayflow',
    sourceInstance: 'instance-a',
    consentGeneration: 'consent-1',
    configurationGeneration: 'config-1',
    sourceVersion: 'dayflow-reader-v1',
    sourceRevision: 'envelope-r1',
    sourceHash: 'e'.repeat(64),
    expiresAt: '2026-10-05T13:00:00.000Z',
    observedAt,
    references: items.map((item) => ({
      canonicalId: item.canonicalId,
      canonicalVersion: item.canonicalVersion,
      sourceRevision: item.sourceRevision,
      sourceHash: item.sourceHash,
      expiresAt: item.expiresAt,
    })),
  };
  return {
    availability: 'available',
    reason: null,
    complete: true,
    authoritative: true,
    observedAt,
    sourceVersion: manifest.sourceVersion,
    dependencyManifest: manifest,
    items,
  };
}

function adapters(overrides: Partial<CoordinatorConversationContextAdapters> = {}): CoordinatorConversationContextAdapters {
  return {
    tasks: { read: async () => available([
      { id: 'today', title: 'Today task', status: 'open' as const, dueDate: '2026-10-05', scheduledDate: null, priority: 2 },
      // There is no completedAt in the task model. `updatedAt` is not even
      // accepted by this context contract, so it cannot become yesterday.
      { id: 'done-edited', title: 'Done but date unknown', status: 'done' as const, dueDate: null, scheduledDate: null, priority: null },
      { id: 'reply', title: 'Await reply', status: 'waiting_for_reply' as const, dueDate: null, scheduledDate: null, priority: null },
    ]) },
    schedules: { read: async () => available([
      { id: 'owned', name: 'Owned schedule', enabled: true, nextRunAt: '2026-10-05T15:00:00.000Z', createdByUserId: 7 },
      // Concrete schedule repository reads can include null/global rows; they
      // are never projected into this owner's context.
      { id: 'global', name: 'Must not appear', enabled: true, nextRunAt: '2026-10-05T15:00:00.000Z', createdByUserId: null } as unknown as { id: string; name: string; enabled: boolean; nextRunAt: string; createdByUserId: number },
    ]) },
    rhythms: { read: async () => available([]) },
    workstreams: { read: async () => available([
      { id: 'ws-1', state: 'running' as const, stateReason: null, revision: 4, lastJobId: 'job-1' },
    ]) },
    receipts: { read: async () => available([
      {
        id: 'worker-succeeded-not-goal', workstreamId: 'ws-1', workstreamRevision: 4, jobId: 'job-1',
        executionState: 'succeeded' as const, criterionState: 'pending' as const, authority: 'unqualified' as const,
        recordedAt: observedAt, actualUsage: { state: 'unknown' as const, tokens: null },
      },
      {
        id: 'verified-yesterday', workstreamId: 'ws-1', workstreamRevision: 4, jobId: 'job-2',
        executionState: 'succeeded' as const, criterionState: 'verified' as const, authority: 'server_receipt' as const,
        recordedAt: '2026-10-05T06:30:00.000Z', actualUsage: { state: 'actual' as const, tokens: 22 },
      },
      {
        id: 'other-workstream', workstreamId: 'ws-other', workstreamRevision: 1, jobId: 'job-other',
        executionState: 'succeeded' as const, criterionState: 'verified' as const, authority: 'server_receipt' as const,
        recordedAt: '2026-10-05T06:30:00.000Z', actualUsage: { state: 'actual' as const, tokens: 1 },
      },
    ]) },
    manualActivity: { read: async () => dayflowAvailable([dayflowReference()]) },
    ...overrides,
  };
}

describe('coordinator conversation context', () => {
  it('uses LA civil days across midnight and DST without subtracting a fixed 24 hours', () => {
    expect(losAngelesDay(new Date('2026-10-05T06:59:59.000Z'))).toBe('2026-10-04');
    expect(losAngelesDay(new Date('2026-10-05T07:00:00.000Z'))).toBe('2026-10-05');
    const spring = losAngelesDayWindow('2026-03-08');
    const fall = losAngelesDayWindow('2026-11-01');
    expect((spring.end.valueOf() - spring.start.valueOf()) / 3_600_000).toBe(23);
    expect((fall.end.valueOf() - fall.start.valueOf()) / 3_600_000).toBe(25);
  });

  it('keeps completion, worker success, scope, opaque Dayflow references, and usage holds distinct', async () => {
    const seenScopes: Array<{ ownerUserId: number; projectId: string }> = [];
    let dayflowReads = 0;
    const source = adapters({
      tasks: { read: async (scope) => {
        seenScopes.push({ ownerUserId: scope.ownerUserId, projectId: scope.projectId });
        return available([
          { id: 'today', title: 'Today task', status: 'open' as const, dueDate: '2026-10-05', scheduledDate: null, priority: 2 },
          { id: 'done-edited', title: 'Done but date unknown', status: 'done' as const, dueDate: null, scheduledDate: null, priority: null },
          { id: 'reply', title: 'Await reply', status: 'waiting_for_reply' as const, dueDate: null, scheduledDate: null, priority: null },
        ]);
      } },
      manualActivity: { read: async () => {
        dayflowReads += 1;
        return dayflowAvailable([]);
      } },
    });
    const output = await new CoordinatorConversationContextAssembler(source).assemble({
      conversation,
      now: new Date(observedAt),
    });

    expect(seenScopes).toEqual([{ ownerUserId: 7, projectId: 'project-a' }]);
    expect(output.todayTasks.map((task) => task.id)).toEqual(['today']);
    expect(output.waitingForReply.map((task) => task.id)).toEqual(['reply']);
    expect(output.doneWithUnknownCompletionDate.map((task) => task.id)).toEqual(['done-edited']);
    expect(output.verifiedYesterday.map((receipt) => receipt.id)).toEqual(['verified-yesterday']);
    expect(output.executionSucceededGoalUnverified.map((receipt) => receipt.id)).toEqual(['worker-succeeded-not-goal']);
    expect(output.usageHolds.map((receipt) => receipt.id)).toEqual(['worker-succeeded-not-goal']);
    expect(output.scheduledPriorities.map((schedule) => schedule.id)).toEqual(['owned']);
    expect(output.availability.manualActivity).toEqual({ state: 'available', reason: null });
    expect(output.manualActivity).toEqual([]);
    expect(dayflowReads).toBe(1);
    expect(JSON.stringify(output)).not.toContain('private window title');
    expect(JSON.stringify(output)).not.toContain('other-workstream');
    expect(output.modelContext.kind).toBe('ready');
  });

  it('holds stale revisions and malformed actual usage while mapping free-text reasons to unknown_reason', async () => {
    const output = await new CoordinatorConversationContextAssembler(adapters({
      workstreams: { read: async () => available([
        { id: 'ws-1', state: 'running' as const, stateReason: 'provider wrote arbitrary prose' as unknown as null, revision: 8, lastJobId: 'job-8' },
      ]) },
      receipts: { read: async () => available([
        {
          id: 'stale-revision', workstreamId: 'ws-1', workstreamRevision: 7, jobId: 'job-7',
          executionState: 'succeeded' as const, criterionState: 'verified' as const, authority: 'server_receipt' as const,
          recordedAt: '2026-10-05T06:30:00.000Z', actualUsage: { state: 'actual' as const, tokens: 22 },
        },
        {
          id: 'missing-actual', workstreamId: 'ws-1', workstreamRevision: 8, jobId: 'job-8a',
          executionState: 'succeeded' as const, criterionState: 'pending' as const, authority: 'unqualified' as const,
          recordedAt: observedAt, actualUsage: { state: 'actual' as const, tokens: null },
        },
        {
          id: 'negative-actual', workstreamId: 'ws-1', workstreamRevision: 8, jobId: 'job-8b',
          executionState: 'succeeded' as const, criterionState: 'pending' as const, authority: 'unqualified' as const,
          recordedAt: observedAt, actualUsage: { state: 'actual' as const, tokens: -1 },
        },
      ]) },
    })).assemble({ conversation, now: new Date(observedAt) });

    expect(output.verifiedYesterday).toEqual([]);
    expect(output.staleExecutions.map((receipt) => receipt.id)).toEqual(['stale-revision']);
    expect(output.usageHolds.map((receipt) => receipt.id)).toEqual(['missing-actual', 'negative-actual']);
    expect(output.receipts.filter((receipt) => receipt.id !== 'stale-revision').map((receipt) => receipt.actualUsage))
      .toEqual([{ state: 'unknown', tokens: null }, { state: 'unknown', tokens: null }]);
    expect(output.activeWorkstreams).toMatchObject([{ id: 'ws-1', stateReason: 'unknown_reason' }]);
  });

  it('fails closed for adapter faults, non-authoritative empty replies, and oversized context fields', async () => {
    const malformedEmpty = await new CoordinatorConversationContextAssembler(adapters({
      tasks: { read: async () => ({ availability: 'available', reason: null, items: [] } as unknown as CoordinatorContextRead<never>) },
    })).assemble({ conversation, now: new Date(observedAt) });
    expect(malformedEmpty.availability.tasks).toEqual({ state: 'unavailable', reason: 'source_unavailable' });
    expect(malformedEmpty.todayTasks).toEqual([]);

    const faulted = await new CoordinatorConversationContextAssembler(adapters({
      tasks: { read: async () => { throw new Error('adapter failure'); } },
    })).assemble({ conversation, now: new Date(observedAt) });
    expect(faulted.availability.tasks).toEqual({ state: 'unavailable', reason: 'source_unavailable' });

    const oversized = await new CoordinatorConversationContextAssembler(adapters({
      tasks: { read: async () => available([
        { id: 'too-large', title: 'x'.repeat(1_025), status: 'open' as const, dueDate: '2026-10-05', scheduledDate: null, priority: null },
      ]) },
    })).assemble({ conversation, now: new Date(observedAt) });
    expect(oversized.availability.tasks).toEqual({ state: 'unavailable', reason: 'dependency_unqualified' });
    expect(oversized.todayTasks).toEqual([]);
    expect(JSON.stringify(oversized)).not.toContain('x'.repeat(1_025));
  });
});
