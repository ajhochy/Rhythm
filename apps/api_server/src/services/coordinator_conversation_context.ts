import { Buffer } from 'node:buffer';

import {
  COORDINATOR_CONVERSATION_TIME_ZONE,
  MAX_COORDINATOR_CALENDAR_OBSERVATIONS,
  MAX_COORDINATOR_CONTEXT_TEXT_CHARS,
  MAX_COORDINATOR_MODEL_CONTEXT_BYTES,
  MAX_COORDINATOR_PROJECT_SESSION_ROOTS,
  attachOptionalSourceProof,
  optionalSourceProofOf,
  type CoordinatorCalendarEventObservation,
  type CoordinatorCalendarMirrorProjection,
  type CoordinatorProjectSessionGroup,
  type CoordinatorProjectSessionObservation,
  type CoordinatorProjectSessionsProjection,
  type CoordinatorContextAvailability,
  type CoordinatorContextCoverage,
  type CoordinatorContextRead,
  type CoordinatorContextUnavailableReason,
  type CoordinatorConversation,
  type CoordinatorConversationContextAdapters,
  type CoordinatorConversationContextProjection,
  type CoordinatorConversationContextScope,
  type CoordinatorDayflowDependencyManifest,
  type CoordinatorManualActivityReference,
  type CoordinatorReceiptContextItem,
  type CoordinatorRhythmContextItem,
  type CoordinatorScheduleContextItem,
  type CoordinatorTaskContextItem,
  type CoordinatorWorkstreamContextItem,
} from '../contracts/coordinator_conversation_contract';
import {
  NATIVE_WORKSTREAM_JOB_REASON_CODES,
  type NativeWorkstreamJobReason,
} from '../shared_agents/native_workstream_job_contract';

type SourceName = 'tasks' | 'schedules' | 'rhythms' | 'workstreams' | 'receipts' | 'manualActivity';
type Sanitized<T> = { items: T[]; invalid: boolean };

/** A bounded projection requires C2 pagination before it may grow beyond this. */
const MAX_CONTEXT_ITEMS_PER_SOURCE = 25;
const SAFE_SOURCE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const NATIVE_REASON_CODES = new Set<string>(NATIVE_WORKSTREAM_JOB_REASON_CODES);

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: COORDINATOR_CONVERSATION_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const offsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: COORDINATOR_CONVERSATION_TIME_ZONE,
  timeZoneName: 'shortOffset',
});

function unavailable<T>(reason: Exclude<CoordinatorContextUnavailableReason, 'not_configured'>): CoordinatorContextRead<T> {
  return { availability: 'unavailable', reason, complete: false, authoritative: false, items: [] };
}

function notConfigured<T>(): CoordinatorContextRead<T> {
  return { availability: 'not_configured', reason: 'not_configured', complete: false, authoritative: false, items: [] };
}

function isIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  // Source rows may omit fractional seconds; accept only an explicit UTC ISO
  // instant, never an implementation-dependent local/date-only parse.
  return !Number.isNaN(parsed.valueOf()) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value);
}

function validCoverage(value: unknown): value is CoordinatorContextCoverage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 4 || !['strategy', 'totalItems', 'selectedItems', 'maxItems'].every((key) => key in candidate)) {
    return false;
  }
  if (
    (candidate.strategy !== 'complete' && candidate.strategy !== 'bounded_relevance') ||
    !Number.isSafeInteger(candidate.totalItems) || (candidate.totalItems as number) < 0 ||
    !Number.isSafeInteger(candidate.selectedItems) || (candidate.selectedItems as number) < 0 ||
    !Number.isSafeInteger(candidate.maxItems) || (candidate.maxItems as number) < 1 ||
    (candidate.selectedItems as number) > (candidate.maxItems as number) ||
    (candidate.selectedItems as number) > (candidate.totalItems as number)
  ) return false;
  return candidate.strategy === 'complete'
    ? (candidate.selectedItems as number) === (candidate.totalItems as number)
    : (candidate.totalItems as number) > (candidate.selectedItems as number);
}

