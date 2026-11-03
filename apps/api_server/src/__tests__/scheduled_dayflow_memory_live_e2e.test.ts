/**
 * Synthetic API + real fork-engine contract; no mocks and no browser surface.
 * Normal check (no servers): npx vitest run src/__tests__/scheduled_dayflow_memory_live_e2e.test.ts
 * Operator-only live invocation: set RHYTHM_LIVE_E2E=1, RHYTHM_LIVE_E2E_ISOLATED=1,
 * RHYTHM_LIVE_URL, RHYTHM_LIVE_ENGINE_URL, DB_PATH=RHYTHM_LIVE_DB_PATH (SANDBOX COPY),
 * RHYTHM_SDMR_PROVIDER_PORT=7481; configure sdmr/scripted at the provider's /v1,
 * apiKey=sdmr-synthetic-only, with tool calling enabled. Use an isolated synthetic
 * MEMORY_VAULT_PATH under the same disposable sandbox, never a real vault.
 * No API/engine is launched here; only the loopback scripted provider is spawned.
 */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1';
// Evidence-preserving runs keep every created session/memory/profile/dir for review.
const RETAIN = process.env.RHYTHM_LIVE_RETAIN_FIXTURES === '1';
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const ENGINE = process.env.RHYTHM_LIVE_ENGINE_URL ?? '';
const DB = process.env.RHYTHM_LIVE_DB_PATH ?? '';
const PORT = Number(process.env.RHYTHM_SDMR_PROVIDER_PORT ?? '7481');
const PROVIDER = `http://127.0.0.1:${PORT}`;
const PROVIDER_ID = 'sdmr';
const MODEL_ID = 'scripted';
const auth = { Authorization: 'Bearer e02-synthetic-session-not-a-secret', 'content-type': 'application/json' };
const schedules: string[] = [], sessions: string[] = [], profiles: string[] = [], dirs: string[] = [], memories: string[] = [];
let provider: ChildProcess | undefined;
let providerStderr = '';
let safeToClean = false;
type Capture = { systemText: string; lastUserText: string; toolNames: string[]; messageCount: number; toolResults: string[] };
type Session = { id: string; status: string; statusMessage: string | null; ownerUserId: number | null };
type Schedule = { id: string; createdByUserId: number | null; lastRunStatus: string | null; lastError: string | null };
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const tag = () => randomUUID().slice(0, 8);
function tempPath(path: string): string {
  if (!isAbsolute(path)) throw new Error('Explicit absolute sandbox path required');
  const canonical = realpathSync(path);
  if (canonical.includes('/Library/Application Support/') ||
      !['/private/tmp/', '/var/folders/'].some((root) => canonical.startsWith(root))) {
    throw new Error('Refusing non-disposable sandbox path');
  }
  return canonical;
}
function loopback(url: string, blocked: string[]): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) ||
      !parsed.port || blocked.includes(parsed.port) || parsed.username || parsed.password) {
    throw new Error('Explicit isolated loopback URL required');
  }
  if (Number(parsed.port) === PORT) throw new Error('Provider and backend ports must differ');
}
async function api(path: string, init: RequestInit = {}, authenticated = true): Promise<Response> {
  return fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(60_000),
    headers: { ...(authenticated ? auth : { 'content-type': 'application/json' }), ...init.headers } });
}
async function json<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const response = await api(path, init, authenticated);
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
async function poll<T>(read: () => Promise<T | undefined>, label: string, ms = 180_000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await pause(200);
  }
  throw new Error(`${label} timed out`); // Never print captured system text.
}
async function captures(marker?: string): Promise<Capture[]> {
  const response = await fetch(`${PROVIDER}/_sdmr/requests`, { signal: AbortSignal.timeout(5000) });
  expect(response.ok).toBe(true);
  const all = await response.json() as Capture[];
  return marker ? all.filter((item) => item.lastUserText.includes(marker)) : all;
}
async function snapshot(id: string): Promise<Session> {
  return (await json<{ session: Session }>(`/agent-sessions/${id}`)).session;
}
async function answered(id: string, marker: string): Promise<void> {
  await poll(async () => {
    const transcript = await json<{ messages: Array<{ role: string; rawText?: string; strippedText?: string }> }>(`/agent-sessions/${id}/messages?limit=100`);
    return transcript.messages.some((m) => m.role === 'output' && (m.rawText ?? m.strippedText ?? '').includes(marker)) &&
      (await snapshot(id)).status === 'idle' ? true : undefined;
  }, 'observable assistant answer');
}
async function prompt(id: string, text: string): Promise<void> {
  expect((await api(`/agent-sessions/${id}/prompt`, { method: 'POST', body: JSON.stringify({ prompt: text }) })).status).toBe(202);
}
async function profile(): Promise<string> {
  const id = `sdmr-${tag()}`;
  const created = await json<{ id: string }>('/agent-configs', { method: 'POST', body: JSON.stringify({
    id, label: id, isAgent: true, enabled: true, sessionSelectable: true, ocAgent: id,
    modelProvider: PROVIDER_ID, modelId: MODEL_ID,
    // Pattern objects are supported by validateCorePermissionsJson. Order matters:
    // wildcard first, exact pwd override last; no write/command grants are inherited.
    corePermissionsJson: JSON.stringify({ '*': 'ask', bash: { '*': 'ask', pwd: 'allow' } }),
    systemPrompt: 'Synthetic smoke protocol. Follow the scripted provider response.',
  }) });
  profiles.push(created.id);
  await json('/system/refresh', { method: 'POST' });
  return created.id;
}
async function interactive(profileId: string): Promise<{ id: string; cwd: string }> {
  const cwd = mkdtempSync('/private/tmp/rhythm-sdmr-'); dirs.push(cwd);
  const session = await json<{ id: string }>('/agent-sessions', { method: 'POST', body: JSON.stringify({
    agentId: profileId, cwd, name: `Synthetic SDMR ${tag()}`, permissionMode: 'default',
  }) });
  sessions.push(session.id);
  expect((await snapshot(session.id)).ownerUserId).toBe(1);
  return { id: session.id, cwd };
}
async function scheduled(profileId: string, text: string): Promise<{ sessionId: string; terminal: Schedule }> {
  // No Authorization: the system schedule must have no createdByUserId.
  const schedule = await json<Schedule>('/agent-schedules', { method: 'POST', body: JSON.stringify({
    name: `Synthetic SDMR ${tag()}`, scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z',
    agentConfigId: profileId, prompt: text,
  }) }, false);
  schedules.push(schedule.id);
  expect(schedule.createdByUserId).toBeNull();
  await json(`/agent-schedules/${schedule.id}/trigger-now`, { method: 'POST', body: '{}' });
  // Discover rows during polling too, so cleanup owns sessions even on failure.
  const terminal = await poll(async () => {
    await discoverScheduledSessions(schedule.id);
    const task = await json<Schedule>(`/agent-schedules/${schedule.id}`);
    return ['success', 'completed_no_op', 'error', 'blocked_on_approval'].includes(task.lastRunStatus ?? '') ? task : undefined;
  }, 'schedule terminal status');
  const ids = await discoverScheduledSessions(schedule.id);
  expect(ids.length).toBe(1);
  expect(terminal.lastRunStatus).not.toBe('error');
  expect(['success', 'completed_no_op']).toContain(terminal.lastRunStatus);
  expect(terminal.lastError).toBeNull();
  return { sessionId: ids[0], terminal };
}
async function discoverScheduledSessions(scheduleId: string): Promise<string[]> {
  const list = await json<{ sessions: Array<{ id: string; scheduledTaskId: string | null }> }>(`/agent-sessions?scheduledTaskId=${encodeURIComponent(scheduleId)}`);
  const ids = list.sessions.filter((s) => s.scheduledTaskId === scheduleId).map((s) => s.id);
  for (const id of ids) if (!sessions.includes(id)) sessions.push(id);
  return ids;
}
function row(id: string): Record<string, unknown> {
  const db = new Database(tempPath(DB), { readonly: true, fileMustExist: true });
  try { return db.prepare('SELECT * FROM agent_sessions WHERE id=?').get(id) as Record<string, unknown>; }
  finally { db.close(); }
}
function plantMarker(id: string): void {
  const db = new Database(tempPath(DB), { fileMustExist: true });
  try {
    expect(db.prepare(`UPDATE agent_sessions SET dayflow_context_nonreuse_code=?, dayflow_context_nonreuse_at=?
      WHERE id=? AND category='scheduled' AND owner_user_id IS NULL`).run(
      'dayflow_receiving_context_changed', new Date().toISOString(), id).changes).toBe(1);
  } finally { db.close(); }
}
/**
 * A4 fixture mutation: marks ONLY the fresh scheduler-created row whose first native turn is in
 * flight (exact id + task + scheduled + ownerless + current SDK id + no prior marker), with the same
 * synthetic code S2 uses. Returns body-free before/after metadata for the retained log.
 */
