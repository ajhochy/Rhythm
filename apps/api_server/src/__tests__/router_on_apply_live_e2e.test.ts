/**
 * Live proof that routing ON chooses AND applies a model from the first prompt (sandbox only).
 *
 * RHYTHM_LIVE_E2E=1 RHYTHM_LIVE_ROUTER=1 OPENAI_DECISIONS_API_KEY=... against tools/dev/sandbox.sh
 * whose Opencode config declares provider `sdmr` with stand-in models scripted-cheap / scripted /
 * scripted-frontier served by fixtures/scripted_openai_provider_sdmr.mjs. The provider records
 * the model id each request was sent with, so "applied" means the engine actually called the
 * routed model. Router settings live in the sandbox HOME; the key is sent only in the PUT.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const KEY = process.env.OPENAI_DECISIONS_API_KEY ?? '';
const LIVE = process.env.RHYTHM_LIVE_E2E === '1' && process.env.RHYTHM_LIVE_ROUTER === '1' && KEY !== '';
const BASE = (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
const PORT = Number(process.env.RHYTHM_SDMR_PROVIDER_PORT ?? '7481');
const PROVIDER = `http://127.0.0.1:${PORT}`;
const auth = { Authorization: 'Bearer e02-synthetic-session-not-a-secret', 'content-type': 'application/json' };
const MODEL_FOR_TIER: Record<string, string> = { cheap: 'scripted-cheap', standard: 'scripted', frontier: 'scripted-frontier' };
const cleanup = { sessions: [] as string[], profiles: [] as string[], dirs: [] as string[] };
const applied: string[] = [];
let provider: ChildProcess | undefined;
let socket: WebSocket | undefined;

type Row = { sessionId: string | null; status: string; chosen: string | null; confidence: number | null;
  model: string | null; latencyMs: number | null; mode: string; applied: boolean; detail: Record<string, unknown> };
type Captured = { lastUserText: string; body: { model?: string } };
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
async function configure(body: Record<string, unknown>): Promise<void> {
  await json('/agent-decisions/config', { method: 'PUT', body: JSON.stringify(body) });
}
async function session(modelMode: 'auto' | 'fixed'): Promise<string> {
  const id = `sdmr-on-${randomUUID().slice(0, 8)}`;
  await json('/agent-configs', { method: 'POST', body: JSON.stringify({
    id, label: id, isAgent: true, enabled: true, sessionSelectable: true, ocAgent: id,
    modelProvider: 'sdmr', modelId: 'scripted', corePermissionsJson: JSON.stringify({ '*': 'deny' }),
    systemPrompt: 'Synthetic router smoke. Follow the scripted provider response.',
  }) });
  cleanup.profiles.push(id);
  await json('/system/refresh', { method: 'POST' });
  const cwd = mkdtempSync('/private/tmp/rhythm-sdmr-on-');
  cleanup.dirs.push(cwd);
  const created = await json<{ id: string }>('/agent-sessions', { method: 'POST', body: JSON.stringify({
    agentId: id, cwd, name: `Synthetic router ON ${id}`, modelMode,
  }) });
  cleanup.sessions.push(created.id);
  return created.id;
}
/** Send one WS turn; return elapsed ms and the model id the engine sent to the provider. */
async function turn(sessionId: string, text: string): Promise<{ ms: number; model: string | undefined }> {
  const tag = randomUUID().slice(0, 8);
  const started = Date.now();
  socket!.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: `${text} [ref SDMR:ECHO:${tag}]` }));
  await poll(async () => {
    const t = await json<{ messages: Array<{ role: string; rawText?: string; strippedText?: string }> }>(
      `/agent-sessions/${sessionId}/messages?limit=100`);
    return t.messages.some((m) => m.role === 'output' && (m.strippedText ?? m.rawText ?? '').includes(`SDMR_ECHO ${tag}`)) ? true : undefined;
  }, 'answered turn');
  const captured = await (await fetch(`${PROVIDER}/_sdmr/requests`)).json() as Captured[];
  return { ms: Date.now() - started, model: captured.find((r) => r.lastUserText.includes(`SDMR:ECHO:${tag}`))?.body.model };
}
async function snapshot(id: string) {
  return (await json<{ session: { routerDecidedAt?: string | null; providerId?: string | null; modelId?: string | null } }>(
    `/agent-sessions/${id}`)).session;
}
function evidence(caseId: string, data: Record<string, unknown>): void {
  console.info(JSON.stringify({ caseId, ...data })); // never the key, prompts beyond the case text, or system text
}

const ROUTER_ON = {
  backend: 'openai_decisions', remoteDataConsent: true, timeoutMs: 2500,
  openaiDecisions: { baseUrl: 'https://api.openai.com', model: 'gpt-6-luna', apiKey: KEY },
  features: { model_routing: 'on' }, routing: { scope: 'first_prompt' },
};