/** Reject malformed adapter replies rather than turning them into an authorized empty list. */
function validRead<T>(value: unknown): CoordinatorContextRead<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return unavailable('source_unavailable');
  const candidate = value as Record<string, unknown>;
  if (
    candidate.availability === 'available' && candidate.reason === null && candidate.complete === true &&
    candidate.authoritative === true && isIso(candidate.observedAt) &&
    typeof candidate.sourceVersion === 'string' && SAFE_SOURCE_VERSION.test(candidate.sourceVersion) &&
    (candidate.coverage === undefined || validCoverage(candidate.coverage)) &&
    Array.isArray(candidate.items)
  ) {
    return candidate as unknown as CoordinatorContextRead<T>;
  }
  // Older status-only projections can still display actual nonempty rows in
  // C1, but they never qualify context for model exposure. Critically, an
  // adapter fault cannot turn an empty list into a complete/authoritative
  // observation merely by saying "available".
  if (
    candidate.availability === 'available' && candidate.reason === null && Array.isArray(candidate.items) &&
    candidate.items.length > 0 &&
    !Object.hasOwn(candidate, 'complete') && !Object.hasOwn(candidate, 'authoritative') &&
    !Object.hasOwn(candidate, 'observedAt') && !Object.hasOwn(candidate, 'sourceVersion')
  ) {
    return {
      availability: 'available',
      reason: null,
      complete: false,
      authoritative: false,
      items: candidate.items as T[],
    };
  }
  if (
    candidate.availability === 'unavailable' && candidate.complete === false && candidate.authoritative === false &&
    ['authorization_unavailable', 'source_unavailable', 'dependency_unqualified'].includes(candidate.reason as string) &&
    Array.isArray(candidate.items) && candidate.items.length === 0
  ) {
    return candidate as unknown as CoordinatorContextRead<T>;
  }
  if (
    candidate.availability === 'not_configured' && candidate.reason === 'not_configured' &&
    candidate.complete === false && candidate.authoritative === false &&
    Array.isArray(candidate.items) && candidate.items.length === 0
  ) {
    return candidate as unknown as CoordinatorContextRead<T>;
  }
  return unavailable('source_unavailable');
}

async function readSafely<T>(
  reader: (() => Promise<CoordinatorContextRead<T>>) | undefined,
): Promise<CoordinatorContextRead<T>> {
  if (!reader) return notConfigured<T>();
  try {
    return validRead<T>(await reader());
  } catch {
    return unavailable('source_unavailable');
  }
}

/** YYYY-MM-DD according to the product's fixed America/Los_Angeles calendar. */
export function losAngelesDay(instant: Date): string {
  if (Number.isNaN(instant.valueOf())) throw new Error('Invalid instant');
  const parts = dayFormatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value;
  const year = part('year');
  const month = part('month');
  const day = part('day');
  if (!year || !month || !day) throw new Error('Unable to derive America/Los_Angeles day');
  return `${year}-${month}-${day}`;
}

/** Civil-day arithmetic avoids subtracting 24h over the LA DST boundary. */
export function shiftLosAngelesDay(day: string, amount: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isInteger(amount)) {
    throw new Error('Invalid calendar day shift');
  }
  const [year, month, date] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, date + amount));
  return shifted.toISOString().slice(0, 10);
}