function markInFlight(id: string, scheduleId: string, sdk: string): { before: unknown; after: unknown } {
  const cols = 'id, scheduled_task_id, category, owner_user_id, project_id, sdk_session_id, status, dayflow_context_nonreuse_code, dayflow_context_nonreuse_at';
  const db = new Database(tempPath(DB), { fileMustExist: true });
  try {
    const before = db.prepare(`SELECT ${cols} FROM agent_sessions WHERE id=?`).get(id);
    expect(db.prepare(`UPDATE agent_sessions SET dayflow_context_nonreuse_code=?, dayflow_context_nonreuse_at=?
      WHERE id=? AND scheduled_task_id=? AND category='scheduled' AND owner_user_id IS NULL AND sdk_session_id=?
        AND dayflow_context_nonreuse_code IS NULL AND dayflow_context_nonreuse_at IS NULL`).run(
      'dayflow_receiving_context_changed', new Date().toISOString(), id, scheduleId, sdk).changes).toBe(1);
    return { before, after: db.prepare(`SELECT ${cols} FROM agent_sessions WHERE id=?`).get(id) };
  } finally { db.close(); }
}
type Receipt = { query_mode: string | null; decision: string; candidates_json: string | null; injected_count: number | null; injected_chars: number | null };
function receipts(sessionId: string): Receipt[] {
  const db = new Database(tempPath(DB), { readonly: true, fileMustExist: true });
  try {
    return db.prepare(`SELECT query_mode, decision, candidates_json, injected_count, injected_chars
      FROM agent_memory_turn_receipts WHERE session_id=? ORDER BY id`).all(sessionId) as Receipt[];
  } finally { db.close(); }
}
/** Real vault write; `id` is the note id (edit/delete), `path` is the index sourceId receipts carry. */
async function remember(content: string, kind: string, tags: string[]): Promise<{ id: string; path: string }> {
  const memory = await json<{ id: string; path: string }>('/agent-memory', { method: 'POST', body: JSON.stringify({ content, kind, tags, id: `sdmr-${randomUUID()}` }) });
  memories.push(memory.id);
  return memory;
}
/** One real turn: returns exactly the provider requests and receipts this turn produced. */
async function memoryTurn(id: string, text: string, output: string): Promise<{ requests: Capture[]; added: Receipt[] }> {
  const before = (await captures()).length, prior = receipts(id).length;
  const done = async () => (await json<{ messages: Array<{ role: string; rawText?: string; strippedText?: string }> }>(`/agent-sessions/${id}/messages?limit=100`))
    .messages.filter((m) => m.role === 'output' && (m.rawText ?? m.strippedText ?? '').includes(output)).length;
  const outputs = await done();
  await prompt(id, text);
  await poll(async () => await done() > outputs && (await snapshot(id)).status === 'idle' ? true : undefined, 'observable assistant answer');
  return { requests: (await captures()).slice(before), added: receipts(id).slice(prior) };
}
function admitted(receipt: Receipt): Array<{ memoryId?: string; sourceId?: string; admitted?: boolean; reason?: string }> {
  return (JSON.parse(receipt.candidates_json ?? '[]') as Array<{ memoryId?: string; sourceId?: string; admitted?: boolean; reason?: string }>)
    .filter((candidate) => candidate.admitted);
}
async function evidence(caseId: string, status: string, checks: Record<string, boolean>, count?: number): Promise<void> {
  console.info(JSON.stringify({ caseId, sessionIds: [...sessions], status,
    providerRequestCount: count ?? (await captures()).length, ...checks }));
}
function bodyFree(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(bodyFree);
  if (!value || typeof value !== 'object') return true;
  return Object.entries(value).every(([key, item]) =>
    !/^(body|content|text|excerpt|rawText|prompt|systemText)$/i.test(key) && bodyFree(item));
}

