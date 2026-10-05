import type {
  CoordinatorContextRead,
  CoordinatorContextCoverage,
  CoordinatorConversationContextAdapters,
  CoordinatorConversationContextScope,
  CoordinatorReceiptContextItem,
} from '../contracts/coordinator_conversation_contract';
import { losAngelesDay } from './coordinator_conversation_context';
import { AgentScheduledTasksRepository } from '../repositories/agent_scheduled_tasks_repository';
import { AgentWorkstreamsRepository } from '../repositories/agent_workstreams_repository';
import { RecurringTaskRulesRepository } from '../repositories/recurring_task_rules_repository';
import { TasksRepository } from '../repositories/tasks_repository';
import { AgentBridgeJobsRepository, type AgentBridgeJobRow } from '../shared_agents/delegation_jobs_repository';
import type { AgentWorkstream } from '../models/agent_workstream';
import type { DayflowCoordinatorReferenceAdapter } from './dayflow_coordinator_reference_adapter';

const SOURCE_VERSION = 'r16-c2-r15-local-v1';
const MAX_ITEMS = 25;
const MAX_WORKSTREAM_SCAN = 500;
const MAX_RECEIPT_SCAN = 1_000;
const WORKSTREAM_PAGE_SIZE = 100;

function coverage(totalItems: number, selectedItems: number): CoordinatorContextCoverage {
  return {
    strategy: totalItems === selectedItems ? 'complete' : 'bounded_relevance',
    totalItems,
    selectedItems,
    maxItems: MAX_ITEMS,
  };
}

function available<T>(items: T[], now: Date, selectedCoverage?: CoordinatorContextCoverage): CoordinatorContextRead<T> {
  return {
    availability: 'available',
    reason: null,
    complete: true,
    authoritative: true,
    observedAt: now.toISOString(),
    sourceVersion: SOURCE_VERSION,
    ...(selectedCoverage ? { coverage: selectedCoverage } : {}),
    items,
  };
}

function unavailable<T>(): CoordinatorContextRead<T> {
  return { availability: 'unavailable', reason: 'source_unavailable', complete: false, authoritative: false, items: [] };
}

function selectRelevant<T>(items: T[], compare: (left: T, right: T) => number): {
  items: T[];
  coverage: CoordinatorContextCoverage;
} {
  const selected = [...items].sort(compare).slice(0, MAX_ITEMS);
  return { items: selected, coverage: coverage(items.length, selected.length) };
}

function taskRank(
  task: { id: string; status: string; dueDate: string | null; scheduledDate: string | null; priority: number | null },
  today: string,
): readonly [number, number, string, string] {
  const todayRelevant = task.dueDate === today || task.scheduledDate === today;
  const state = todayRelevant ? 0
    : task.status === 'waiting_for_reply' ? 1
      : task.status === 'in_progress' ? 2
        : task.status === 'open' ? 3
          : task.status === 'deferred' ? 4
            : 5;
  return [state, task.priority ?? Number.MAX_SAFE_INTEGER, task.scheduledDate ?? task.dueDate ?? '9999-12-31', task.id];
}

function compareTuple(left: readonly (string | number)[], right: readonly (string | number)[]): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function usage(row: AgentBridgeJobRow): CoordinatorReceiptContextItem['actualUsage'] {
  if (!row.native_usage_json) return { state: 'unknown', tokens: null };
  try {
    const value = JSON.parse(row.native_usage_json) as Record<string, unknown>;
    const totalTokens = value.totalTokens;
    if (value.status !== 'actual' || !Number.isSafeInteger(totalTokens) || (totalTokens as number) < 0) {
      return { state: 'unknown', tokens: null };
    }
    return { state: value.overshoot === true ? 'overshoot' : 'actual', tokens: totalTokens as number };
  } catch {
    return { state: 'unknown', tokens: null };
  }
}

function executionState(row: AgentBridgeJobRow): CoordinatorReceiptContextItem['executionState'] {
  if (row.state === 'claimed' || row.state === 'running') return 'running';
  if (row.state === 'queued') return 'queued';
  if (row.state === 'succeeded' || row.state === 'failed' || row.state === 'cancelled' || row.state === 'unknown') return row.state;
  return 'unknown';
}

function baseReceipt(row: AgentBridgeJobRow): CoordinatorReceiptContextItem | null {
  if (!row.workstream_id || !row.workstream_revision || !row.updated_at) return null;
  const recordedAt = row.terminal_at ?? row.updated_at;
  if (Number.isNaN(Date.parse(recordedAt))) return null;
  return {
    id: row.id,
    workstreamId: row.workstream_id,
    workstreamRevision: row.workstream_revision,
    jobId: row.id,
    executionState: executionState(row),
    // A completed worker is never a verified conversation goal. Criterion
    // application/waiver remains the existing explicit human/server path.
    criterionState: 'pending',
    authority: 'unqualified',
    recordedAt,
    actualUsage: usage(row),
  };
}