function offsetMinutesAt(instant: Date): number {
  const value = offsetFormatter.formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value ?? '';
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(value);
  if (!match) throw new Error('Unable to derive America/Los_Angeles offset');
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/** Useful to callers/tests that need explicit 23h/25h DST-aware day windows. */
export function losAngelesDayWindow(day: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('Invalid calendar day');
  const startWallAsUtc = new Date(`${day}T00:00:00.000Z`);
  const start = new Date(startWallAsUtc.valueOf() - offsetMinutesAt(startWallAsUtc) * 60_000);
  const nextDay = shiftLosAngelesDay(day, 1);
  const endWallAsUtc = new Date(`${nextDay}T00:00:00.000Z`);
  const end = new Date(endWallAsUtc.valueOf() - offsetMinutesAt(endWallAsUtc) * 60_000);
  return { start, end };
}

function dayForDateOrInstant(value: string | null): string | null {
  if (value === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? null : losAngelesDay(instant);
}

function sourceAvailability<T>(read: CoordinatorContextRead<T>): {
  state: CoordinatorContextAvailability;
  reason: CoordinatorContextUnavailableReason | null;
} {
  return { state: read.availability, reason: read.reason };
}

function sourceCoverage<T>(read: CoordinatorContextRead<T>): CoordinatorContextCoverage | null {
  const coverage = (read as { coverage?: unknown }).coverage;
  return read.availability === 'available' && validCoverage(coverage) ? coverage : null;
}

function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_COORDINATOR_CONTEXT_TEXT_CHARS;
}

function boundedId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function sourceTooLarge(items: unknown[]): boolean {
  return items.length > MAX_CONTEXT_ITEMS_PER_SOURCE;
}

function safeTasks(items: CoordinatorTaskContextItem[]): Sanitized<CoordinatorTaskContextItem> {
  if (sourceTooLarge(items)) return { items: [], invalid: true };
  const result: CoordinatorTaskContextItem[] = [];
  for (const item of items) {
    if (
      !boundedId(item.id) || !boundedText(item.title) ||
      !['open', 'in_progress', 'waiting_for_reply', 'done', 'deferred'].includes(item.status) ||
      (item.dueDate !== null && typeof item.dueDate !== 'string') ||
      (item.scheduledDate !== null && typeof item.scheduledDate !== 'string') ||
      (item.priority !== null && !Number.isSafeInteger(item.priority))
    ) return { items: [], invalid: true };
    result.push({
      id: item.id,
      title: item.title,
      status: item.status,
      dueDate: item.dueDate,
      scheduledDate: item.scheduledDate,
      priority: item.priority,
    });
  }
  return { items: result, invalid: false };
}

function safeSchedules(items: CoordinatorScheduleContextItem[], ownerUserId: number): Sanitized<CoordinatorScheduleContextItem> {
  if (sourceTooLarge(items)) return { items: [], invalid: true };
  const result: CoordinatorScheduleContextItem[] = [];
  for (const item of items) {
    // An unowned/global row is out of this actor scope, not proof that the
    // source is malformed. It is simply never projected.
    if (item.createdByUserId !== ownerUserId) continue;
    if (
      !boundedId(item.id) || !boundedText(item.name) || typeof item.enabled !== 'boolean' ||
      (item.nextRunAt !== null && typeof item.nextRunAt !== 'string')
    ) return { items: [], invalid: true };
    result.push({
      id: item.id,
      name: item.name,
      enabled: item.enabled,
      nextRunAt: item.nextRunAt,
      createdByUserId: item.createdByUserId,
    });
  }
  return { items: result, invalid: false };
}

function safeRhythms(items: CoordinatorRhythmContextItem[], ownerUserId: number): Sanitized<CoordinatorRhythmContextItem> {
  if (sourceTooLarge(items)) return { items: [], invalid: true };
  const result: CoordinatorRhythmContextItem[] = [];
  for (const item of items) {
    // A collaborator-visible Rhythm is permitted by the repository, while a
    // foreign owner row without an ordinary repository authorization is not.
    if (item.ownerUserId !== null && item.ownerUserId !== ownerUserId) continue;
    if (
      !boundedId(item.id) || !boundedText(item.title) ||
      !['weekly', 'monthly', 'annual'].includes(item.frequency) || typeof item.enabled !== 'boolean' ||
      (item.ownerUserId !== null && (!Number.isSafeInteger(item.ownerUserId) || item.ownerUserId < 1))
    ) return { items: [], invalid: true };
    result.push({
      id: item.id,
      title: item.title,
      frequency: item.frequency,
      enabled: item.enabled,
      ownerUserId: item.ownerUserId,
    });
  }
  return { items: result, invalid: false };
}

function stateReason(value: unknown): CoordinatorWorkstreamContextItem['stateReason'] {
  if (value === null) return null;
  return typeof value === 'string' && NATIVE_REASON_CODES.has(value)
    ? value as NativeWorkstreamJobReason
    : 'unknown_reason';
}

function safeWorkstreams(items: CoordinatorWorkstreamContextItem[]): Sanitized<CoordinatorWorkstreamContextItem> {
  if (sourceTooLarge(items)) return { items: [], invalid: true };
  const states = new Set(['ready', 'queued', 'running', 'blocked', 'paused', 'cancelled', 'completed', 'unknown']);
  const result: CoordinatorWorkstreamContextItem[] = [];
  for (const item of items) {
    if (
      !boundedId(item.id) || !states.has(item.state) || !Number.isSafeInteger(item.revision) || item.revision < 1 ||
      (item.lastJobId !== null && !boundedId(item.lastJobId))
    ) return { items: [], invalid: true };
    result.push({
      id: item.id,
      state: item.state,
      stateReason: stateReason(item.stateReason),
      revision: item.revision,
      lastJobId: item.lastJobId,
    });
  }
  return { items: result, invalid: false };
}

function normalizeUsage(value: unknown): CoordinatorReceiptContextItem['actualUsage'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { state: 'unknown', tokens: null };
  }
  const usage = value as { state?: unknown; tokens?: unknown };
  if (usage.state === 'actual' && Number.isSafeInteger(usage.tokens) && (usage.tokens as number) >= 0) {
    return { state: 'actual', tokens: usage.tokens as number };
  }
  if (usage.state === 'overshoot' && Number.isSafeInteger(usage.tokens) && (usage.tokens as number) >= 0) {
    return { state: 'overshoot', tokens: usage.tokens as number };
  }
  // Null/negative/otherwise invalid actual totals are an explicit budget hold,
  // never an omitted receipt or an available empty budget ledger.
  return { state: 'unknown', tokens: null };
}

