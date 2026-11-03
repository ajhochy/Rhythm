import { createHash } from 'node:crypto';

import {
  COORDINATOR_CALENDAR_WINDOW_DAYS,
  COORDINATOR_CONVERSATION_TIME_ZONE,
  MAX_COORDINATOR_CALENDAR_OBSERVATIONS,
  MAX_COORDINATOR_PROJECT_SESSION_PAGES,
  MAX_COORDINATOR_PROJECT_SESSION_ROOTS,
  attachOptionalSourceProof,
  type CoordinatorCalendarMirrorProjection,
  type CoordinatorContextRead,
  type CoordinatorContextCoverage,
  type CoordinatorConversationContextAdapters,
  type CoordinatorConversationContextScope,
  type CoordinatorProjectSessionGroup,
  type CoordinatorProjectSessionObservation,
  type CoordinatorProjectSessionsProjection,
  type CoordinatorReceiptContextItem,
} from '../contracts/coordinator_conversation_contract';
import { getDb } from '../database/db';
import type { AgentSession } from '../models/agent_session';
import type { CalendarShadowEventsRepository } from '../repositories/calendar_shadow_events_repository';
import type { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import type { IntegrationAccount } from '../models/integration_account';
import type { SessionHistoryPage, SessionHistoryQuery } from '../repositories/agent_sessions_repository';
import { losAngelesDay, losAngelesDayWindow, shiftLosAngelesDay } from './coordinator_conversation_context';
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

/** Local-only calendar sources. Nothing here may contact a provider, refresh a token or write. */
export interface CoordinatorCalendarSources {
  /**
   * The synchronous local read (same SQLite row) is what the final exposure
   * proof uses; without it the proof cannot run and observations are withheld.
   */
  accounts: Pick<IntegrationAccountsRepository, 'findByProviderAsync'> & Partial<Pick<IntegrationAccountsRepository, 'findByProvider'>>;
  events: Pick<CalendarShadowEventsRepository, 'findLocalWindowObservations'>;
  /**
   * Raw stored selection JSON for the exact owner, or null when no row exists.
   * The preferences repository collapses a corrupt value to "missing", so this
   * exact read distinguishes them without editing that repository.
   */
  readRawSelection?: (ownerUserId: number) => string | null;
}

export interface CoordinatorProjectSessionSources {
  listPage: (query: SessionHistoryQuery) => SessionHistoryPage;
  projects: { findById(id: string): { id: string; name: string; archivedAt: string | null } | null };
  /** The existing server owner/project access proof; never project-catalog presence. */
  ownerProjectAccess: (ownerUserId: number, projectId: string) => boolean;
  profiles: { getById(id: string): { id: string; label: string; enabled: boolean; isAgent?: boolean; locked?: boolean } | null };
}

const CALENDAR_SELECTION_KEY = 'selected_calendar_ids';
const GOOGLE_PROVIDER = 'google_calendar';
const CODING_WORKFLOW_PROFILE_ID = 'workflow-orchestrator';

function defaultRawSelection(ownerUserId: number): string | null {
  const row = getDb()
    .prepare('SELECT json_value FROM integration_preferences WHERE owner_id = ? AND provider = ? AND key = ? LIMIT 1')
    .get(ownerUserId, GOOGLE_PROVIDER, CALENDAR_SELECTION_KEY) as { json_value: string } | undefined;
  return row ? row.json_value : null;
}

/** An account email must never be a label: primary/opaque forms only. */
function calendarLabel(calendarId: string): string {
  if (calendarId === 'primary') return 'primary calendar';
  if (calendarId.includes('@')) return `calendar-${createHash('sha256').update(calendarId).digest('hex').slice(0, 6)}`;
  return calendarId.slice(0, 80);
}

function emptyCalendar(state: CoordinatorCalendarMirrorProjection['state']): CoordinatorCalendarMirrorProjection {
  return {
    source: 'owner_local_google_calendar_mirror', state, accountBinding: 'unproven', externalCompleteness: 'unknown',
    window: null, lastSuccessfulSyncAt: null, syncAgeSeconds: null, selection: 'unknown',
    selectedCount: 0, hasMore: false, totalCount: null, events: [],
  };
}

function createCalendarMirrorReader(sources: CoordinatorCalendarSources) {
  const rawSelection = sources.readRawSelection ?? defaultRawSelection;
  // Account identity/status/lastSyncedAt AND the raw selection form the recheck key.
  const keyOf = (account: IntegrationAccount | null, raw: string | null): string => account
    ? [account.id, account.ownerId, account.externalAccountId, account.status, account.lastSyncedAt, raw].join('\u0001')
    : `none\u0001${raw}`;
  const readSources = async (ownerUserId: number) => {
    const account = await sources.accounts.findByProviderAsync('google_calendar', ownerUserId);
    const raw = rawSelection(ownerUserId);
    return { account, raw, key: keyOf(account, raw) };
  };
  return async (scope: CoordinatorConversationContextScope): Promise<CoordinatorCalendarMirrorProjection> => {
    const owner = scope.ownerUserId;
    if (!Number.isSafeInteger(owner) || owner <= 0) return emptyCalendar('read_failed');
    try {
      const first = await readSources(owner);
      // No account for THIS owner: a leftover mirror is never shown as current.
      if (!first.account || first.account.ownerId !== owner) return emptyCalendar('not_configured');
      if (first.account.status !== 'connected') return emptyCalendar('account_unavailable');
      const syncAt = first.account.lastSyncedAt;
      if (syncAt === null) return emptyCalendar('never_synced');
      const syncMs = Date.parse(syncAt);
      // A sync time after "now" is invalid: no grace and no clamp to a healthy age 0.
      if (Number.isNaN(syncMs) || syncMs > scope.now.valueOf()) {
        return emptyCalendar('invalid_sync_time');
      }
      const base = {
        lastSuccessfulSyncAt: new Date(syncMs).toISOString(),
        syncAgeSeconds: Math.floor((scope.now.valueOf() - syncMs) / 1000),
      };
      let calendarIds: string[] | null = null;
      let selection: CoordinatorCalendarMirrorProjection['selection'] = 'default_all_at_sync_time';
      if (first.raw !== null) {
        let parsed: unknown;
        try { parsed = JSON.parse(first.raw); } catch { parsed = undefined; }
        const ids = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as { selectedCalendarIds?: unknown }).selectedCalendarIds
          : undefined;
        if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
          return { ...emptyCalendar('preferences_corrupt'), ...base };
        }
        calendarIds = ids as string[];
        selection = calendarIds.length === 0 ? 'explicit_none' : 'explicit_ids';
        // Explicit empty selection is "disabled by selection", never "no events".
        if (calendarIds.length === 0) return { ...emptyCalendar('disabled_by_selection'), ...base, selection };
      }
      const startDay = losAngelesDay(scope.now);
      const endDayExclusive = shiftLosAngelesDay(startDay, COORDINATOR_CALENDAR_WINDOW_DAYS);
      const windowInput = {
        ownerId: owner,
        startMs: losAngelesDayWindow(startDay).start.valueOf(),
        endMs: losAngelesDayWindow(endDayExclusive).start.valueOf(),
        startDay,
        endDayExclusive,
        calendarIds,
        limit: MAX_COORDINATOR_CALENDAR_OBSERVATIONS,
        dayStartMs: (day: string) => losAngelesDayWindow(day).start.valueOf(),
      };
      const result = sources.events.findLocalWindowObservations(windowInput);
      const observedRows = JSON.stringify(result.events.map((event) => [event.id, event.title, event.startAt, event.endAt, event.isAllDay, event.calendarId]));
      // Awaited re-read: any change to the account or raw selection while the
      // mirror was read withholds the prepared projection entirely.
      const second = await readSources(owner);
      if (second.key !== first.key) return { ...emptyCalendar('changed_during_read') };
      const projection: CoordinatorCalendarMirrorProjection = {
        source: 'owner_local_google_calendar_mirror',
        state: 'observed',
        accountBinding: 'unproven',
        externalCompleteness: 'unknown',
        window: { startDay, endDayExclusive, timeZone: COORDINATOR_CONVERSATION_TIME_ZONE },
        ...base,
        selection,
        selectedCount: result.events.length,
        // A capped scan can hide rows: report "more" rather than a clean window.
        hasMore: result.hasMore || result.scanLimited,
        totalCount: null,
        events: result.events.map((event) => ({
          id: event.id,
          // Source data, never instructions: control characters removed, bounded.
          title: event.title.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || '(untitled)',
          calendarLabel: calendarLabel(event.calendarId),
          start: event.startAt,
          end: event.endAt,
          allDay: event.isAllDay,
        })),
      };
      // Final-exposure proof (non-serialized, synchronous, same local reads and
      // bounds): the exact account identity/status/lastSyncedAt, the raw
      // selection and the selected rows must all still match. Without a
      // synchronous account read the proof cannot run, which means "withhold".
      return attachOptionalSourceProof(projection, () => {
        if (!sources.accounts.findByProvider) return false;
        const account = sources.accounts.findByProvider('google_calendar', owner);
        if (keyOf(account, rawSelection(owner)) !== first.key) return false;
        const again = sources.events.findLocalWindowObservations(windowInput);
        return again.hasMore === result.hasMore && again.scanLimited === result.scanLimited &&
          JSON.stringify(again.events.map((event) => [event.id, event.title, event.startAt, event.endAt, event.isAllDay, event.calendarId])) === observedRows;
      });
    } catch {
      return emptyCalendar('read_failed');
    }
  };
}