function record(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function strictIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function authoritativeReceipts(row: AgentBridgeJobRow, workstream: AgentWorkstream): CoordinatorReceiptContextItem[] | null {
  if (row.state !== 'succeeded' || !row.workstream_revision || !row.updated_at) return null;
  const application = record(row.native_application_json);
  if (!application || application.schemaVersion !== 1 || application.status !== 'applied' ||
      application.workstreamRevision !== row.workstream_revision || !strictIso(application.appliedAt) ||
      !Array.isArray(application.criteria) || application.criteria.length < 1 || application.criteria.length > 100) return null;
  const authority = application.authority === 'authenticated_user_waiver'
    ? 'human_waiver' as const
    : application.authority === 'server_resolved_memory_vault_evidence'
      ? 'server_receipt' as const
      : null;
  if (!authority) return null;
  const checkpoint = new Map(workstream.checkpoint.criteria.map((criterion) => [criterion.id, criterion]));
  const ids = new Set<string>();
  const result: CoordinatorReceiptContextItem[] = [];
  for (const candidate of application.criteria) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.criterionId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(item.criterionId) ||
      (item.criterionStatus !== 'verified' && item.criterionStatus !== 'waived') ||
      typeof item.receiptId !== 'string' || item.receiptId.length < 1 || item.receiptId.length > 512 ||
      ids.has(item.criterionId)
    ) return null;
    const checkpointCriterion = checkpoint.get(item.criterionId);
    if (
      !checkpointCriterion || checkpointCriterion.status !== item.criterionStatus ||
      checkpointCriterion.receiptId !== item.receiptId ||
      (authority === 'human_waiver' && item.criterionStatus !== 'waived') ||
      (authority === 'server_receipt' && item.criterionStatus !== 'verified')
    ) return null;
    ids.add(item.criterionId);
    result.push({
      id: `${row.id}:${item.criterionId}`,
      workstreamId: workstream.id,
      // Authoritative application increments the durable workstream revision;
      // report that current revision, not the worker's pre-application one.
      workstreamRevision: workstream.revision,
      jobId: row.id,
      executionState: 'succeeded',
      criterionState: item.criterionStatus,
      authority,
      recordedAt: application.appliedAt,
      actualUsage: usage(row),
    });
  }
  return result;
}

function receiptsForWorkstream(row: AgentBridgeJobRow, workstream: AgentWorkstream): CoordinatorReceiptContextItem[] {
  return authoritativeReceipts(row, workstream) ?? [baseReceipt(row)].filter((item): item is CoordinatorReceiptContextItem => item !== null);
}

/**
 * Existing local repositories projected into the bounded C1 context contract.
 * These adapters create no jobs, schedules, captures, activity imports, or
 * model prompts. Every caught repository fault remains unavailable rather than
 * being represented as a complete empty list.
 */