function safeReceipts(
  items: CoordinatorReceiptContextItem[],
  workstreamRevisions: Map<string, number>,
): Sanitized<CoordinatorReceiptContextItem> {
  if (sourceTooLarge(items)) return { items: [], invalid: true };
  const execution = new Set(['succeeded', 'failed', 'cancelled', 'unknown', 'running', 'queued']);
  const criteria = new Set(['pending', 'blocked', 'verified', 'waived']);
  const authority = new Set(['server_receipt', 'human_waiver', 'unqualified']);
  const result: CoordinatorReceiptContextItem[] = [];
  for (const item of items) {
    // An unrelated workstream is outside this owner/project context. Its
    // receipt must not become a signal here.
    if (!workstreamRevisions.has(item.workstreamId)) continue;
    if (
      !boundedId(item.id) || !boundedId(item.workstreamId) || !boundedId(item.jobId) ||
      !Number.isSafeInteger(item.workstreamRevision) || item.workstreamRevision < 1 ||
      !execution.has(item.executionState) || !criteria.has(item.criterionState) || !authority.has(item.authority) ||
      !isIso(item.recordedAt)
    ) return { items: [], invalid: true };
    result.push({
      id: item.id,
      workstreamId: item.workstreamId,
      workstreamRevision: item.workstreamRevision,
      jobId: item.jobId,
      executionState: item.executionState,
      criterionState: item.criterionState,
      authority: item.authority,
      recordedAt: item.recordedAt,
      actualUsage: normalizeUsage(item.actualUsage),
    });
  }
  return { items: result, invalid: false };
}

/** Dayflow rows are opaque identities only; no raw observation metadata crosses this seam. */
function safeManualActivity(
  items: CoordinatorManualActivityReference[],
  dependencyManifest: CoordinatorDayflowDependencyManifest | undefined,
  now: Date,
): Sanitized<CoordinatorManualActivityReference> & { manifest: CoordinatorDayflowDependencyManifest | null } {
  const invalid = (): Sanitized<CoordinatorManualActivityReference> & { manifest: null } => ({
    items: [], invalid: true, manifest: null,
  });
  if (sourceTooLarge(items) || !dependencyManifest || dependencyManifest.schemaVersion !== 1 ||
      !boundedId(dependencyManifest.namespace) || !boundedId(dependencyManifest.sourceInstance) ||
      !boundedId(dependencyManifest.consentGeneration) || !boundedId(dependencyManifest.configurationGeneration) ||
      !boundedId(dependencyManifest.sourceVersion) || !boundedId(dependencyManifest.sourceRevision) ||
      !/^[0-9a-f]{64}$/.test(dependencyManifest.sourceHash) ||
      !isIso(dependencyManifest.expiresAt) || Date.parse(dependencyManifest.expiresAt) <= now.valueOf() ||
      !isIso(dependencyManifest.observedAt) ||
      !Array.isArray(dependencyManifest.references) || dependencyManifest.references.length > MAX_CONTEXT_ITEMS_PER_SOURCE) {
    return invalid();
  }
  const manifestByCanonicalId = new Map<string, CoordinatorDayflowDependencyManifest['references'][number]>();
  for (const reference of dependencyManifest.references) {
    if (
      !boundedId(reference.canonicalId) || !boundedId(reference.canonicalVersion) ||
      !boundedId(reference.sourceRevision) || !/^[0-9a-f]{64}$/.test(reference.sourceHash) ||
      !isIso(reference.expiresAt) || Date.parse(reference.expiresAt) <= now.valueOf() ||
      manifestByCanonicalId.has(reference.canonicalId)
    ) return invalid();
    manifestByCanonicalId.set(reference.canonicalId, reference);
  }
  if (items.length !== manifestByCanonicalId.size) return invalid();
  const seen = new Set<string>();
  const result: CoordinatorManualActivityReference[] = [];
  for (const item of items) {
    const manifest = manifestByCanonicalId.get(item.canonicalId);
    if (
      !manifest || !boundedId(item.sourceId) || !boundedId(item.expectedVersion) || !isIso(item.observedAt) ||
      item.state !== 'active' || item.eligibility !== 'active' || seen.has(item.canonicalId) ||
      item.sourceId !== item.canonicalId || item.expectedVersion !== item.canonicalVersion ||
      item.namespace !== dependencyManifest.namespace || item.sourceInstance !== dependencyManifest.sourceInstance ||
      item.consentGeneration !== dependencyManifest.consentGeneration ||
      item.configurationGeneration !== dependencyManifest.configurationGeneration ||
      item.canonicalVersion !== manifest.canonicalVersion || item.sourceRevision !== manifest.sourceRevision ||
      item.sourceHash !== manifest.sourceHash || item.expiresAt !== manifest.expiresAt ||
      !boundedId(item.namespace) || !boundedId(item.sourceInstance) || !boundedId(item.sourceRevision) ||
      !/^[0-9a-f]{64}$/.test(item.sourceHash) || !isIso(item.expiresAt) ||
      Date.parse(item.expiresAt) <= now.valueOf()
    ) return invalid();
    seen.add(item.canonicalId);
    result.push({
      sourceId: item.sourceId,
      expectedVersion: item.expectedVersion,
      observedAt: item.observedAt,
      state: 'active',
      namespace: item.namespace,
      sourceInstance: item.sourceInstance,
      sourceRevision: item.sourceRevision,
      sourceHash: item.sourceHash,
      canonicalId: item.canonicalId,
      canonicalVersion: item.canonicalVersion,
      consentGeneration: item.consentGeneration,
      configurationGeneration: item.configurationGeneration,
      expiresAt: item.expiresAt,
      eligibility: 'active',
    });
  }
  return { items: result, invalid: false, manifest: dependencyManifest };
}

