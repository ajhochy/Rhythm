/**
 * Live shadow-routing contract through the real WS turn path (sandbox only).
 *
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_ROUTER=1, against tools/dev/sandbox.sh, with the
 * scripted provider from fixtures/scripted_openai_provider_sdmr.mjs. Kev cases need
 * a Kev server on RHYTHM_LIVE_KEV_URL (default http://127.0.0.1:8009). The OpenAI
 * Decisions case runs only when OPENAI_DECISIONS_API_KEY is set; the key is sent
 * only in the settings PUT and is never logged. Router settings live in the
 * sandbox HOME, never in the operator's real settings file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const LIVE = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_ROUTER === '1';
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const PORT = Number(process.env.RHYTHM_SDMR_PROVIDER_PORT ?? '7481');
const PROVIDER = `http://127.0.0.1:${PORT}`;
const KEV = process.env.RHYTHM_LIVE_KEV_URL ?? 'http://127.0.0.1:8009';
const DECISIONS_KEY = process.env.OPENAI_DECISIONS_API_KEY ?? '';
const auth = { Authorization: 'Bearer e02-synthetic-session-not-a-secret', 'content-type': 'application/json' };
const cleanup = { sessions: [] as string[], profiles: [] as string[], dirs: [] as string[] };
let provider: ChildProcess | undefined;
let socket: WebSocket | undefined;

type Row = { sessionId: string | null; status: string; chosen: string | null; confidence: number | null;
  model: string | null; latencyMs: number | null; mode: string; applied: boolean; detail: Record<string, unknown> };
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, { ...init, headers: { ...auth, ...init.headers }, signal: AbortSignal.timeout(60_000) });
}
async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await api(path, init);
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path}: HTTP ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
async function poll<T>(read: () => Promise<T | undefined>, label: string, ms = 120_000): Promise<T> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await pause(250);
  }
  throw new Error(`${label} timed out`);
}
async function rows(sessionId: string): Promise<Row[]> {
  const body = await json<{ recent: Row[] }>('/agent-decisions?feature=model_routing&limit=200');
  return body.recent.filter((row) => row.sessionId === sessionId);
}
async function configure(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return json('/agent-decisions/config', { method: 'PUT', body: JSON.stringify({
    features: { model_routing: 'shadow' }, routing: { scope: 'first_prompt' },
    // The sandbox catalog only has cheap models; give each tier one so the would-be pick is concrete.
    tierOverrides: { 'sdmr/scripted': 'standard', 'opencode/big-pickle': 'frontier' }, ...body,
  }) });
}
async function session(modelMode: 'auto' | 'fixed' = 'auto'): Promise<string> {
  const id = `sdmr-router-${randomUUID().slice(0, 8)}`;
  await json('/agent-configs', { method: 'POST', body: JSON.stringify({
    id, label: id, isAgent: true, enabled: true, sessionSelectable: true, ocAgent: id,
    modelProvider: 'sdmr', modelId: 'scripted', corePermissionsJson: JSON.stringify({ '*': 'deny' }),
    systemPrompt: 'Synthetic router smoke. Follow the scripted provider response.',
  }) });
  cleanup.profiles.push(id);
  await json('/system/refresh', { method: 'POST' });
  const cwd = mkdtempSync('/private/tmp/rhythm-sdmr-router-');
  cleanup.dirs.push(cwd);
  const created = await json<{ id: string }>('/agent-sessions', { method: 'POST', body: JSON.stringify({
    agentId: id, cwd, name: `Synthetic router ${id}`, modelMode,
  }) });
  cleanup.sessions.push(created.id);
  return created.id;
}
async function turn(sessionId: string, text: string, marker: string): Promise<number> {
  const started = Date.now();
  socket!.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: text }));
  await poll(async () => {
    const t = await json<{ messages: Array<{ role: string; rawText?: string; strippedText?: string }> }>(
      `/agent-sessions/${sessionId}/messages?limit=100`);
    return t.messages.some((m) => m.role === 'output' && (m.strippedText ?? m.rawText ?? '').includes(marker)) ? true : undefined;
  }, 'answered turn');
  return Date.now() - started;
}
function evidence(caseId: string, data: Record<string, unknown>): void {
  console.info(JSON.stringify({ caseId, ...data })); // never the key, prompts or system text
}

(LIVE ? describe : describe.skip)('shadow routing backends through the WS turn path', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const parsed = new URL(BASE);
    if (parsed.hostname !== '127.0.0.1' || ['4001', '4096'].includes(parsed.port)) throw new Error('sandbox API required');
    provider = spawn(process.execPath, [join(__dirname, 'fixtures/scripted_openai_provider_sdmr.mjs')], {
      env: { ...process.env, RHYTHM_SDMR_PROVIDER_PORT: String(PORT) }, stdio: 'ignore',
    });
    await poll(async () => fetch(`${PROVIDER}/health`).then((r) => (r.ok ? true : undefined)).catch(() => undefined), 'provider', 10_000);
    expect((await api('/opencode/auth/sdmr', { method: 'POST', body: JSON.stringify({ apiKey: 'sdmr-synthetic-only' }) })).ok).toBe(true);
    socket = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/agents`, {
        origin: 'rhythm://app', headers: { Authorization: auth.Authorization },
      });
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }, 60_000);
  afterAll(async () => {
    socket?.close();
    await configure({ backend: 'local', remoteDataConsent: false, openaiDecisions: { apiKey: '' },
      features: { model_routing: 'off' } }).catch(() => undefined);
    for (const id of cleanup.sessions.reverse()) await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
    for (const id of cleanup.profiles.reverse()) await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
    for (const dir of cleanup.dirs) rmSync(dir, { recursive: true, force: true });
    provider?.kill('SIGTERM');
  }, 60_000);

  it('R1 Kev classifies the first prompt only, in the background, and changes nothing', async () => {
    await configure({ backend: 'systemone', systemone: { baseUrl: KEV, model: 'kev-latest' }, timeoutMs: 15_000 });
    const id = await session();
    const first = randomUUID().slice(0, 8);
    const firstMs = await turn(id, `SDMR:ECHO:${first} Draft a short email to the volunteers about Sunday setup times.`, `SDMR_ECHO ${first}`);
    const [row] = await poll(async () => { const r = await rows(id); return r.length ? r : undefined; }, 'kev decision row', 60_000);
    expect(row).toMatchObject({ mode: 'shadow', applied: false, status: 'ok' });
    expect(['cheap', 'standard', 'frontier']).toContain(row.chosen);
    expect(typeof row.detail.wouldApply).toBe('boolean');
    // The concrete model the live catalog would pick is recorded, but the session keeps its own route.
    expect(row.detail.catalog).toBe('live');
    expect(typeof row.detail.pickedModel).toBe('string');
    const second = randomUUID().slice(0, 8);
    const secondMs = await turn(id, `SDMR:ECHO:${second} yes do that but make it shorter`, `SDMR_ECHO ${second}`);
    await pause(3000);
    expect(await rows(id)).toHaveLength(1);
    const snapshot = await json<{ session: { routerDecidedAt?: string | null; modelId?: string | null } }>(`/agent-sessions/${id}`);
    expect(snapshot.session.routerDecidedAt ?? null).toBeNull();
    evidence('R1', { status: row.status, chosen: row.chosen, confidence: row.confidence, classifierMs: row.latencyMs,
      model: row.model, pickedModel: row.detail.pickedModel ?? null, firstTurnMs: firstMs, secondTurnMs: secondMs, rowsAfterSecond: 1 });
  }, 240_000);

  it('R2 unreachable classifier is a recorded fallback and the turn still answers', async () => {
    // This suite is the legacy (default-engine) shadow path; a shared sandbox may carry routing.engine=grid
    // from grid suites, so pin it. The unreachable endpoint must be a closed loopback port the sandbox
    // transport guard forwards, so the failure is a real ECONNREFUSED rather than an in-process refusal.
    const unreachable = 'http://127.0.0.1:7483';
    expect(await fetch(`${unreachable}/health`, { signal: AbortSignal.timeout(2000) })
      .then(() => 'listening', (err: { cause?: { code?: string } }) => err?.cause?.code ?? 'unknown')).toBe('ECONNREFUSED');
    await configure({ backend: 'systemone', systemone: { baseUrl: unreachable, model: 'kev-latest' }, timeoutMs: 1000,
      routing: { scope: 'first_prompt', engine: 'legacy' } });
    const id = await session();
    const marker = randomUUID().slice(0, 8);
    await turn(id, `SDMR:ECHO:${marker} What tasks are due today?`, `SDMR_ECHO ${marker}`);
    const [row] = await poll(async () => { const r = await rows(id); return r.length ? r : undefined; }, 'fallback row', 30_000);
    expect(row).toMatchObject({ status: 'error', applied: false });
    expect(row.detail.reason).toBe('request_failed');
    expect(row.detail.cause).toBe('ECONNREFUSED');
    evidence('R2', { status: row.status, reason: row.detail.reason, cause: row.detail.cause, answered: true });
  }, 120_000);

  it('R3 a pinned (fixed) session is never classified', async () => {
    await configure({ backend: 'systemone', systemone: { baseUrl: KEV, model: 'kev-latest' }, timeoutMs: 15_000 });
    const id = await session('fixed');
    const marker = randomUUID().slice(0, 8);
    await turn(id, `SDMR:ECHO:${marker} Plan the next quarter's volunteer training schedule.`, `SDMR_ECHO ${marker}`);
    await pause(3000);
    expect(await rows(id)).toHaveLength(0);
    evidence('R3', { pinned: true, rows: 0 });
  }, 120_000);

  (DECISIONS_KEY ? it : it.skip)('R4 OpenAI Decisions scores the first prompt once; the key is never readable', async () => {
    const saved = await configure({ backend: 'openai_decisions', remoteDataConsent: true, timeoutMs: 1000,
      openaiDecisions: { baseUrl: 'https://api.openai.com', model: 'gpt-6-luna', apiKey: DECISIONS_KEY } });
    expect(JSON.stringify(saved)).not.toContain(DECISIONS_KEY);
    const view = await json<Record<string, unknown>>('/agent-decisions/config');
    expect(JSON.stringify(view)).not.toContain(DECISIONS_KEY);
    const id = await session();
    const first = randomUUID().slice(0, 8);
    await turn(id, `SDMR:ECHO:${first} Design the architecture for syncing our church calendar across three systems and plan the migration.`, `SDMR_ECHO ${first}`);
    const [row] = await poll(async () => { const r = await rows(id); return r.length ? r : undefined; }, 'decisions row', 60_000);
    expect(row).toMatchObject({ mode: 'shadow', applied: false, status: 'ok', model: 'gpt-6-luna' });
    expect(typeof row.detail.score).toBe('number');
    expect(row.detail.catalog).toBe('live');
    expect(typeof row.detail.pickedModel).toBe('string');
    expect(['cheap', 'standard', 'frontier']).toContain(row.chosen);
    expect(JSON.stringify(row)).not.toContain(DECISIONS_KEY);
    const second = randomUUID().slice(0, 8);
    await turn(id, `SDMR:ECHO:${second} ok go ahead`, `SDMR_ECHO ${second}`);
    await pause(3000);
    expect(await rows(id)).toHaveLength(1);
    evidence('R4', { status: row.status, chosen: row.chosen, score: row.detail.score, apiConfidence: row.confidence,
      classifierMs: row.latencyMs, inputTokens: row.detail.inputTokens ?? null, pickedModel: row.detail.pickedModel ?? null, rowsAfterSecond: 1 });
  }, 240_000);

  (DECISIONS_KEY ? it : it.skip)('R5 without remote-data consent the OpenAI backend cannot even be selected', async () => {
    await configure({ backend: 'local', remoteDataConsent: false, openaiDecisions: { apiKey: '' } });
    const response = await api('/agent-decisions/config', { method: 'PUT', body: JSON.stringify({
      backend: 'openai_decisions', remoteDataConsent: false, features: { model_routing: 'shadow' } }) });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe('consent_required');
    const view = await json<{ backend: string; openaiDecisions?: { hasApiKey: boolean } }>('/agent-decisions/config');
    expect(view.backend).toBe('local');
    expect(view.openaiDecisions?.hasApiKey).toBe(false);
    evidence('R5', { refused: 'consent_required', backendUnchanged: true, keyCleared: true });
  }, 120_000);
});