(LIVE ? describe : describe.skip)('scheduled Dayflow + ordinary memory live contract', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    loopback(BASE, ['4000', '4001', '4096']);
    loopback(ENGINE, ['4096', '4001']);
    if (!Number.isInteger(PORT) || PORT < 7480 || PORT > 7489) throw new Error('Provider port must be 7480-7489');
    expect(tempPath(DB)).toBe(tempPath(process.env.DB_PATH ?? ''));
    // Require operator acknowledgement to identify the disposable copy, not the read-only fixture source.
    const sandbox = tempPath(process.env.RHYTHM_SANDBOX_DIR ?? '');
    expect(tempPath(DB).startsWith(`${sandbox}/`)).toBe(true);
    expect(tempPath(process.env.MEMORY_VAULT_PATH ?? '').startsWith(`${sandbox}/`)).toBe(true);
    safeToClean = true;
    provider = spawn(process.execPath, [join(__dirname, 'fixtures/scripted_openai_provider_sdmr.mjs')], {
      env: { ...process.env, RHYTHM_SDMR_PROVIDER_PORT: String(PORT) }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    provider.stderr?.on('data', (data: Buffer) => { providerStderr += data.toString(); });
    await poll(async () => {
      if (provider?.exitCode !== null) throw new Error(`Provider exited: ${providerStderr}`);
      return await fetch(`${PROVIDER}/health`).then((r) => r.ok ? true : undefined).catch(() => undefined);
    }, 'provider readiness', 10_000);
    await poll(async () => (await api('/health')).ok ? true : undefined, 'API health', 30_000);
    // Synthetic credential so interactive model resolution treats the scripted provider as connected.
    expect((await api(`/opencode/auth/${PROVIDER_ID}`, { method: 'POST', body: JSON.stringify({ apiKey: 'sdmr-synthetic-only' }) })).ok).toBe(true);
    await poll(async () => (await json<{ status: string }>('/opencode/health')).status === 'ready' ? true : undefined,
      'fork engine ready', 30_000);
    await evidence('S3', 'SKIP: no scheduler resume-existing-session mode; mapping is unit-tested', {}, 0);
  }, 60_000);
  beforeEach(async () => {
    expect((await fetch(`${PROVIDER}/_sdmr/reset`, { method: 'POST' })).status).toBe(204);
  });
  afterEach(async () => {
    if (!safeToClean || RETAIN) return;
    // Discover first; stop schedules before deleting their sessions/profiles.
    const errors: string[] = [];
    for (const id of schedules) {
      await discoverScheduledSessions(id).catch(() => errors.push('scheduled-session discovery'));
    }
    for (const [prefix, ids, suffix] of [
      ['/agent-schedules', schedules, ''], ['/agent-sessions', sessions, '/hard'],
      ['/agent-memory', memories, ''], ['/agent-configs', profiles, ''],
    ] as const) {
      for (const id of ids.splice(0).reverse()) {
        await api(`${prefix}/${encodeURIComponent(id)}${suffix}`, { method: 'DELETE' })
          .then((r) => { if (!r.ok && r.status !== 404) errors.push(`${prefix}: ${r.status}`); })
          .catch(() => errors.push(`${prefix}: cleanup unreachable`));
      }
    }
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    if (profiles.length === 0) await api('/system/refresh', { method: 'POST' }).catch(() => errors.push('refresh cleanup'));
    expect(errors, 'disposable fixture cleanup must complete').toEqual([]);
  }, 60_000);
  afterAll(async () => {
    if (!provider || provider.exitCode !== null) return;
    const exited = new Promise<void>((done) => provider!.once('exit', () => done()));
    provider.kill('SIGTERM');
    await Promise.race([exited, pause(5000).then(() => { if (provider?.exitCode === null) provider.kill('SIGKILL'); })]);
  });

  it('S1 scheduled_no_dayflow_executes', async () => {
    const marker = tag();
    const { sessionId, terminal } = await scheduled(await profile(), `SDMR:PWD:${marker}`);
    expect(row(sessionId)).toMatchObject({ owner_user_id: null, project_id: null, category: 'scheduled', dayflow_context_nonreuse_code: null });
    await answered(sessionId, `SDMR_DONE ${marker}`);
    const received = await captures(`SDMR:PWD:${marker}`);
    expect(received.length).toBeGreaterThanOrEqual(2);
    // The tool really ran: its result is the session directory, not an unavailable-tool error.
    const cwd = realpathSync(String(row(sessionId).cwd));
    expect(received.some((r) => r.toolResults.some((out) => out.includes(cwd) && !/unavailable tool|invalid/i.test(out)))).toBe(true);
    expect(received.every((r) => !r.systemText.includes('Dayflow observation'))).toBe(true);
    await evidence('S1', terminal.lastRunStatus!, { ownerless: true, executedPwd: true, transcriptDone: true, dayflowAbsent: true });
  }, 240_000);

  it('S2 scheduled_retained_marker_holds_with_reason', async () => {
    const first = tag(), followup = tag();
    const { sessionId } = await scheduled(await profile(), `SDMR:ECHO:${first}`);
    await answered(sessionId, `SDMR_ECHO ${first}`);
    plantMarker(sessionId);
    const response = await api(`/agent-sessions/${sessionId}/prompt`, { method: 'POST', body: JSON.stringify({ prompt: `SDMR:ECHO:${followup}` }) });
    const responseBody = await response.text();
    const guardReason = 'Dayflow provider guard held this request (history_ambiguous)';
    let status = 'history_ambiguous';
    if (response.ok || responseBody.includes(guardReason)) {
      await poll(async () => (await snapshot(sessionId)).statusMessage?.includes(guardReason) ? true : undefined, 'persisted guard reason', 30_000);
    } else {
      // Rhythm's pre-dispatch retained-history check refuses before the engine guard runs.
      // Only that exact refusal counts; model/auth misconfiguration never passes as a hold.
      expect(response.status).toBe(502);
      const error = JSON.parse(responseBody) as { error?: { message?: string }; message?: string };
      const reason = error.error?.message ?? error.message ?? '';
      expect(reason).toBe('Could not enqueue prompt in Opencode engine.');
      status = 'held_before_dispatch';
    }
    await pause(2000);
    expect(await captures(`SDMR:ECHO:${followup}`)).toHaveLength(0);
    expect(row(sessionId).dayflow_context_nonreuse_code).toBe('dayflow_receiving_context_changed');
    await evidence('S2', status, { providerNotCalled: true, retainedMarker: true, engineGuardReasonSurfaced: status === 'history_ambiguous' });
  }, 240_000);

  it.skip('S3 scheduled_run_failure_reason_preserved — no schedule resume-existing-session mode; guard-reason mapping is unit-tested elsewhere', async () => {
    // AgentSchedulesController.create accepts no target session id; AgentRunner
    // unconditionally _recordSession + createSession on every scheduler run.
    // Explicit skip; beforeAll emits its compact evidence line when live is enabled.
  });

  it('A4 scheduled_inflight_guard_reason_preserved (fresh first-turn tool loop; no resume API)', async () => {
    const marker = tag();
    const profileId = await profile();
    // Timing only: the provider holds this tag's first native request, then returns the normal pwd call.
    expect((await fetch(`${PROVIDER}/_sdmr/hold/${marker}`, { method: 'POST' })).status).toBe(204);
    let released = false;
    const release = async () => {
      if (released) return;
      released = true;
      expect((await fetch(`${PROVIDER}/_sdmr/release/${marker}`, { method: 'POST' })).status).toBe(204);
    };
    const schedule = await json<Schedule>('/agent-schedules', { method: 'POST', body: JSON.stringify({
      name: `Synthetic SDMR A4 ${marker}`, scheduleType: 'once', runAt: '2099-01-01T00:00:00.000Z',
      agentConfigId: profileId, prompt: `SDMR:PWD:${marker}`,
    }) }, false);
    schedules.push(schedule.id);
    expect(schedule.createdByUserId).toBeNull();
    try {
      await json(`/agent-schedules/${schedule.id}/trigger-now`, { method: 'POST', body: '{}' });
      await poll(async () => ((await (await fetch(`${PROVIDER}/_sdmr/held`)).json()) as string[]).includes(marker) ? true : undefined,
        'first native provider request held', 120_000);
      const ids = await discoverScheduledSessions(schedule.id);
      expect(ids).toHaveLength(1);
      const id = ids[0];
      const sdk = await poll(async () => {
        const value = row(id).sdk_session_id;
        return typeof value === 'string' && value.length > 0 ? value : undefined;
      }, 'fresh scheduled SDK binding', 30_000);
      expect(row(id)).toMatchObject({ owner_user_id: null, category: 'scheduled', scheduled_task_id: schedule.id, dayflow_context_nonreuse_code: null });
      const archived = markInFlight(id, schedule.id, sdk);
      console.info(JSON.stringify({ caseId: 'A4-fixture-marker', ...archived }));
      await release();
      const terminal = await poll(async () => {
        const task = await json<Schedule>(`/agent-schedules/${schedule.id}`);
        return ['success', 'completed_no_op', 'error', 'blocked_on_approval'].includes(task.lastRunStatus ?? '') ? task : undefined;
      }, 'schedule terminal status');
      const reason = 'AgentRunner: Dayflow provider guard held this request (history_ambiguous)';
      const prefixed = /^\[([a-z_]+)\] (.*)$/.exec(terminal.lastError ?? '');
      expect(terminal.lastRunStatus).toBe('error');
      expect(prefixed?.[2]).toBe(reason);
      const runs = await json<Array<{ status: string; error: string | null; rootSessionId: string | null }>>(`/agent-schedules/${schedule.id}/runs`);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ status: 'error', error: terminal.lastError, rootSessionId: id });
      // Session diagnostics: the runner writes its exact reason to lastPreview; the stream bridge
      // records the engine's native error in statusMessage. Both must carry the same bounded reason.
      const session = await snapshot(id) as Session & { lastPreview?: string | null };
      expect(session.status).toBe('error');
      expect(session.lastPreview).toBe(reason);
      expect(session.statusMessage).toBe('Dayflow provider guard held this request (history_ambiguous).');
      // The real engine guard produced it: native assistant error + the permitted pwd really ran.
      const native = await (await fetch(`${ENGINE}/session/${encodeURIComponent(sdk)}/message`, { signal: AbortSignal.timeout(10_000) })).json() as Array<{
        info: { role: string; error?: { data?: { message?: string } } }; parts: Array<{ type: string; state?: { status?: string; output?: string } }>;
      }>;
      const cwd = realpathSync(String(row(id).cwd));
      expect(native.some((m) => m.parts.some((p) => p.type === 'tool' && p.state?.status === 'completed' && (p.state.output ?? '').includes(cwd)))).toBe(true);
      expect(native.filter((m) => m.info.role === 'assistant').at(-1)?.info.error?.data?.message)
        .toBe('Dayflow provider guard held this request (history_ambiguous).');
      await pause(2000);
      expect(await captures(`SDMR:PWD:${marker}`)).toHaveLength(1); // the post-tool attempt never reached the provider
      expect(row(id)).toMatchObject({ dayflow_context_nonreuse_code: 'dayflow_receiving_context_changed',
        dayflow_context_nonreuse_at: (archived.after as { dayflow_context_nonreuse_at: string }).dayflow_context_nonreuse_at });
      await evidence('A4', 'error', { realEngineGuard: true, taskLastError: true, runHistory: true, sessionStatus: true,
        pwdExecuted: true, singleProviderRequest: true, markerRetained: true, category: prefixed?.[1] === 'infra_config' });
    } finally {
      await release();
    }
  }, 300_000);

  it('S4 interactive_owned_chat_ordinary_and_memory_fenced', async () => {
    const { id } = await interactive(await profile());
    // Run tag early in the text: note paths derive from the leading content, and retained
    // fixtures from earlier runs must not collide. Asserted substrings are unchanged.
    const run = tag();
    const preference = `Synthetic gradient slide preference ${run}: center the subject in the photo pane and use a soft gradient behind slide text`;
    const observation = `Synthetic dayflow ${run} gradient slide observation XYZZY`;
    for (const input of [
      { kind: 'preference', content: preference, tags: ['sdmr-synthetic'] },
      { kind: 'context', content: observation, source: 'dayflow', tags: ['dayflow', 'activity-observation', 'sdmr-synthetic'] },
    ]) {
      const memory = await json<{ id: string }>('/agent-memory', { method: 'POST', body: JSON.stringify({ ...input, id: `sdmr-${randomUUID()}` }) });
      memories.push(memory.id);
    }
    const marker = tag();
    await prompt(id, `SDMR:ECHO:${marker} please adjust the slide gradient so the photo subject is centered`);
    await answered(id, `SDMR_ECHO ${marker}`);
    const received = await captures(`SDMR:ECHO:${marker}`);
    expect(received.length).toBeGreaterThan(0);
    expect(received.some((r) => r.systemText.includes('Synthetic gradient slide preference'))).toBe(true);
    expect(received.every((r) => !r.systemText.includes('XYZZY'))).toBe(true);
    const beforeResume = (await captures()).length;
    await prompt(id, 'resume');
    await answered(id, 'SDMR_ECHO none');
    const resumed = (await captures()).slice(beforeResume);
    expect(resumed.some((r) => r.lastUserText.includes('resume'))).toBe(true);
    const provenance = await json<{ recorded: boolean; memoryIds: string[]; items: unknown[] }>(`/agent-sessions/${id}/memory-provenance`);
    expect(provenance.recorded).toBe(true);
    expect(Array.isArray(provenance.memoryIds)).toBe(true);
    expect(Array.isArray(provenance.items)).toBe(true);
    expect(bodyFree(provenance)).toBe(true);
    expect(JSON.stringify(provenance)).not.toContain(preference);
    expect(JSON.stringify(provenance)).not.toContain(observation);
    // Current API's vault writer uses MemoryIndexService(owner=null); it does not
    // accept an owner parameter. Do not fake owner-1 coverage via direct DB writes.
    // GET /agent-memory/:id correctly hides Dayflow records, so inspect only the
    // two synthetic index entries in the sandbox copy through a read-only handle.
    const db = new Database(tempPath(DB), { readonly: true, fileMustExist: true });
    let ownerOne = false;
    try {
      const owners = [preference, observation].map((content) => db.prepare(
        'SELECT owner_user_id FROM agent_memory WHERE instr(content, ?) > 0',
      ).all(content) as Array<{ owner_user_id: number | null }>);
      ownerOne = owners.every((rows) => rows.length === 1 && rows[0].owner_user_id === 1);
    } finally { db.close(); }
    // Instance-wide (owner null) memories are a supported case and are what this API creates;
    // per-owner isolation is covered by unit tests, so ownership is recorded, not asserted.
    await evidence('S4', 'answered', {
      interactiveOwnerOne: true, ordinaryMemoryPresent: true, dayflowFenced: true, resumeAnswered: true, provenanceBodyFree: true,
      memoryOwnedByUser1: ownerOne,
    });
  }, 240_000);

  it('S6 memory_odds_continuation_canonical_update_abstain_receipts', async () => {
    const { id } = await interactive(await profile());
    const run = tag();
    // Run tag leads the text so retained notes from earlier runs never share a vault path.
    const v1 = `Odds fixture ${run}: football betting odds lines use OddsAPI with cached markets`;
    const v2 = `Odds fixture ${run}: football betting odds lines use OddsAPI with live markets`;
    const note = await remember(v1, 'fact', ['sdmr-synthetic']);
    const forbidden = [v1, v2, 'cached markets', 'live markets', 'Look up football', 'evidenceText', 'excerpt', 'queryTokens'];
    const m1 = tag();
    // The run word is shared by this run's note and prompt only: retained notes from earlier runs
    // (same text, other run words) cannot outrank it under the 2-item budget. Assertions unchanged.
    const first = await memoryTurn(id, `Look up football betting odds using OddsAPI ${run} SDMR:ECHO:${m1}`, `SDMR_ECHO ${m1}`);
    expect(first.requests.some((r) => r.systemText.includes(v1) && r.systemText.includes('UNTRUSTED'))).toBe(true);
    expect(first.added).toHaveLength(1);
    expect(first.added[0]).toMatchObject({ decision: 'injected' });
    expect(admitted(first.added[0]).map((c) => c.sourceId)).toContain(note.path);
    // Current canonical update through the real edit-in-place API; the id is unchanged.
    expect((await api(`/agent-memory/${encodeURIComponent(note.id)}`, { method: 'PATCH', body: JSON.stringify({ content: v2 }) })).ok).toBe(true);
    const thanks = await memoryTurn(id, 'thanks', 'SDMR_ECHO none');
    expect(thanks.requests.every((r) => !r.systemText.includes(`Odds fixture ${run}`))).toBe(true);
    expect(thanks.added).toHaveLength(1);
    expect(thanks.added[0].decision).toBe('abstained');
    const lines = await memoryTurn(id, 'what about lines', 'SDMR_ECHO none');
    expect(lines.requests.some((r) => r.lastUserText.includes('what about lines') && r.systemText.includes(v2))).toBe(true);
    expect(lines.requests.every((r) => !r.systemText.includes(v1))).toBe(true);
    expect(lines.added).toHaveLength(1);
    expect(lines.added[0]).toMatchObject({ query_mode: 'continuation', decision: 'injected' });
    expect(admitted(lines.added[0]).map((c) => c.sourceId)).toContain(note.path);
    for (const receipt of [first.added[0], lines.added[0]]) {
      expect(receipt.injected_count ?? 0).toBeLessThanOrEqual(2);
      expect(receipt.injected_chars ?? 0).toBeLessThanOrEqual(1200);
    }
    const all = JSON.stringify(receipts(id));
    for (const text of forbidden) expect(all).not.toContain(text);
    await evidence('S6', 'answered', { oddsLeadAtProvider: true, canonicalUpdateConsumed: true, abstainedOnThanks: true,
      continuationMode: true, receiptPerTurn: true, receiptsBodyFree: true, budgetsKept: true, fenceHeader: true });
  }, 240_000);

  it('S7 memory_writing_archive_section_and_voice_continuation', async () => {
    const { id } = await interactive(await profile());
    const run = tag();
    const style = `For every volunteer email ${run} use warm direct language. Keep paragraphs short and avoid ceremonial greetings.`;
    const archive = `# Historical notes ${run}\n## Workout plan\nSquats recovery lifting unrelated workout.\n## Writing style profile\n${style}\n## Football lookup\nUnrelated football scores and betting archive.`;
    const note = await remember(archive, 'preference', ['archive', 'sdmr-synthetic']);
    const m1 = tag();
    const draft = await memoryTurn(id, `draft volunteer email ${run} for Saturday setup SDMR:ECHO:${m1}`, `SDMR_ECHO ${m1}`);
    const sent = draft.requests.find((r) => r.systemText.includes(style));
    expect(sent).toBeDefined();
    expect(sent!.systemText).toContain('Writing style profile');
    expect(sent!.systemText).toMatch(/updated \d{4}-\d{2}-\d{2}/);
    expect(sent!.systemText).not.toContain('Squats');
    expect(sent!.systemText).not.toContain('football scores');
    expect(draft.added).toHaveLength(1);
    expect(admitted(draft.added[0])).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'applicable_preference_section' }),
    ]));
    expect(admitted(draft.added[0]).map((c) => c.sourceId)).toContain(note.path);
    const voice = await memoryTurn(id, 'use my voice for that', 'SDMR_ECHO none');
    expect(voice.requests.some((r) => r.lastUserText.includes('use my voice') && r.systemText.includes(style))).toBe(true);
    expect(voice.added).toHaveLength(1);
    expect(voice.added[0].query_mode).toBe('continuation');
    const all = JSON.stringify(receipts(id));
    for (const text of [style, 'Writing style profile', 'Squats', 'draft volunteer email', 'excerpt', 'evidenceText']) expect(all).not.toContain(text);
    await evidence('S7', 'answered', { writingSectionAtProvider: true, otherSectionsExcluded: true,
      sectionReason: true, voiceContinuation: true, receiptsBodyFree: true });
  }, 240_000);

  it('S5 approval_still_required', async () => {
    const { id, cwd } = await interactive(await profile());
    const marker = tag(), file = join(cwd, 'sdmr-approval-marker');
    await prompt(id, `SDMR:WRITE:${marker}:${file}`);
    const pending = await poll(async () => {
      expect(existsSync(file)).toBe(false);
      const approvals = await json<Array<{ permissionID: string; tool: string; patterns: string[] }>>(`/agent-sessions/${id}/pending-permissions`);
      return approvals.find((a) => a.tool === 'bash' && a.patterns.some((p) => p.includes(file)));
    }, 'observable pending bash approval', 60_000);
    try {
      const received = await captures(`SDMR:WRITE:${marker}`);
      expect(received.length).toBeGreaterThan(0);
      expect(received.every((r) => r.toolResults.length === 0)).toBe(true);
      expect(existsSync(file)).toBe(false);
      await evidence('S5', 'pending_approval', { markerAbsent: true, approvalPending: true, noToolResult: true });
    } finally {
      expect((await api(`/agent-sessions/${id}/permissions/${encodeURIComponent(pending.permissionID)}/reply`, {
        method: 'POST', body: JSON.stringify({ reply: 'reject', message: 'Synthetic smoke rejects marker write.' }),
      })).status).toBe(204);
      await json(`/agent-sessions/${id}/cancel`, { method: 'POST' });
    }
    expect(existsSync(file)).toBe(false);
  }, 120_000);
});