/** Source data labels: bounded, control characters removed. Never instructions. */
function cleanLabel(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length === 0 ? null : cleaned.slice(0, max);
}

const CALENDAR_STATES = new Set<string>([
  'observed', 'not_configured', 'account_unavailable', 'never_synced', 'invalid_sync_time',
  'preferences_corrupt', 'disabled_by_selection', 'read_failed', 'changed_during_read',
]);

function failedCalendar(state: CoordinatorCalendarMirrorProjection['state'] = 'read_failed'): CoordinatorCalendarMirrorProjection {
  return {
    source: 'owner_local_google_calendar_mirror', state, accountBinding: 'unproven', externalCompleteness: 'unknown',
    window: null, lastSuccessfulSyncAt: null, syncAgeSeconds: null, selection: 'unknown',
    selectedCount: 0, hasMore: false, totalCount: null, events: [],
  };
}

/** A malformed adapter reply becomes an explicit read failure, never an empty calendar. */
function safeCalendar(value: unknown): CoordinatorCalendarMirrorProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failedCalendar();
  const candidate = value as Partial<CoordinatorCalendarMirrorProjection>;
  if (
    candidate.source !== 'owner_local_google_calendar_mirror' || typeof candidate.state !== 'string' ||
    !CALENDAR_STATES.has(candidate.state) || !Array.isArray(candidate.events)
  ) return failedCalendar();
  const events: CoordinatorCalendarEventObservation[] = [];
  for (const event of candidate.events.slice(0, MAX_COORDINATOR_CALENDAR_OBSERVATIONS)) {
    const title = cleanLabel(event?.title, 160);
    const calendarLabel = cleanLabel(event?.calendarLabel, 80) ?? 'calendar';
    if (!event || !boundedId(event.id) || title === null || typeof event.start !== 'string' ||
        (event.end !== null && typeof event.end !== 'string') || typeof event.allDay !== 'boolean') {
      return failedCalendar();
    }
    events.push({ id: event.id, title, calendarLabel, start: event.start, end: event.end, allDay: event.allDay });
  }
  const observed = candidate.state === 'observed';
  return {
    source: 'owner_local_google_calendar_mirror',
    state: candidate.state as CoordinatorCalendarMirrorProjection['state'],
    // Fixed by contract: a reader cannot upgrade these claims.
    accountBinding: 'unproven',
    externalCompleteness: 'unknown',
    window: observed && candidate.window ? candidate.window : null,
    lastSuccessfulSyncAt: typeof candidate.lastSuccessfulSyncAt === 'string' ? candidate.lastSuccessfulSyncAt : null,
    syncAgeSeconds: Number.isSafeInteger(candidate.syncAgeSeconds) ? candidate.syncAgeSeconds as number : null,
    selection: candidate.selection === 'default_all_at_sync_time' || candidate.selection === 'explicit_ids' ||
      candidate.selection === 'explicit_none' ? candidate.selection : 'unknown',
    selectedCount: observed ? events.length : 0,
    hasMore: observed && candidate.hasMore === true,
    totalCount: null,
    events: observed ? events : [],
  };
}