function createProjectSessionsReader(sources: CoordinatorProjectSessionSources) {
  return async (scope: CoordinatorConversationContextScope): Promise<CoordinatorProjectSessionsProjection> => {
    const owner = scope.ownerUserId;
    const failed: CoordinatorProjectSessionsProjection = {
      source: 'owner_project_session_roots', state: 'read_failed', coverage: 'unknown', selectedCount: 0, groups: [],
    };
    if (!Number.isSafeInteger(owner) || owner <= 0) return failed;
    try {
      const selected: AgentSession[] = [];
      let truncated = false;
      let exhausted = false;
      let cursor: string | undefined;
      scan: for (let pageNumber = 0; pageNumber < MAX_COORDINATOR_PROJECT_SESSION_PAGES; pageNumber += 1) {
        let page: SessionHistoryPage;
        try {
          // Existing pager: chats, archives off, no search/project selector. It
          // snapshots matching ids internally, so this is neither bounded SQL
          // nor a complete count; the budget below is the only bound claimed.
          page = sources.listPage({ ownerUserId: owner, scope: 'chats', limit: 100, ...(cursor ? { cursor } : {}) });
        } catch {
          // An expired/invalid cursor mid-scan is partial, not authoritative.
          if (pageNumber === 0) return failed;
          truncated = true;
          break;
        }
        for (const row of page.sessions) {
          // The pager's owner predicate also admits NULL-owner legacy rows.
          if (row.ownerUserId !== owner || typeof row.projectId !== 'string' || row.projectId.length === 0) continue;
          if (row.parentSessionId !== null || row.isSystem || row.archivedAt !== null || row.id === scope.sessionId) continue;
          if (selected.length >= MAX_COORDINATOR_PROJECT_SESSION_ROOTS) { truncated = true; break scan; }
          const project = sources.projects.findById(row.projectId);
          if (!project || project.archivedAt !== null || !sources.ownerProjectAccess(owner, row.projectId)) continue;
          selected.push(row);
        }
        if (!page.pageInfo.hasMore) { exhausted = true; break; }
        cursor = page.pageInfo.nextCursor ?? undefined;
        if (!cursor) { truncated = true; break; }
        if (pageNumber === MAX_COORDINATOR_PROJECT_SESSION_PAGES - 1) truncated = true;
      }
      // Exposure recheck (same tick, after any calendar awaits): current
      // project, archive state and owner access for every selected row.
      const groups = new Map<string, CoordinatorProjectSessionGroup>();
      let count = 0;
      for (const row of selected) {
        const project = sources.projects.findById(row.projectId!);
        if (!project || project.archivedAt !== null || !sources.ownerProjectAccess(owner, row.projectId!)) continue;
        const profile = row.profileId ? sources.profiles.getById(row.profileId) : null;
        const observation: CoordinatorProjectSessionObservation = {
          sessionId: row.id,
          label: row.name,
          status: row.status,
          lastActivityAt: row.lastActivityAt ?? row.updatedAt ?? null,
          profile: {
            profileId: row.profileId ?? null,
            label: profile?.label ?? null,
            codingWorkflow: row.profileId === CODING_WORKFLOW_PROFILE_ID,
            executionAvailable: Boolean(profile && profile.enabled && profile.locked !== true && profile.isAgent !== false),
          },
        };
        const group = groups.get(project.id) ?? { projectId: project.id, projectLabel: project.name, sessions: [] };
        group.sessions.push(observation);
        groups.set(project.id, group);
        count += 1;
      }
      const projection: CoordinatorProjectSessionsProjection = {
        source: 'owner_project_session_roots',
        state: 'observed',
        coverage: truncated || !exhausted ? 'recent_window_truncated' : 'recent_window_exhausted',
        selectedCount: count,
        groups: [...groups.values()],
      };
      // Final-exposure proof: every selected session's exact owner/project/
      // root/archive/status/profile state and its project's current archive
      // state and access, re-read synchronously from the same local sources
      // (no pager scan, no provider). Any difference withholds this source.
      const snapshot = [...groups.values()].flatMap((group) => group.sessions.map((session) => ({
        group, session,
        raw: selected.find((row) => row.id === session.sessionId)!,
      })));
      return attachOptionalSourceProof(projection, () => {
        for (const { group, session, raw } of snapshot) {
          const row = readSessionRow(session.sessionId);
          if (
            !row || row.owner_user_id !== owner || row.project_id !== group.projectId || row.parent_session_id !== null ||
            row.is_system !== 0 || row.category !== 'chat' || row.archived_at !== null ||
            row.status !== session.status || row.name !== raw.name ||
            (row.last_activity_at ?? row.updated_at ?? null) !== session.lastActivityAt ||
            (row.profile_id ?? null) !== session.profile.profileId
          ) return false;
          const project = sources.projects.findById(group.projectId);
          if (!project || project.archivedAt !== null || project.name !== group.projectLabel ||
              !sources.ownerProjectAccess(owner, group.projectId)) return false;
          const profile = session.profile.profileId ? sources.profiles.getById(session.profile.profileId) : null;
          if ((profile?.label ?? null) !== session.profile.label ||
              Boolean(profile && profile.enabled && profile.locked !== true && profile.isAgent !== false) !== session.profile.executionAvailable) return false;
        }
        return true;
      });
    } catch {
      return failed;
    }
  };
}

interface SessionProofRow {
  owner_user_id: number | null;
  project_id: string | null;
  parent_session_id: string | null;
  is_system: number;
  category: string;
  archived_at: string | null;
  status: string;
  name: string;
  last_activity_at: string | null;
  updated_at: string | null;
  profile_id: string | null;
}

/** One exact local row by id; the existing session table, read-only. */
function readSessionRow(sessionId: string): SessionProofRow | undefined {
  return getDb().prepare(
    `SELECT owner_user_id, project_id, parent_session_id, is_system, category, archived_at, status, name,
            last_activity_at, updated_at, profile_id
       FROM agent_sessions WHERE id = ?`,
  ).get(sessionId) as SessionProofRow | undefined;
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
  /** Optional, composed only by the server; absent means the source is simply not configured. */
  calendar?: CoordinatorCalendarSources;
  projectSessions?: CoordinatorProjectSessionSources;
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
    calendarMirror: input.calendar ? { read: createCalendarMirrorReader(input.calendar) } : undefined,
    projectSessions: input.projectSessions ? { read: createProjectSessionsReader(input.projectSessions) } : undefined,
  };
}