export function createCoordinatorConversationContextAdapters(input: {
  dayflow?: DayflowCoordinatorReferenceAdapter;
  tasks?: TasksRepository;
  schedules?: AgentScheduledTasksRepository;
  rhythms?: RecurringTaskRulesRepository;
  workstreams?: AgentWorkstreamsRepository;
  jobs?: AgentBridgeJobsRepository;
} = {}): CoordinatorConversationContextAdapters {
  const tasks = input.tasks ?? new TasksRepository();
  const schedules = input.schedules ?? new AgentScheduledTasksRepository();
  const rhythms = input.rhythms ?? new RecurringTaskRulesRepository();
  const workstreams = input.workstreams ?? new AgentWorkstreamsRepository();
  const jobs = input.jobs ?? new AgentBridgeJobsRepository();
  /**
   * The durable repository has keyset pagination. Read it to an explicit
   * bounded completion boundary before selecting status rows; a partial scan
   * is unavailable, never a fabricated complete empty or arbitrary first page.
   */
  const scopedWorkstreams = (scope: CoordinatorConversationContextScope): AgentWorkstream[] | null => {
    const rows: AgentWorkstream[] = [];
    let after: string | undefined;
    for (;;) {
      if (rows.length >= MAX_WORKSTREAM_SCAN) return null;
      const page = workstreams.list(
        scope.ownerUserId,
        scope.projectId,
        Math.min(WORKSTREAM_PAGE_SIZE, MAX_WORKSTREAM_SCAN - rows.length),
        after,
      );
      if (page.length === 0) return rows;
      const next = page[page.length - 1]?.id;
      if (!next || (after !== undefined && next <= after)) return null;
      rows.push(...page);
      if (page.length < WORKSTREAM_PAGE_SIZE) return rows;
      after = next;
    }
  };

  return {
    tasks: {
      read: async (scope) => {
        try {
          const rows = await tasks.findAllAsync(scope.ownerUserId);
          const projected = rows.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            dueDate: task.dueDate,
            scheduledDate: task.scheduledDate,
            priority: task.priority,
          }));
          const selected = selectRelevant(projected, (left, right) =>
            compareTuple(taskRank(left, losAngelesDay(scope.now)), taskRank(right, losAngelesDay(scope.now))),
          );
          return available(selected.items, scope.now, selected.coverage);
        } catch {
          return unavailable();
        }
      },
    },
    schedules: {
      read: async (scope) => {
        try {
          const rows = await schedules.listForOwnerAsync(scope.ownerUserId);
          // listForOwnerAsync includes compatibility NULL/global rows. They are
          // not qualified for this user and must never enter the projection.
          const owned = rows.filter((row) => row.createdByUserId === scope.ownerUserId);
          const projected = owned.map((row) => ({
            id: row.id,
            name: row.name,
            enabled: row.enabled,
            nextRunAt: row.nextRunAt,
            createdByUserId: row.createdByUserId!,
          }));
          const selected = selectRelevant(projected, (left, right) =>
            compareTuple(
              [left.enabled ? 0 : 1, left.nextRunAt ?? '9999-12-31T23:59:59.999Z', left.id],
              [right.enabled ? 0 : 1, right.nextRunAt ?? '9999-12-31T23:59:59.999Z', right.id],
            ),
          );
          return available(selected.items, scope.now, selected.coverage);
        } catch {
          return unavailable();
        }
      },
    },
    rhythms: {
      read: async (scope) => {
        try {
          const rows = await rhythms.findAllAsync(scope.ownerUserId);
          const projected = rows.map((row) => ({
            id: row.id,
            title: row.title,
            frequency: row.frequency,
            enabled: row.enabled,
            ownerUserId: row.ownerId,
          }));
          const selected = selectRelevant(projected, (left, right) =>
            compareTuple([left.enabled ? 0 : 1, left.id], [right.enabled ? 0 : 1, right.id]),
          );
          return available(selected.items, scope.now, selected.coverage);
        } catch {
          return unavailable();
        }
      },
    },
    workstreams: {
      read: async (scope) => {
        try {
          const rows = scopedWorkstreams(scope);
          if (rows === null) return unavailable();
          const projected = rows.map((row) => ({
            id: row.id,
            state: row.state,
            // The context contract itself whitelists native reason codes; an
            // arbitrary persisted/free-text value must not cross this seam.
            stateReason: row.stateReason === null ? null : 'unknown_reason' as const,
            revision: row.revision,
            lastJobId: row.lastJobId,
          }));
          const rank = (state: string): number =>
            state === 'running' ? 0 : state === 'queued' ? 1 : state === 'blocked' ? 2 :
              state === 'unknown' ? 3 : state === 'paused' ? 4 : state === 'ready' ? 5 : 6;
          const selected = selectRelevant(projected, (left, right) =>
            compareTuple([rank(left.state), left.id], [rank(right.state), right.id]),
          );
          return available(selected.items, scope.now, selected.coverage);
        } catch {
          return unavailable();
        }
      },
    },
    receipts: {
      read: async (scope) => {
        try {
          const rows = scopedWorkstreams(scope);
          if (rows === null) return unavailable();
          const receipts = rows.flatMap((workstream) =>
            jobs.listNativeForWorkstream({
              localUserId: scope.ownerUserId,
              workstreamId: workstream.id,
            }).flatMap((row) => receiptsForWorkstream(row, workstream)),
          );
          if (receipts.length > MAX_RECEIPT_SCAN) return unavailable();
          const rank = (state: CoordinatorReceiptContextItem['executionState']): number =>
            state === 'unknown' ? 0 : state === 'running' ? 1 : state === 'queued' ? 2 :
              state === 'succeeded' ? 3 : state === 'failed' ? 4 : 5;
          const selected = selectRelevant(receipts, (left, right) =>
            compareTuple([rank(left.executionState), left.recordedAt, left.id], [rank(right.executionState), right.recordedAt, right.id]),
          );
          return available(selected.items, scope.now, selected.coverage);
        } catch {
          return unavailable();
        }
      },
    },
    manualActivity: input.dayflow ? { read: (scope) => input.dayflow!.read(scope) } : undefined,
  };
}