const SESSION_STATUSES = new Set(['starting', 'working', 'idle', 'error', 'closed', 'resumable']);

function failedProjects(state: 'not_configured' | 'read_failed' | 'changed_during_read' = 'read_failed'): CoordinatorProjectSessionsProjection {
  return { source: 'owner_project_session_roots', state, coverage: 'unknown', selectedCount: 0, groups: [] };
}

function safeProjectSessions(value: unknown): CoordinatorProjectSessionsProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failedProjects();
  const candidate = value as Partial<CoordinatorProjectSessionsProjection>;
  if (candidate.source !== 'owner_project_session_roots' || !Array.isArray(candidate.groups) ||
      !['observed', 'not_configured', 'read_failed', 'changed_during_read'].includes(candidate.state as string)) return failedProjects();
  if (candidate.state !== 'observed') return failedProjects(candidate.state as 'not_configured' | 'read_failed' | 'changed_during_read');
  const groups: CoordinatorProjectSessionGroup[] = [];
  let selected = 0;
  for (const group of candidate.groups) {
    if (!group || !boundedId(group.projectId) || !Array.isArray(group.sessions)) return failedProjects();
    const sessions: CoordinatorProjectSessionObservation[] = [];
    for (const session of group.sessions) {
      if (selected >= MAX_COORDINATOR_PROJECT_SESSION_ROOTS) break;
      const label = cleanLabel(session?.label, 120);
      if (!session || !boundedId(session.sessionId) || label === null || !session.profile) return failedProjects();
      sessions.push({
        sessionId: session.sessionId,
        label,
        status: SESSION_STATUSES.has(session.status) ? session.status : 'unknown',
        lastActivityAt: typeof session.lastActivityAt === 'string' ? session.lastActivityAt : null,
        profile: {
          profileId: boundedId(session.profile.profileId) ? session.profile.profileId : null,
          label: cleanLabel(session.profile.label, 80),
          codingWorkflow: session.profile.codingWorkflow === true && session.profile.profileId === 'workflow-orchestrator',
          executionAvailable: session.profile.executionAvailable === true,
        },
      });
      selected += 1;
    }
    if (sessions.length > 0) {
      groups.push({ projectId: group.projectId, projectLabel: cleanLabel(group.projectLabel, 120) ?? 'project', sessions });
    }
  }
  return {
    source: 'owner_project_session_roots',
    state: 'observed',
    coverage: candidate.coverage === 'recent_window_exhausted' ? 'recent_window_exhausted' : candidate.coverage === 'recent_window_truncated' ? 'recent_window_truncated' : 'unknown',
    selectedCount: selected,
    groups,
  };
}

function unavailableWhenInvalid<T>(read: CoordinatorContextRead<T>, invalid: boolean): CoordinatorContextRead<T> {
  return invalid ? unavailable<T>('dependency_unqualified') : read;
}

function completeAuthoritative(read: {
  availability: CoordinatorContextAvailability;
  complete: boolean;
  authoritative: boolean;
}): boolean {
  return read.availability === 'available' && read.complete && read.authoritative;
}

/**
 * Bounded, fresh, source-scoped status projection. It is deliberately
 * read-only: no tasks/schedules/workstreams are changed, no engine is queried,
 * no inference is run, and unavailable is never reshaped into an empty list.
 */
export class CoordinatorConversationContextAssembler {
  constructor(private readonly adapters: CoordinatorConversationContextAdapters) {}

