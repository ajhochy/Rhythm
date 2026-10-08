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
  return fetch(`${BASE}${path}`, { ...init, signal: AbortSignal.timeout(15_000),
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
    await poll(async () => (await json<{ status: string }>('/opencode/health')).status === 'ready' ? true : undefined,
      'fork engine ready', 30_000);
    await evidence('S3', 'SKIP: no scheduler resume-existing-session mode; mapping is unit-tested', {}, 0);
  }, 60_000);
  beforeEach(async () => {
    expect((await fetch(`${PROVIDER}/_sdmr/reset`, { method: 'POST' })).status).toBe(204);
  });
  afterEach(async () => {
    if (!safeToClean) return;
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
    expect(received.some((r) => r.toolResults.length > 0)).toBe(true);
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
      // Only known access/dispatch refusal is eligible for the requested alternative;
      // never treat arbitrary 500s or routing/auth misconfiguration as a guard pass.
      expect([403, 409, 502]).toContain(response.status);
      const error = JSON.parse(responseBody) as { error?: { message?: string }; message?: string };
      const reason = error.error?.message ?? error.message ?? '';
      expect(reason).toMatch(/system|scheduled/i);
      status = `system_followup_refused: ${reason.slice(0, 240)}`;
    }
    await pause(2000);
    expect(await captures(`SDMR:ECHO:${followup}`)).toHaveLength(0);
    expect(row(sessionId).dayflow_context_nonreuse_code).toBe('dayflow_receiving_context_changed');
    await evidence('S2', status, { providerNotCalled: true, retainedMarker: true, guardReasonSurfaced: status === 'history_ambiguous' });
  }, 240_000);

  it.skip('S3 scheduled_run_failure_reason_preserved — no schedule resume-existing-session mode; guard-reason mapping is unit-tested elsewhere', async () => {
    // AgentSchedulesController.create accepts no target session id; AgentRunner
    // unconditionally _recordSession + createSession on every scheduler run.
    // Explicit skip; beforeAll emits its compact evidence line when live is enabled.
  });

  it('S4 interactive_owned_chat_ordinary_and_memory_fenced', async () => {
    const { id } = await interactive(await profile());
    const preference = 'Synthetic gradient slide preference: center the subject in the photo pane and use a soft gradient behind slide text';
    const observation = 'Synthetic dayflow gradient slide observation XYZZY';
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
      memoryOwner: ownerOne ? 'user_1' : 'instance_wide',
    });
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