(LIVE ? describe : describe.skip)('routing ON applies the first-prompt pick through the live WS path', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();
    const parsed = new URL(BASE);
    if (parsed.hostname !== '127.0.0.1' || ['4001', '4096'].includes(parsed.port)) throw new Error('sandbox API required');
    provider = spawn(process.execPath, [join(__dirname, 'fixtures/scripted_openai_provider_sdmr.mjs')], {
      env: { ...process.env, RHYTHM_SDMR_PROVIDER_PORT: String(PORT) }, stdio: 'ignore',
    });
    await poll(async () => fetch(`${PROVIDER}/health`).then((r) => (r.ok ? true : undefined)).catch(() => undefined), 'provider', 10_000);
    expect((await api('/opencode/auth/sdmr', { method: 'POST', body: JSON.stringify({ apiKey: 'sdmr-synthetic-only' }) })).ok).toBe(true);
    // Catalog: only the three local stand-ins are routable, one per tier (no real model is ever called).
    const config = await json<{ catalog?: { models: Array<{ providerID: string; modelID: string; enabled?: boolean }> } }>('/agent-decisions/config');
    const models = config.catalog?.models ?? [];
    const hidden = models.filter((m) => m.providerID === 'sdmr' && m.enabled === false);
    if (hidden.length) {
      await json('/agent-models/visibility', { method: 'PATCH', body: JSON.stringify({
        updates: hidden.map((m) => ({ provider: m.providerID, modelId: m.modelID, visible: true })) }) });
    }
    await configure({ ...ROUTER_ON,
      tierOverrides: { 'sdmr/scripted-cheap': 'cheap', 'sdmr/scripted': 'standard', 'sdmr/scripted-frontier': 'frontier' },
      excludedModels: models.filter((m) => m.providerID !== 'sdmr').map((m) => `${m.providerID}/${m.modelID}`) });
    socket = await new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/ws/agents`, { origin: 'rhythm://app', headers: { Authorization: auth.Authorization } });
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }, 90_000);
  afterAll(async () => {
    socket?.close();
    await configure({ backend: 'local', remoteDataConsent: false, openaiDecisions: { apiKey: '' },
      features: { model_routing: 'off' } }).catch(() => undefined);
    for (const id of cleanup.sessions.reverse()) await api(`/agent-sessions/${id}/hard`, { method: 'DELETE' }).catch(() => undefined);
    for (const id of cleanup.profiles.reverse()) await api(`/agent-configs/${id}`, { method: 'DELETE' }).catch(() => undefined);
    for (const dir of cleanup.dirs) rmSync(dir, { recursive: true, force: true });
    provider?.kill('SIGTERM');
  }, 60_000);

  it.each([
    ['O1 quick', 'What is 15 percent of 80?'],
    ['O2 everyday', 'Draft a short email to the volunteers about Sunday setup times.'],
    ['O3 hard', 'Design the architecture for syncing our church calendar across three systems and plan the migration.'],
  ])('%s: the first prompt is classified, the pick is applied to that turn and kept for the next', async (caseId, prompt) => {
    const id = await session('auto');
    const first = await turn(id, prompt);
    const [row] = await rows(id);
    expect(row).toMatchObject({ mode: 'on', status: 'ok', model: 'gpt-6-luna' });
    expect(['cheap', 'standard', 'frontier']).toContain(row.chosen);
    const expected = MODEL_FOR_TIER[row.chosen!];
    // Applied: the engine called the routed model on this very turn, and the session remembers it.
    expect(first.model).toBe(expected);
    const after = await snapshot(id);
    expect(after.routerDecidedAt).toBeTruthy();
    expect(after.modelId).toBe(expected);
    // Follow-up: no new classification; it stays on the routed model.
    const second = await turn(id, 'ok, thanks');
    expect(await rows(id)).toHaveLength(1);
    expect(second.model).toBe(expected);
    if (expected !== 'scripted') applied.push(caseId);
    evidence(caseId, { tier: row.chosen, score: row.detail.score ?? null, classifierMs: row.latencyMs, baseline: 'sdmr/scripted (standard)',
      firstTurnModel: first.model, sessionModel: after.modelId, followUpModel: second.model, firstTurnMs: first.ms, decisions: 1 });
  }, 240_000);

  it('O4 at least one first prompt was moved off the baseline model', () => {
    expect(applied.length).toBeGreaterThan(0);
    evidence('O4', { movedOffBaseline: applied });
  });

  it('O5 a fixed (pinned) session is never classified and keeps its model', async () => {
    const id = await session('fixed');
    const first = await turn(id, 'Design the architecture for syncing our church calendar across three systems and plan the migration.');
    await pause(1500);
    expect(await rows(id)).toHaveLength(0);
    expect(first.model).toBe('scripted');
    evidence('O5', { pinned: true, decisions: 0, model: first.model });
  }, 240_000);

  it('O6 if the classifier fails, the turn runs on the baseline and nothing is persisted', async () => {
    await configure({ ...ROUTER_ON, openaiDecisions: { baseUrl: 'http://127.0.0.1:8019', model: 'gpt-6-luna' } });
    try {
      const id = await session('auto');
      const first = await turn(id, 'Design the architecture for syncing our church calendar across three systems and plan the migration.');
      const [row] = await rows(id);
      expect(row.status).not.toBe('ok');
      expect(row.applied).toBe(false);
      expect(first.model).toBe('scripted');
      expect((await snapshot(id)).routerDecidedAt ?? null).toBeNull();
      evidence('O6', { status: row.status, reason: row.detail.reason ?? null, model: first.model, answered: true });
    } finally {
      await configure(ROUTER_ON);
    }
  }, 240_000);
});