  async assemble(input: { conversation: CoordinatorConversation; now: Date }): Promise<CoordinatorConversationContextProjection> {
    const scope: CoordinatorConversationContextScope = {
      ownerUserId: input.conversation.ownerUserId,
      projectId: input.conversation.projectId,
      conversationId: input.conversation.id,
      now: input.now,
      sessionId: input.conversation.sessionId,
    };
    const [rawTasksRead, rawSchedulesRead, rawRhythmsRead, rawWorkstreamsRead, rawReceiptsRead] = await Promise.all([
      readSafely(() => this.adapters.tasks.read(scope)),
      readSafely(() => this.adapters.schedules.read(scope)),
      readSafely(this.adapters.rhythms ? () => this.adapters.rhythms!.read(scope) : undefined),
      readSafely(() => this.adapters.workstreams.read(scope)),
      readSafely(() => this.adapters.receipts.read(scope)),
    ]);

    const tasksSanitized = rawTasksRead.availability === 'available'
      ? safeTasks(rawTasksRead.items)
      : { items: [], invalid: false };
    const schedulesSanitized = rawSchedulesRead.availability === 'available'
      ? safeSchedules(rawSchedulesRead.items, input.conversation.ownerUserId)
      : { items: [], invalid: false };
    const rhythmsSanitized = rawRhythmsRead.availability === 'available'
      ? safeRhythms(rawRhythmsRead.items, input.conversation.ownerUserId)
      : { items: [], invalid: false };
    const workstreamsSanitized = rawWorkstreamsRead.availability === 'available'
      ? safeWorkstreams(rawWorkstreamsRead.items)
      : { items: [], invalid: false };
    const tasksRead = unavailableWhenInvalid(rawTasksRead, tasksSanitized.invalid);
    const schedulesRead = unavailableWhenInvalid(rawSchedulesRead, schedulesSanitized.invalid);
    const rhythmsRead = unavailableWhenInvalid(rawRhythmsRead, rhythmsSanitized.invalid);
    const workstreamsRead = unavailableWhenInvalid(rawWorkstreamsRead, workstreamsSanitized.invalid);
    const workstreamRevisions = new Map(workstreamsSanitized.items.map((workstream) => [workstream.id, workstream.revision]));
    const receiptsSanitized = rawReceiptsRead.availability === 'available' && workstreamsRead.availability === 'available'
      ? safeReceipts(rawReceiptsRead.items, workstreamRevisions)
      : { items: [], invalid: rawReceiptsRead.availability === 'available' };
    const receiptsRead = unavailableWhenInvalid(rawReceiptsRead, receiptsSanitized.invalid);
    // Dayflow remains optional. A configured reader must still prove a complete
    // owner/project-scoped observation; otherwise it becomes unavailable rather
    // than an authoritative empty list. Its absence never blocks core status.
    const rawManualActivityRead = await readSafely(
      this.adapters.manualActivity ? () => this.adapters.manualActivity!.read(scope) : undefined,
    );
    const manualDependencyManifest = rawManualActivityRead.availability === 'available' &&
      rawManualActivityRead.complete === true && rawManualActivityRead.authoritative === true
      ? rawManualActivityRead.dependencyManifest
      : undefined;
    const manualActivitySanitized = rawManualActivityRead.availability === 'available'
      ? safeManualActivity(rawManualActivityRead.items, manualDependencyManifest, input.now)
      : { items: [], invalid: false, manifest: null };
    const manualActivityRead = unavailableWhenInvalid(rawManualActivityRead, manualActivitySanitized.invalid);

    // Optional local observations. Sequential on purpose: the project-session
    // adapter rechecks each selected row/project/access synchronously AFTER the
    // calendar's awaited reads. A failure is an explicit state, never absence,
    // and neither joins mandatory qualification nor the model-context bytes.
    let calendarMirror: CoordinatorCalendarMirrorProjection | undefined;
    if (this.adapters.calendarMirror) {
      try {
        const raw = await this.adapters.calendarMirror.read(scope);
        calendarMirror = safeCalendar(raw);
        // The sanitized copy carries the SAME non-serialized dependency proof.
        const proof = raw && typeof raw === 'object' ? optionalSourceProofOf(raw) : undefined;
        if (proof) attachOptionalSourceProof(calendarMirror, proof);
      } catch {
        calendarMirror = failedCalendar();
      }
    }
    let projectSessions: CoordinatorProjectSessionsProjection | undefined;
    if (this.adapters.projectSessions) {
      try {
        const raw = await this.adapters.projectSessions.read(scope);
        projectSessions = safeProjectSessions(raw);
        const proof = raw && typeof raw === 'object' ? optionalSourceProofOf(raw) : undefined;
        if (proof) attachOptionalSourceProof(projectSessions, proof);
      } catch {
        projectSessions = failedProjects();
      }
    }

    const today = losAngelesDay(input.now);
    const yesterday = shiftLosAngelesDay(today, -1);
    const tasks = tasksRead.availability === 'available' ? tasksSanitized.items : [];
    const schedules = schedulesRead.availability === 'available' ? schedulesSanitized.items : [];
    const rhythms = rhythmsRead.availability === 'available' ? rhythmsSanitized.items : [];
    const workstreams = workstreamsRead.availability === 'available' ? workstreamsSanitized.items : [];
    const receipts = receiptsRead.availability === 'available' ? receiptsSanitized.items : [];
    const receiptIsCurrent = (receipt: CoordinatorReceiptContextItem) =>
      workstreamRevisions.get(receipt.workstreamId) === receipt.workstreamRevision;
    const receiptIsVerified = (receipt: CoordinatorReceiptContextItem) =>
      receiptIsCurrent(receipt) &&
      (receipt.authority === 'server_receipt' || receipt.authority === 'human_waiver') &&
      (receipt.criterionState === 'verified' || receipt.criterionState === 'waived');

    const base = {
      timeZone: COORDINATOR_CONVERSATION_TIME_ZONE,
      asOf: input.now.toISOString(),
      today,
      yesterday,
      availability: {
        tasks: sourceAvailability(tasksRead),
        schedules: sourceAvailability(schedulesRead),
        rhythms: sourceAvailability(rhythmsRead),
        workstreams: sourceAvailability(workstreamsRead),
        receipts: sourceAvailability(receiptsRead),
        manualActivity: sourceAvailability(manualActivityRead),
      },
      coverage: {
        tasks: sourceCoverage(tasksRead),
        schedules: sourceCoverage(schedulesRead),
        rhythms: sourceCoverage(rhythmsRead),
        workstreams: sourceCoverage(workstreamsRead),
        receipts: sourceCoverage(receiptsRead),
        manualActivity: sourceCoverage(manualActivityRead),
      },
      todayTasks: tasks.filter((task) =>
        task.status !== 'done' &&
        (dayForDateOrInstant(task.scheduledDate) === today || dayForDateOrInstant(task.dueDate) === today),
      ),
      waitingForReply: tasks.filter((task) => task.status === 'waiting_for_reply'),
      // `updatedAt` cannot prove a completion date and is intentionally not
      // present in the input/output shape.
      doneWithUnknownCompletionDate: tasks.filter((task) => task.status === 'done'),
      scheduledPriorities: schedules.filter((schedule) =>
        schedule.enabled && dayForDateOrInstant(schedule.nextRunAt) === today,
      ),
      activeRhythms: rhythms.filter((rhythm) => rhythm.enabled),
      activeWorkstreams: workstreams.filter((workstream) =>
        ['queued', 'running', 'blocked', 'unknown'].includes(workstream.state),
      ),
      executionSucceededGoalUnverified: receipts.filter((receipt) =>
        receipt.executionState === 'succeeded' && !receiptIsVerified(receipt),
      ).map(({ id, workstreamId, jobId, recordedAt, actualUsage }) => ({ id, workstreamId, jobId, recordedAt, actualUsage })),
      staleExecutions: receipts.filter((receipt) => !receiptIsCurrent(receipt)).map(({
        id, workstreamId, workstreamRevision, jobId, executionState, criterionState, recordedAt, actualUsage,
      }) => ({ id, workstreamId, workstreamRevision, jobId, executionState, criterionState, recordedAt, actualUsage })),
      verifiedYesterday: receipts.filter((receipt) =>
        receiptIsVerified(receipt) && dayForDateOrInstant(receipt.recordedAt) === yesterday,
      ).map(({ id, workstreamId, jobId, criterionState, recordedAt }) => ({ id, workstreamId, jobId, criterionState, recordedAt })),
      usageHolds: receipts.filter((receipt) =>
        receipt.actualUsage.state === 'unknown' || receipt.actualUsage.state === 'overshoot',
      ).map(({ id, workstreamId, jobId, actualUsage }) => ({ id, workstreamId, jobId, actualUsage })),
      receipts,
      manualActivity: manualActivityRead.availability === 'available'
        ? manualActivitySanitized.items
        : [] as CoordinatorManualActivityReference[],
      manualActivityDependency: manualActivityRead.availability === 'available'
        ? manualActivitySanitized.manifest
        : null,
    };
    const bytes = Buffer.byteLength(JSON.stringify(base), 'utf8');
    const mandatoryModelContextIsQualified = [tasksRead, schedulesRead, rhythmsRead, workstreamsRead, receiptsRead]
      .every((read) => completeAuthoritative(read));
    return {
      ...base,
      ...(calendarMirror ? { calendarMirror } : {}),
      ...(projectSessions ? { projectSessions } : {}),
      modelContext: !mandatoryModelContextIsQualified
        ? { kind: 'blocked', reason: 'context_unqualified', bytes }
        : bytes <= MAX_COORDINATOR_MODEL_CONTEXT_BYTES
          ? { kind: 'ready', bytes }
          : { kind: 'blocked', reason: 'context_too_large', bytes },
    };
  }
}

/** Explicit source names for review tests and future C2 adapter wiring. */
export const coordinatorConversationContextSources: readonly SourceName[] = [
  'tasks', 'schedules', 'rhythms', 'workstreams', 'receipts', 'manualActivity',
];
