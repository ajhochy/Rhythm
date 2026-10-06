/**
 * Optional local-current-context sources: calendarMirror and projectSessions.
 * Real migrated SQLite, real repositories, real existing session pager, real
 * runtime adapters/assembler and the real CoordinatorConversationService seams.
 * No provider, SDK, engine or network is contacted (fetch is asserted unused).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

import type { CoordinatorConversationContextScope } from '../contracts/coordinator_conversation_contract';
import { getDb, setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { listPage, AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CalendarShadowEventsRepository } from '../repositories/calendar_shadow_events_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { IntegrationAccountsRepository } from '../repositories/integration_accounts_repository';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import { createCoordinatorConversationContextAdapters } from '../services/coordinator_conversation_runtime_adapters';
import { CoordinatorConversationModelStatusService } from '../services/coordinator_conversation_model_status_service';
import { CoordinatorConversationService } from '../services/coordinator_conversation_service';

const OWNER = 7;
const NOW = new Date('2026-10-06T19:00:00.000Z'); // 12:00 PDT, Oct 6
const SYNC = '2026-10-06T18:00:00.000Z';
let db: Database.Database;
let denied: Set<string>;
let clock: { value: Date };
let fetchSpy: ReturnType<typeof vi.fn>;

const events = new CalendarShadowEventsRepository();
const scope = (over: Partial<CoordinatorConversationContextScope> = {}): CoordinatorConversationContextScope => ({
  ownerUserId: OWNER, projectId: 'proj-main', conversationId: 'conv-1', now: clock.value, sessionId: 'root', ...over,
});

function account(over: Record<string, unknown> = {}): void {
  db.prepare(`INSERT INTO integration_accounts
    (id, owner_id, provider, external_account_id, email, status, last_synced_at, created_at, updated_at)
    VALUES (@id, @owner, 'google_calendar', @ext, 'someone@example.test', @status, @sync, @now, @now)`).run({
    id: 'acct-1', owner: OWNER, ext: 'google-ext-1', status: 'connected', sync: SYNC, now: SYNC, ...over,
  });
}
function selection(json: string, owner = OWNER): void {
  db.prepare(`INSERT OR REPLACE INTO integration_preferences (owner_id, provider, key, json_value)
    VALUES (?, 'google_calendar', 'selected_calendar_ids', ?)`).run(owner, json);
}
type Ev = { externalId: string; title: string; startAt: string; endAt: string | null; isAllDay?: boolean; calendarId?: string; description?: string | null; location?: string | null };
function mirror(rows: Ev[], owner = OWNER): void {
  events.replaceForOwner(owner, rows.map((row) => ({
    provider: 'google_calendar' as const, externalId: row.externalId, calendarId: row.calendarId ?? 'primary', sourceName: 'someone@example.test',
    title: row.title, description: row.description ?? null, location: row.location ?? null,
    startAt: row.startAt, endAt: row.endAt, isAllDay: row.isAllDay ?? false,
  })));
}
function chat(id: string, over: Record<string, unknown> = {}): void {
  db.prepare(`INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, category, is_system, owner_user_id, project_id, profile_id,
      last_activity_at, last_preview, parent_session_id, archived_at)
    VALUES (@id, @name, 'librarian', @status, '/secret/cwd/path', 'chat', 0, @owner, @project, @profile, @activity, 'SECRET PREVIEW BODY', @parent, @archived)`).run({
    id, name: `session ${id}`, status: 'idle', owner: OWNER, project: 'proj-a', profile: null,
    activity: '2026-10-06T10:00:00.000Z', parent: null, archived: null, ...over,
  });
}
function project(id: string, over: Record<string, unknown> = {}): void {
  db.prepare(`INSERT INTO projects (id, name, cwd, created_at, archived_at) VALUES (@id, @name, '/secret/project/cwd', @now, @archived)`)
    .run({ id, name: `Project ${id}`, now: NOW.toISOString(), archived: null, ...over });
}

function adapters(over: { selectionRead?: (owner: number) => string | null } = {}) {
  return createCoordinatorConversationContextAdapters({
    calendar: {
      accounts: new IntegrationAccountsRepository(), events,
      ...(over.selectionRead ? { readRawSelection: over.selectionRead } : {}),
    },
    projectSessions: {
      listPage,
      projects: { findById: (id) => (db.prepare('SELECT id, name, archived_at FROM projects WHERE id=?').get(id) as { id: string; name: string; archived_at: string | null } | undefined)
        ? (() => { const row = db.prepare('SELECT id, name, archived_at FROM projects WHERE id=?').get(id) as { id: string; name: string; archived_at: string | null }; return { id: row.id, name: row.name, archivedAt: row.archived_at }; })()
        : null },
      ownerProjectAccess: (_owner, projectId) => !denied.has(projectId),
      profiles: new AgentConfigsRepository(),
    },
  });
}
const calendar = (over?: Parameters<typeof adapters>[0]) => adapters(over).calendarMirror!.read(scope());
const sessions = () => adapters().projectSessions!.read(scope());

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  db.pragma('foreign_keys = OFF');
  setDb(db);
  denied = new Set();
  clock = { value: NOW };
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  project('proj-main'); project('proj-a'); project('proj-b'); project('proj-archived', { archived: '2026-10-01T00:00:00Z' });
});
afterEach(() => { vi.unstubAllGlobals(); setDb(null); db.close(); });

describe('(1) calendarMirror: exact owner and honest states', () => {
  it('no account is not_configured and a leftover mirror is never shown as current; the observed state never claims binding or completeness', async () => {
    mirror([{ externalId: 'e1', title: 'Leftover', startAt: '2026-10-07T17:00:00Z', endAt: '2026-10-07T18:00:00Z' }]);
    const none = await calendar();
    expect(none).toMatchObject({ state: 'not_configured', events: [], selectedCount: 0, accountBinding: 'unproven', externalCompleteness: 'unknown' });
    account();
    const observed = await calendar();
    expect(observed).toMatchObject({
      state: 'observed', accountBinding: 'unproven', externalCompleteness: 'unknown', selection: 'default_all_at_sync_time',
      lastSuccessfulSyncAt: SYNC, syncAgeSeconds: 3600, totalCount: null, selectedCount: 1,
    });
    // An empty window is zero stored observations, still externally unknown, never "clear".
    mirror([]);
    expect(await calendar()).toMatchObject({ state: 'observed', events: [], selectedCount: 0, externalCompleteness: 'unknown', accountBinding: 'unproven' });
  });

  it('other owners\' accounts and rows are invisible', async () => {
    account({ id: 'acct-other', owner: 9, ext: 'g-other' });
    mirror([{ externalId: 'o1', title: 'Foreign', startAt: '2026-10-07T17:00:00Z', endAt: null }], 9);
    expect(await calendar()).toMatchObject({ state: 'not_configured', events: [] });
    account();
    expect((await calendar()).events).toEqual([]);
  });

  it.each([
    ['error account', { status: 'error' }, 'account_unavailable'],
    ['never synced', { sync: null }, 'never_synced'],
    ['invalid sync time', { sync: 'not-a-time' }, 'invalid_sync_time'],
    ['future sync time', { sync: '2026-10-06T21:00:00.000Z' }, 'invalid_sync_time'],
  ] as const)('%s is its own state with no events', async (_label, over, state) => {
    account(over);
    mirror([{ externalId: 'e1', title: 'Stored', startAt: '2026-10-07T17:00:00Z', endAt: null }]);
    expect(await calendar()).toMatchObject({ state, events: [], selectedCount: 0, externalCompleteness: 'unknown' });
  });

  it('corrupt preferences and explicit no-calendars are distinct from an empty mirror', async () => {
    account();
    mirror([{ externalId: 'e1', title: 'Stored', startAt: '2026-10-07T17:00:00Z', endAt: null }]);
    for (const bad of ['{bad json', '{"selectedCalendarIds":"x"}', '[1,2]', '{"selectedCalendarIds":[1]}']) {
      selection(bad);
      expect(await calendar(), bad).toMatchObject({ state: 'preferences_corrupt', events: [] });
    }
    selection('{"selectedCalendarIds":[]}');
    expect(await calendar()).toMatchObject({ state: 'disabled_by_selection', selection: 'explicit_none', events: [] });
    selection('{"selectedCalendarIds":["work"]}');
    mirror([
      { externalId: 'a', title: 'Primary', startAt: '2026-10-07T17:00:00Z', endAt: null, calendarId: 'primary' },
      { externalId: 'b', title: 'Work', startAt: '2026-10-07T18:00:00Z', endAt: null, calendarId: 'work' },
    ]);
    expect(await calendar()).toMatchObject({ state: 'observed', selection: 'explicit_ids', events: [expect.objectContaining({ title: 'Work' })] });
  });

  it('an account switch with the same id and lastSyncedAt is never bound, and a change DURING the read withholds the projection', async () => {
    account();
    mirror([{ externalId: 'e1', title: 'Old mirror', startAt: '2026-10-07T17:00:00Z', endAt: null }]);
    db.prepare(`UPDATE integration_accounts SET external_account_id='google-ext-2'`).run();
    expect(await calendar()).toMatchObject({ state: 'observed', accountBinding: 'unproven', externalCompleteness: 'unknown' });
    // Reconnect to another identity (same row id, same lastSyncedAt) after the first read.
    let reads = 0;
    const switched = await calendar({ selectionRead: () => {
      reads += 1;
      // After the first account read, before the awaited re-read.
      if (reads === 1) db.prepare(`UPDATE integration_accounts SET external_account_id='google-ext-3'`).run();
      return null;
    } });
    expect(switched).toMatchObject({ state: 'changed_during_read', events: [], selectedCount: 0 });
    // A raw selection change during the read is withheld the same way.
    let selectionReads = 0;
    expect(await calendar({ selectionRead: () => {
      selectionReads += 1;
      return selectionReads === 1 ? null : '{"selectedCalendarIds":["x"]}';
    } })).toMatchObject({ state: 'changed_during_read', events: [] });
  });

  it('Sol: a future sync timestamp must not become a healthy observed empty mirror', async () => {
    account({ sync: new Date(NOW.valueOf() + 60_000).toISOString() });
    expect(await calendar()).toMatchObject({ state: 'invalid_sync_time', events: [], syncAgeSeconds: null });
  });

  it('makes no provider call, no token read and no write', async () => {
    account();
    mirror([{ externalId: 'e1', title: 'Stored', startAt: '2026-10-07T17:00:00Z', endAt: null }]);
    const before = JSON.stringify(db.prepare('SELECT * FROM integration_accounts').all());
    const writes = db.prepare('SELECT total_changes() AS n').get() as { n: number };
    await calendar();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(db.prepare('SELECT * FROM integration_accounts').all())).toBe(before);
    expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n).toBe(writes.n);
  });
});

describe('(2) calendarMirror: window semantics', () => {
  beforeEach(() => account());
  const titles = async () => (await calendar()).events.map((event) => event.title);

  it('normalizes offsets, includes spanning events, honors exclusive all-day ends and the LA day boundary', async () => {
    mirror([
      { externalId: 'tz-a', title: 'offset -07:00 (04:00Z)', startAt: '2026-10-06T21:00:00-07:00', endAt: '2026-10-06T22:00:00-07:00' },
      { externalId: 'tz-b', title: 'same instant in Z', startAt: '2026-10-07T04:00:00Z', endAt: '2026-10-07T05:00:00Z' },
      { externalId: 'span', title: 'spans today', startAt: '2026-10-05T20:00:00-07:00', endAt: '2026-10-06T08:00:00-07:00' },
      { externalId: 'ended-at-start', title: 'ended exactly at window start', startAt: '2026-10-05T20:00:00-07:00', endAt: '2026-10-06T00:00:00-07:00' },
      { externalId: 'allday-ends-before', title: 'all-day exclusive end today', startAt: '2026-10-05', endAt: '2026-10-06', isAllDay: true },
      { externalId: 'allday-covers', title: 'all-day covers today', startAt: '2026-10-05', endAt: '2026-10-07', isAllDay: true },
      { externalId: 'last-minute', title: 'Oct 13 23:30 PDT', startAt: '2026-10-14T06:30:00Z', endAt: '2026-10-14T06:45:00Z' },
      { externalId: 'next-day', title: 'Oct 14 00:00 PDT', startAt: '2026-10-14T07:00:00Z', endAt: '2026-10-14T08:00:00Z' },
      { externalId: 'allday-first-outside', title: 'all-day Oct 14', startAt: '2026-10-14', endAt: '2026-10-15', isAllDay: true },
      { externalId: 'allday-last-inside', title: 'all-day Oct 13', startAt: '2026-10-13', endAt: '2026-10-14', isAllDay: true },
    ]);
    const got = await titles();
    expect(got).toEqual(expect.arrayContaining([
      'offset -07:00 (04:00Z)', 'same instant in Z', 'spans today', 'all-day covers today', 'Oct 13 23:30 PDT', 'all-day Oct 13',
    ]));
    expect(got).not.toContain('ended exactly at window start');
    expect(got).not.toContain('all-day exclusive end today');
    expect(got).not.toContain('Oct 14 00:00 PDT');
    expect(got).not.toContain('all-day Oct 14');
    expect((await calendar()).window).toEqual({ startDay: '2026-10-06', endDayExclusive: '2026-10-14', timeZone: 'America/Los_Angeles' });
  });

  it('orders by normalized instant then id, never by raw ISO string across offsets', async () => {
    mirror([
      { externalId: 'late-instant', title: 'later (23:00-07:00 = 06:00Z Oct 7)', startAt: '2026-10-06T23:00:00-07:00', endAt: null },
      { externalId: 'early-instant', title: 'earlier (01:00Z Oct 7)', startAt: '2026-10-07T01:00:00+00:00', endAt: null },
    ]);
    // Raw string order would put the 2026-10-06T23... row first; the instant order must not.
    expect(await titles()).toEqual(['earlier (01:00Z Oct 7)', 'later (23:00-07:00 = 06:00Z Oct 7)']);
  });

  it('nine candidates give eight observations plus hasMore with an uncounted total; external completeness stays unknown', async () => {
    mirror(Array.from({ length: 9 }, (_, i) => ({
      externalId: `n${i}`, title: `Event ${i}`, startAt: `2026-10-07T${String(10 + i).padStart(2, '0')}:00:00Z`, endAt: null,
    })));
    const result = await calendar();
    expect(result).toMatchObject({ selectedCount: 8, hasMore: true, totalCount: null, externalCompleteness: 'unknown' });
    expect(result.events.map((event) => event.title)).toEqual(Array.from({ length: 8 }, (_, i) => `Event ${i}`));
  });

  it('serializes no description, location, account email or credential and sanitizes titles', async () => {
    mirror([{
      externalId: 'e1', title: 'Budget\u0000 review\n\n   now', startAt: '2026-10-07T17:00:00Z', endAt: null,
      description: 'SECRET DESCRIPTION', location: 'SECRET LOCATION', calendarId: 'someone@example.test',
    }]);
    const result = await calendar();
    const wire = JSON.stringify(result);
    expect(result.events[0].title).toBe('Budget review now');
    for (const secret of ['SECRET DESCRIPTION', 'SECRET LOCATION', 'someone@example.test', 'google-ext-1', 'access_token']) expect(wire).not.toContain(secret);
    expect(result.events[0].calendarLabel).toMatch(/^calendar-[0-9a-f]{6}$/);
  });
});

describe('(3)+(4) projectSessions: strict ownership, budgets, honest persisted state', () => {
  it('lists only exact-owner, nonarchived, accessible roots of real projects, excluding the Secretary root, children and foreign/NULL owners', async () => {
    chat('root', { project: 'proj-main' });
    chat('mine-a', { project: 'proj-a', status: 'working' });
    chat('mine-b', { project: 'proj-b', status: 'closed' });
    chat('foreign', { project: 'proj-a', owner: 8 });
    chat('null-owner', { project: 'proj-a', owner: null });
    chat('archived-session', { project: 'proj-a', archived: '2026-10-05T00:00:00Z' });
    chat('in-archived-project', { project: 'proj-archived' });
    chat('missing-project', { project: 'proj-ghost' });
    chat('denied', { project: 'proj-denied' }); project('proj-denied'); denied.add('proj-denied');
    chat('child', { project: 'proj-a', parent: 'mine-a' });
    const result = await sessions();
    const ids = result.groups.flatMap((group) => group.sessions.map((session) => session.sessionId)).sort();
    expect(ids).toEqual(['mine-a', 'mine-b']);
    expect(result).toMatchObject({ state: 'observed', coverage: 'recent_window_exhausted', selectedCount: 2 });
    expect(result.groups.map((group) => group.projectId).sort()).toEqual(['proj-a', 'proj-b']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('twelve selected roots is the budget: more eligible roots is truncated coverage, never an exact total', async () => {
    for (let i = 0; i < 13; i += 1) chat(`s${String(i).padStart(2, '0')}`, { activity: `2026-10-06T10:${String(59 - i).padStart(2, '0')}:00.000Z` });
    const result = await sessions();
    expect(result.selectedCount).toBe(12);
    expect(result.coverage).toBe('recent_window_truncated');
    expect(JSON.stringify(result)).not.toMatch(/totalCount|"total"/);
  });

  it('legacy/foreign rows that exhaust the two-page scan make coverage truncated/unknown, not an authoritative empty', async () => {
    for (let i = 0; i < 205; i += 1) chat(`legacy-${i}`, { owner: null, activity: `2026-10-06T12:${String(i % 60).padStart(2, '0')}:00.000Z` });
    chat('old-valid', { activity: '2026-10-01T00:00:00.000Z' });
    const result = await sessions();
    expect(result.state).toBe('observed');
    expect(result.coverage).toBe('recent_window_truncated');
    expect(result.groups).toEqual([]);
  });

  it('reports persisted state and profile availability without completion, liveness or bodies', async () => {
    db.prepare(`INSERT OR REPLACE INTO agent_configs (id, label, icon, command, enabled, is_agent) VALUES ('workflow-orchestrator', 'Coding Workflow', 'x', 'c', 1, 1)`).run();
    db.prepare(`INSERT OR REPLACE INTO agent_configs (id, label, icon, command, enabled, is_agent) VALUES ('disabled-p', 'Disabled profile', 'x', 'c', 0, 1)`).run();
    chat('wf', { profile: 'workflow-orchestrator', status: 'working', name: 'ordinary title' });
    chat('lookalike', { profile: null, name: 'Coding Workflow: implement it', status: 'closed' });
    chat('gone', { profile: 'ghost-profile', status: 'error' });
    chat('off', { profile: 'disabled-p', status: 'idle' });
    chat('kid', { parent: 'wf' });
    const result = await sessions();
    const by = new Map(result.groups.flatMap((group) => group.sessions).map((session) => [session.sessionId, session]));
    expect(by.get('wf')).toMatchObject({ status: 'working', profile: { profileId: 'workflow-orchestrator', codingWorkflow: true, executionAvailable: true } });
    expect(by.get('lookalike')).toMatchObject({ status: 'closed', profile: { profileId: null, codingWorkflow: false, executionAvailable: false } });
    expect(by.get('gone')).toMatchObject({ status: 'error', profile: { codingWorkflow: false, executionAvailable: false } });
    expect(by.get('off')).toMatchObject({ profile: { profileId: 'disabled-p', label: 'Disabled profile', executionAvailable: false } });
    const wire = JSON.stringify(result);
    for (const leak of ['SECRET PREVIEW BODY', '/secret/cwd/path', '/secret/project/cwd', 'childCount', 'runningChildCount', 'permission', 'success', 'completed']) {
      expect(wire, leak).not.toContain(leak);
    }
  });

  it('project access revoked or project archived between selection and exposure drops the row', async () => {
    chat('mine-a', { project: 'proj-a' });
    const base = adapters();
    let calls = 0;
    const flip = createCoordinatorConversationContextAdapters({
      projectSessions: {
        listPage, projects: { findById: (id) => ({ id, name: id, archivedAt: null }) },
        ownerProjectAccess: () => { calls += 1; return calls === 1; }, // allowed at selection, revoked at exposure
        profiles: new AgentConfigsRepository(),
      },
    });
    expect(base.projectSessions).toBeDefined();
    expect((await flip.projectSessions!.read(scope())).groups).toEqual([]);
  });
});

describe('(5) actual service seams: freshness, fingerprint, byte bounds, no new authority', () => {
  const SDK = 'ses_root_ctx';
  let repo: CoordinatorConversationsRepository;
  let service: CoordinatorConversationService;
  let access: { value: boolean };
  const actor = { sessionToken: 't', user: { id: OWNER } } as never;
  const request = { sessionId: 'root', projectId: 'proj-main' };

  beforeEach(() => {
    db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent) VALUES ('librarian', 'Synthetic profile', 'x', 'c', 1, 1)`).run();
    access = { value: true };
    db.prepare(`INSERT INTO agent_sessions (id, name, agent_kind, status, cwd, category, is_system, owner_user_id, project_id, profile_id, sdk_session_id, permission_mode, model_mode)
      VALUES ('root', 'Secretary', 'librarian', 'idle', '/tmp', 'chat', 0, ?, 'proj-main', 'librarian', ?, 'plan', 'auto')`).run(OWNER, SDK);
    repo = new CoordinatorConversationsRepository(db, () => NOW);
    expect(repo.designatePrimaryOwnerRoot({ ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root' }).kind).toBe('found');
    account();
    const profile = { id: 'librarian', enabled: true, isAgent: true, locked: false, modelProvider: 'p', modelId: 'm', revision: 1 };
    const composed = createCoordinatorConversationContextAdapters({
      calendar: { accounts: new IntegrationAccountsRepository(), events },
      projectSessions: {
        listPage,
        projects: { findById: (id) => { const r = db.prepare('SELECT id, name, archived_at FROM projects WHERE id=?').get(id) as { id: string; name: string; archived_at: string | null } | undefined; return r ? { id: r.id, name: r.name, archivedAt: r.archived_at } : null; } },
        ownerProjectAccess: (_o, p) => access.value && !denied.has(p),
        profiles: new AgentConfigsRepository(),
      },
      tasks: { findAllAsync: async () => [] } as never,
      schedules: { listForOwnerAsync: async () => [] } as never,
      rhythms: { findAllAsync: async () => [] } as never,
      workstreams: { list: () => [] } as never,
      jobs: { listNativeForWorkstream: () => [] } as never,
    });
    service = new CoordinatorConversationService({
      repository: repo,
      context: new CoordinatorConversationContextAssembler(composed),
      sessions: new AgentSessionsRepository(),
      configs: { getById: () => profile, listEnabled: () => [profile] } as never,
      projects: { findById: (id: string) => ({ id, archivedAt: null }) } as never,
      projectAccess: { canAccess: () => access.value, canOwnerAccess: () => access.value },
      enabled: () => true,
      now: () => clock.value,
    } as never);
    mirror([{ externalId: 'e1', title: 'Standup', startAt: '2026-10-07T17:00:00Z', endAt: '2026-10-07T17:30:00Z' }]);
    chat('proj-session', { project: 'proj-a', name: 'Dev session' });
  });

  const status = async () => {
    const result = await service.modelStatus(actor, { ...request, sdkSessionId: SDK, bindingCurrent: async () => true });
    if (result.kind !== 'available') throw new Error('status unavailable');
    return result.text;
  };
  const fingerprintOf = async () => {
    const found = repo.get({ ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root' });
    if (found.kind !== 'found') throw new Error('conversation');
    const context = await (service as unknown as { dependencies: { context: CoordinatorConversationContextAssembler } })
      .dependencies.context.assemble({ conversation: found.conversation, now: clock.value });
    return { context, fingerprint: (service as unknown as { foregroundContextFingerprint(c: unknown, x: unknown): string }).foregroundContextFingerprint(found.conversation, context), found };
  };

  it.each(['project archive', 'session owner transfer', 'calendar selection'] as const)('Sol: signed status withholds stale optional observations after final binding await: %s', async (change) => {
    const before = await status();
    expect(before).toContain('Dev session');
    expect(before).toContain('Standup');
    let checks = 0;
    const result = await service.modelStatus(actor, {
      ...request, sdkSessionId: SDK,
      bindingCurrent: async () => {
        checks += 1;
        if (checks === 2) {
          await Promise.resolve();
          if (change === 'project archive') db.prepare("UPDATE projects SET archived_at=? WHERE id='proj-a'").run(NOW.toISOString());
          if (change === 'session owner transfer') db.prepare("UPDATE agent_sessions SET owner_user_id=8 WHERE id='proj-session'").run();
          if (change === 'calendar selection') selection('{"selectedCalendarIds":[]}');
        }
        return true; // The Secretary root/native binding remains authorized.
      },
    });
    expect(checks).toBeGreaterThanOrEqual(2);
    expect(result.kind, 'an optional source change must preserve useful core status').toBe('available');
    expect(service.modelStatusScopeCurrent(actor, { ...request, sdkSessionId: SDK })).toBe(true);
    if (result.kind === 'available') {
      const staleTitle = change === 'calendar selection' ? 'Standup' : 'Dev session';
      expect(result.text, 'final exposure must not retain an observation invalidated across its awaited native check').not.toContain(staleTitle);
    }
  });

  it('actual signed wrapper: an optional source changed during ITS final authority await loses only its own observations', async () => {
    db.prepare(`INSERT INTO agent_turn_dispatches
      (id, session_id, sdk_session_id, sdk_user_message_id, origin, requested_source, route_authed, reason_code, outcome, created_at, updated_at)
      VALUES ('dispatch-wrapper', 'root', ?, 'native-ctx', 'prompt_api', 'session', 1, 'c2_foreground', 'accepted', ?, ?)`).run(SDK, NOW.toISOString(), NOW.toISOString());
    let reads = 0;
    let mutateAtRead = Number.POSITIVE_INFINITY;
    const signed = new CoordinatorConversationModelStatusService({
      conversations: service,
      records: repo,
      engine: {
        getCurrentTrustedMcpToolCall: async () => {
          reads += 1;
          // The wrapper's own last authority read: the Secretary root/native binding stays valid.
          if (reads === mutateAtRead) {
            await Promise.resolve();
            db.prepare("UPDATE projects SET archived_at=? WHERE id='proj-a'").run(NOW.toISOString());
          }
          return {
            sdkSessionId: SDK, assistantId: 'assistant-a', toolCallId: 'tool-a', agentName: 'Secretary',
            userMessageId: 'native-ctx', partId: 'part-a', toolKey: 'rhythm_get_coordinator_status',
            serverName: 'rhythm', toolName: 'rhythm_get_coordinator_status',
          };
        },
      },
      verify: async () => ({ context: { sdkSessionId: SDK, turnId: 'assistant-a', toolCallId: 'tool-a', agentName: 'Secretary' }, arguments: {} }),
    } as never);
    const baseline = await signed.status(actor, { trustedCall: { ignored: true } });
    expect(baseline.status).toBe('available');
    expect(baseline.text).toContain('Dev session');
    expect(baseline.text).toContain('Standup');
    const lastRead = reads;
    reads = 0;
    mutateAtRead = lastRead; // the final isCurrent await inside the wrapper itself
    const raced = await signed.status(actor, { trustedCall: { ignored: true } });
    expect(reads).toBe(lastRead);
    expect(raced.status, 'core status survives an optional-source change').toBe('available');
    expect(service.modelStatusScopeCurrent(actor, { ...request, sdkSessionId: SDK })).toBe(true);
    expect(raced.text).not.toContain('Dev session');
    expect(raced.text).toContain('Standup'); // the unaffected optional source remains
    const body = JSON.parse(raced.text.slice(raced.text.indexOf('{')));
    expect(body.projectSessions).toMatchObject({ state: 'changed_during_read', coverage: 'unknown', selectedCount: 0 });
    expect(body.calendarMirror).toMatchObject({ state: 'observed', selectedCount: 1 });
    expect(Buffer.byteLength(raced.text, 'utf8')).toBeLessThanOrEqual(3_800);
  });

  it('the signed status carries both sources with their qualifications and bounded observations, valid JSON', async () => {
    const text = await status();
    const body = JSON.parse(text.slice(text.indexOf('{')));
    expect(body.calendarMirror).toMatchObject({ state: 'observed', accountBinding: 'unproven', externalCompleteness: 'unknown', selectedCount: 1, totalCount: null });
    expect(body.calendarMirror.events[0]).toMatchObject({ title: 'Standup', allDay: false });
    expect(body.projectSessions).toMatchObject({ state: 'observed', coverage: 'recent_window_exhausted', selectedCount: 1 });
    expect(JSON.stringify(body.projectSessions)).not.toContain('SECRET');
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(3_800);
  });

  it('oversized observations are trimmed deterministically with both qualifications kept, never cut JSON', async () => {
    mirror(Array.from({ length: 9 }, (_, i) => ({
      externalId: `big${i}`, title: `Long calendar title ${i} ${'x'.repeat(150)}`, startAt: `2026-10-07T${String(10 + i).padStart(2, '0')}:00:00Z`, endAt: null,
    })));
    for (let i = 0; i < 12; i += 1) chat(`many${i}`, { project: 'proj-a', name: `Long session label ${i} ${'y'.repeat(150)}`, activity: `2026-10-06T11:${String(10 + i)}:00.000Z` });
    const text = await status();
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(3_800);
    const body = JSON.parse(text.slice(text.indexOf('{')));
    expect(body.calendarMirror).toMatchObject({ state: 'observed', selectedCount: 8, hasMore: true, externalCompleteness: 'unknown' });
    expect(body.projectSessions).toMatchObject({ state: 'observed', coverage: 'recent_window_truncated' });
    expect(text).toBe(await status()); // deterministic
    // Source unavailability survives even the oversized fallback.
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });

  it('source unavailability is explicit in status even when oversized', async () => {
    db.prepare(`UPDATE integration_accounts SET status='error'`).run();
    for (let i = 0; i < 12; i += 1) chat(`m${i}`, { project: 'proj-a', name: `L ${i} ${'z'.repeat(200)}` });
    const body = JSON.parse((await status()).replace(/^[^{]*/, ''));
    expect(body.calendarMirror).toMatchObject({ state: 'account_unavailable' });
  });

  it('foreground and signed status carry server dates across the UTC/PDT boundary and the next local day', async () => {
    const internals = service as unknown as {
      currentRootSelection(a: unknown, r: unknown): unknown;
      foregroundCoordinatorContract(a: unknown, r: unknown, s: unknown, rev: number): Promise<{ fingerprint: string; system: string; contextQualified: boolean } | null>;
      foregroundCoordinatorContextCurrent(a: unknown, r: unknown, s: unknown, rev: number, fp: string, q: boolean): Promise<boolean>;
    };
    const selection = internals.currentRootSelection(actor, request);
    const found = repo.get({ ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root' });
    if (found.kind !== 'found') throw new Error('conversation');
    for (const [asOf, today, yesterday] of [
      ['2026-10-06T02:30:00.000Z', '2026-10-05', '2026-10-04'],
      ['2026-10-06T07:30:00.000Z', '2026-10-06', '2026-10-05'],
    ]) {
      clock.value = new Date(asOf);
      const contract = await internals.foregroundCoordinatorContract(actor, request, selection, found.conversation.controlRevision);
      expect(contract).not.toBeNull();
      const snapshot = JSON.parse(contract!.system.split('Current bounded coordinator snapshot: ')[1]);
      const expected = { asOf, timeZone: 'America/Los_Angeles', today, yesterday };
      expect.soft(snapshot).toMatchObject(expected);
      expect.soft(JSON.parse((await status()).replace(/^[^{]*/, ''))).toMatchObject(expected);
      clock.value = new Date(clock.value.valueOf() + 1_000);
      expect(await internals.foregroundCoordinatorContextCurrent(
        actor, request, selection, found.conversation.controlRevision, contract!.fingerprint, true,
      )).toBe(true); // Clock movement cannot invalidate unchanged authority/source proofs.
    }
  });

  it('bounded status retains the same authoritative server dates', async () => {
    clock.value = new Date('2026-10-06T02:30:00.000Z');
    for (let i = 0; i < 12; i += 1) {
      expect(repo.addGoal({
        ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root',
        expectedControlRevision: i + 1, commandKey: `date-goal-${i}`,
        objective: `Synthetic goal ${i} ${'z'.repeat(400)}`,
      }).kind).toBe('created');
    }
    const text = await status();
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(3_800);
    expect(JSON.parse(text.replace(/^[^{]*/, ''))).toMatchObject({
      state: 'bounded_summary', asOf: '2026-10-06T02:30:00.000Z',
      timeZone: 'America/Los_Angeles', today: '2026-10-05', yesterday: '2026-10-04',
    });
  });

  it('the semantic fingerprint ignores the ticking clock but changes with a real source change', async () => {
    const first = await fingerprintOf();
    clock.value = new Date(NOW.valueOf() + 20 * 60_000); // sync age grows, same window content
    expect((await fingerprintOf()).fingerprint).toBe(first.fingerprint);
    mirror([{ externalId: 'e2', title: 'Changed', startAt: '2026-10-07T17:00:00Z', endAt: null }]);
    expect((await fingerprintOf()).fingerprint).not.toBe(first.fingerprint);
    const afterCalendar = (await fingerprintOf()).fingerprint;
    chat('another', { project: 'proj-b', status: 'working' });
    expect((await fingerprintOf()).fingerprint).not.toBe(afterCalendar);
  });

  it('actual foreground current-check withholds on source, account, project or access changes', async () => {
    const internals = service as unknown as {
      currentRootSelection(a: unknown, r: unknown): unknown;
      foregroundCoordinatorContract(a: unknown, r: unknown, s: unknown, rev: number): Promise<{ fingerprint: string; system: string; contextQualified: boolean } | null>;
      foregroundCoordinatorContextCurrent(a: unknown, r: unknown, s: unknown, rev: number, fp: string, q: boolean): Promise<boolean>;
    };
    const selection = internals.currentRootSelection(actor, request);
    const found = repo.get({ ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root' });
    if (found.kind !== 'found') throw new Error('conversation');
    const rev = found.conversation.controlRevision;
    const contract = await internals.foregroundCoordinatorContract(actor, request, selection, rev);
    expect(contract).not.toBeNull();
    // System text: compact state only, no event/session bodies.
    expect(contract!.system).toContain('"calendarMirror"');
    expect(contract!.system).toContain('"projectSessions"');
    expect(contract!.system).not.toContain('Standup');
    expect(contract!.system).not.toContain('Dev session');
    const current = () => internals.foregroundCoordinatorContextCurrent(actor, request, selection, rev, contract!.fingerprint, true);
    expect(await current()).toBe(true);
    clock.value = new Date(NOW.valueOf() + 10 * 60_000);
    expect(await current()).toBe(true); // clock only
    db.prepare(`UPDATE integration_accounts SET external_account_id='google-ext-switched'`).run();
    expect(await current()).toBe(true); // identity is withheld at read time, not exposed in content
    db.prepare(`UPDATE integration_accounts SET last_synced_at='2026-10-06T18:30:00.000Z'`).run();
    expect(await current()).toBe(false); // observed sync state changed
    const fresh = await internals.foregroundCoordinatorContract(actor, request, selection, rev);
    const freshCurrent = () => internals.foregroundCoordinatorContextCurrent(actor, request, selection, rev, fresh!.fingerprint, true);
    expect(await freshCurrent()).toBe(true);
    db.prepare(`UPDATE projects SET archived_at='2026-10-06T00:00:00Z' WHERE id='proj-a'`).run();
    expect(await freshCurrent()).toBe(false); // project archived: the prepared exposure is stale
  });

  it('the exact callback seam (prepare/current) sees the same source changes', async () => {
    const goal = repo.addGoal({ ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root', expectedControlRevision: 1, commandKey: 'g', objective: 'Fix it' });
    const goalId = (goal as { goal: { id: string } }).goal.id;
    repo.reserveGoalDelegation({ ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root', expectedControlRevision: 2, commandKey: 'd', goalId, parentSdkSessionId: SDK });
    repo.settleGoalDelegation({ ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root', expectedControlRevision: 3, commandKey: 'd', goalId, outcome: 'dispatched', delegationId: 'dg-ctx', childSessionId: 'child-ctx' });
    const prepared = await service.prepareCallbackContext({
      ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root', sdkSessionId: SDK, delegationId: 'dg-ctx', childSessionId: 'child-ctx',
    });
    expect(prepared).not.toBeNull();
    expect(prepared!.system).toContain('"calendarMirror"');
    expect(prepared!.system).not.toContain('Standup');
    expect(await prepared!.current()).toBe(true);
    clock.value = new Date(NOW.valueOf() + 5 * 60_000);
    expect(await prepared!.current()).toBe(true);
    chat('new-work', { project: 'proj-b', status: 'working' });
    expect(await prepared!.current()).toBe(false);
  });

  it('optional sources can fail, or be large, without touching mandatory qualification or availability', async () => {
    const base = createCoordinatorConversationContextAdapters({
      tasks: { findAllAsync: async () => [] } as never,
      schedules: { listForOwnerAsync: async () => [] } as never,
      rhythms: { findAllAsync: async () => [] } as never,
      workstreams: { list: () => [] } as never,
      jobs: { listNativeForWorkstream: () => [] } as never,
    });
    const found = repo.get({ ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root' });
    if (found.kind !== 'found') throw new Error('conversation');
    const withoutOptional = await new CoordinatorConversationContextAssembler(base).assemble({ conversation: found.conversation, now: NOW });
    expect(withoutOptional.modelContext.kind).toBe('ready');
    expect(withoutOptional.calendarMirror).toBeUndefined();
    const broken = await new CoordinatorConversationContextAssembler({
      ...base,
      calendarMirror: { read: async () => { throw new Error('boom'); } },
      projectSessions: { read: async () => ({ not: 'a projection' }) as never },
    }).assemble({ conversation: found.conversation, now: NOW });
    expect(broken.modelContext).toEqual(withoutOptional.modelContext);
    expect(broken.calendarMirror).toMatchObject({ state: 'read_failed', events: [], externalCompleteness: 'unknown' });
    expect(broken.projectSessions).toMatchObject({ state: 'read_failed', coverage: 'unknown', groups: [] });
    mirror(Array.from({ length: 9 }, (_, i) => ({ externalId: `x${i}`, title: `T${i} ${'q'.repeat(900)}`, startAt: `2026-10-07T${String(10 + i).padStart(2, '0')}:00:00Z`, endAt: null })));
    const big = await new CoordinatorConversationContextAssembler(createCoordinatorConversationContextAdapters({
      calendar: { accounts: new IntegrationAccountsRepository(), events },
    })).assemble({ conversation: found.conversation, now: NOW });
    expect(big.calendarMirror!.events.length).toBe(8);
    // Optional titles are clipped to 160 chars each (~3 KB for eight) and the
    // mandatory model-context byte measure ignores them entirely.
    const optionalBytes = JSON.stringify(big.calendarMirror).length;
    expect(optionalBytes).toBeGreaterThan(2_000);
    expect(optionalBytes).toBeLessThan(4_000);
    expect(big.modelContext.kind).toBe('ready');
  });

  it('a readable cross-project session grants nothing: no tool/grant text, and project access is the only dispatch gate', async () => {
    const found = repo.get({ ownerUserId: OWNER, projectId: 'proj-main', sessionId: 'root' });
    if (found.kind !== 'found') throw new Error('conversation');
    const { context } = await fingerprintOf();
    const system = (service as unknown as { foregroundSystemContract(c: unknown, x: unknown): string }).foregroundSystemContract(found.conversation, context);
    expect(system).toMatch(/never a dispatch grant/);
    expect(system).toMatch(/only if it is actually in your active profile scope/);
    // Denying the OTHER project's access removes it from observations without touching the root's own access.
    denied.add('proj-a');
    expect((await sessions()).groups).toEqual([]);
    expect(await status()).toContain('observed');
  });
});
